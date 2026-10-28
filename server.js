const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 4173;

let rawConn = process.env.DATABASE_URL || 'postgresql://postgres.ipujjwfhdsxusgwnjhnc:5bT5YVLNVwutR2tW@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true';
if (rawConn.includes('pooler.supabase.com:5432')) {
  rawConn = rawConn.replace(':5432', ':6543');
}
if (!rawConn.includes('pgbouncer=true')) {
  rawConn += (rawConn.includes('?') ? '&' : '?') + 'pgbouncer=true';
}
const connectionString = rawConn;

const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
  ssl: {
    rejectUnauthorized: false
  }
});

// VAPID Web Push Yapılandırması (Telefon ekranı kapalıyken bildirim gönderme için)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BOHN6hRnH0S13TSYP2mmLTUIYFrLds9rvgsOwdmzMKAWSR_3v-O4o6PWcyas2Z05oIf8gGaySfLl87vXp8Lh-_c';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'sbDQJwNiqfvGcM7Kx_kOhdqOuzZ42EA-y6xVa8SNw3o';

webpush.setVapidDetails(
  'mailto:destek@servis360.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// --- GİRİŞ (AUTHENTICATION - YÖNETİCİ, FİRMA, ŞOFÖR VEYA PERSONEL) ---
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Kullanıcı bilgisi ve şifre zorunludur.' });
  }

  const rawInput = email.trim();
  const cleanUser = rawInput.toUpperCase().replace(/\s+/g, '');
  const cleanPass = password.trim();

  try {
    // 1. Önce Yönetici / Firma Kullanıcılarında Ara (E-posta ile)
    const userRes = await pool.query(
      `SELECT u.id, u.company_id, u.email, u.full_name, u.role, u.password, 
              c.company_name, c.service_type, c.operation_type 
       FROM users u 
       LEFT JOIN companies c ON u.company_id = c.id 
       WHERE LOWER(u.email) = LOWER($1)`,
      [rawInput]
    );

    if (userRes.rows.length > 0) {
      const user = userRes.rows[0];
      if (user.password !== cleanPass) {
        return res.status(401).json({ error: 'Hatalı şifre girdiniz.' });
      }
      delete user.password;
      return res.json({ success: true, user });
    }

    // 2. Eğer kullanıcı tablosunda yoksa, Servis Şoförü / Plaka kontrolü yap
    const shuttleRes = await pool.query(`
      SELECT s.*, 
             c.company_name, c.workplace_name, c.workplace_lat, c.workplace_lng, c.geofence_radius_meters, c.operation_type
      FROM shuttles s
      JOIN companies c ON s.company_id = c.id
      WHERE (UPPER(REPLACE(s.driver_username, ' ', '')) = $1 
         OR UPPER(REPLACE(s.plate, ' ', '')) = $1 
         OR s.driver_phone = $1)
        AND s.driver_password = $2
    `, [cleanUser, cleanPass]);

    let shuttle = null;
    if (shuttleRes.rows.length > 0) {
      shuttle = shuttleRes.rows[0];
    } else {
      // 3. Personel / Şoför ID (PRS-1005 veya Telefon) kontrolü yap
      const empRes = await pool.query(`
        SELECT e.*, s.id as shuttle_id
        FROM employees e
        JOIN shuttles s ON e.shuttle_id = s.id
        WHERE (UPPER(REPLACE(e.login_id, ' ', '')) = $1 OR e.phone = $1)
          AND e.login_pass = $2
      `, [cleanUser, cleanPass]);

      if (empRes.rows.length > 0 && empRes.rows[0].shuttle_id) {
        const foundShuttleId = empRes.rows[0].shuttle_id;
        const matchedShuttleRes = await pool.query(`
          SELECT s.*, 
                 c.company_name, c.workplace_name, c.workplace_lat, c.workplace_lng, c.geofence_radius_meters, c.operation_type
          FROM shuttles s
          JOIN companies c ON s.company_id = c.id
          WHERE s.id = $1
        `, [foundShuttleId]);

        if (matchedShuttleRes.rows.length > 0) {
          shuttle = matchedShuttleRes.rows[0];
        }
      }
    }

    // Eğer Şoför / Servis bulunduysa kokpit yönlendirmesiyle yanıt ver!
    if (shuttle) {
      const passRes = await pool.query(`
        SELECT e.*, st.stop_name, st.stop_order, st.eta_time
        FROM employees e
        LEFT JOIN stops st ON e.stop_id = st.id
        WHERE e.shuttle_id = $1
        ORDER BY COALESCE(st.stop_order, 999) ASC, e.id ASC
      `, [shuttle.id]);

      return res.json({
        success: true,
        is_driver: true,
        shuttle,
        passengers: passRes.rows,
        redirect: '/driver.html'
      });
    }

    return res.status(401).json({ error: 'Hatalı e-posta, plaka, personel ID veya şifre girdiniz.' });
  } catch (err) {
    console.error('Unified login error:', err);
    res.status(500).json({ error: 'Giriş sırasında hata oluştu: ' + err.message });
  }
});

// --- SÜPER ADMİN: MÜŞTERİ YÖNETİMİ ---
app.get('/api/superadmin/companies', async (req, res) => {
  try {
    const companies = await pool.query(`
      SELECT c.*, 
        COUNT(DISTINCT s.id) as total_shuttles,
        COUNT(DISTINCT e.id) as total_employees
      FROM companies c
      LEFT JOIN shuttles s ON c.id = s.company_id
      LEFT JOIN employees e ON c.id = e.company_id
      GROUP BY c.id
      ORDER BY c.id DESC
    `);
    res.json({ success: true, companies: companies.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Süper Admin Yeni Müşteri Tanımlar (Personel Servisi vs Öğrenci Servisi & Portal vs Entegrasyonlu)
app.post('/api/superadmin/companies', async (req, res) => {
  const {
    company_name,
    contact_person,
    contact_email,
    contact_phone,
    admin_password,
    service_type,    // 'portal' | 'integration'
    operation_type,  // 'personnel' (Personel Servisi) | 'school' (Öğrenci Servisi)
    workplace_name,
    workplace_lat,
    workplace_lng,
    geofence_radius_meters
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const defaultWorkplace = operation_type === 'school' ? 'Merkez Okul & Kampüs' : 'Merkez Fabrika / Ofis';

    const compRes = await client.query(`
      INSERT INTO companies 
      (company_name, contact_person, contact_email, contact_phone, service_type, operation_type, workplace_name, workplace_lat, workplace_lng, geofence_radius_meters)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      company_name,
      contact_person,
      contact_email,
      contact_phone,
      service_type || 'portal',
      operation_type || 'personnel',
      workplace_name || defaultWorkplace,
      workplace_lat || 41.1105,
      workplace_lng || 29.0225,
      geofence_radius_meters || 180
    ]);

    const newCompany = compRes.rows[0];

    const userRes = await client.query(`
      INSERT INTO users (company_id, email, password, full_name, phone, role)
      VALUES ($1, $2, $3, $4, $5, 'company_admin')
      RETURNING id, email, full_name, role
    `, [
      newCompany.id,
      contact_email,
      admin_password || '123456',
      contact_person,
      contact_phone
    ]);

    await client.query('COMMIT');
    res.json({ success: true, company: newCompany, adminUser: userRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Company creation error:', err);
    res.status(500).json({ error: 'Müşteri hesabı oluşturulamadı: ' + err.message });
  } finally {
    client.release();
  }
});

// --- MÜŞTERİ PANELİ ENDPOINTS ---

// Müşteri Dashboard Verileri
app.get('/api/company/:companyId/dashboard', async (req, res) => {
  const { companyId } = req.params;
  try {
    const compRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
    if (compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Şirket bulunamadı.' });
    }

    const shuttles = await pool.query('SELECT * FROM shuttles WHERE company_id = $1 ORDER BY id ASC', [companyId]);
    const routes = await pool.query('SELECT * FROM routes WHERE company_id = $1 ORDER BY id ASC', [companyId]);
    
    const routeIds = routes.rows.map(r => r.id);
    let stops = [];
    if (routeIds.length > 0) {
      const stopsRes = await pool.query('SELECT * FROM stops WHERE route_id = ANY($1) ORDER BY stop_order ASC', [routeIds]);
      stops = stopsRes.rows;
    }

    const employees = await pool.query(`
      SELECT e.*, s.plate as shuttle_plate, st.stop_name
      FROM employees e
      LEFT JOIN shuttles s ON e.shuttle_id = s.id
      LEFT JOIN stops st ON e.stop_id = st.id
      WHERE e.company_id = $1
      ORDER BY e.id ASC
    `, [companyId]);

    res.json({
      success: true,
      company: compRes.rows[0],
      shuttles: shuttles.rows,
      routes: routes.rows,
      stops: stops,
      employees: employees.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Fabrika / Okul Lokasyon Ayarları
app.post('/api/company/:companyId/workplace', async (req, res) => {
  const { companyId } = req.params;
  const { workplace_name, workplace_lat, workplace_lng, geofence_radius_meters } = req.body;

  try {
    const updateRes = await pool.query(`
      UPDATE companies 
      SET workplace_name = $1, workplace_lat = $2, workplace_lng = $3, geofence_radius_meters = $4
      WHERE id = $5
      RETURNING *
    `, [workplace_name, workplace_lat, workplace_lng, geofence_radius_meters, companyId]);

    res.json({ success: true, company: updateRes.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Servis Ekleme (Başlama ve Dönüş Saati + Şoför Giriş Bilgileri)
app.post('/api/company/:companyId/shuttles', async (req, res) => {
  const { companyId } = req.params;
  const { plate, model, capacity, driver_name, driver_phone, shift_start_time, return_time, driver_password } = req.body;

  const defaultUsername = (plate || '').replace(/\s+/g, '').toUpperCase();
  const defaultPassword = driver_password || '123456';

  try {
    const insertRes = await pool.query(`
      INSERT INTO shuttles 
      (company_id, plate, model, capacity, driver_name, driver_phone, shift_start_time, return_time, driver_username, driver_password, current_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'waiting')
      RETURNING *
    `, [
      companyId,
      plate,
      model || 'Servis Minibüsü',
      capacity || 24,
      driver_name,
      driver_phone,
      shift_start_time || '07:15',
      return_time || '17:30',
      defaultUsername,
      defaultPassword
    ]);

    res.json({ success: true, shuttle: insertRes.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Servis Düzenleme (Saatler ve Şoför Bilgileri Güncelleme)
app.put('/api/company/:companyId/shuttles/:shuttleId', async (req, res) => {
  const { companyId, shuttleId } = req.params;
  const { plate, model, capacity, driver_name, driver_phone, shift_start_time, return_time, driver_password } = req.body;

  try {
    const updateRes = await pool.query(`
      UPDATE shuttles 
      SET plate = $1, model = $2, capacity = $3, driver_name = $4, driver_phone = $5,
          shift_start_time = $6, return_time = $7, driver_password = COALESCE($8, driver_password)
      WHERE id = $9 AND company_id = $10
      RETURNING *
    `, [
      plate,
      model,
      capacity,
      driver_name,
      driver_phone,
      shift_start_time,
      return_time || '17:30',
      driver_password,
      shuttleId,
      companyId
    ]);

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Servis aracı bulunamadı.' });
    }

    res.json({ success: true, shuttle: updateRes.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Rota ve Durak Ekleme (Yol Geometrisi OSRM snapped koordinatları ile!)
app.post('/api/company/:companyId/routes', async (req, res) => {
  const { companyId } = req.params;
  const { shuttle_id, route_name, color, stops, road_geometry, total_distance_km, total_duration_mins } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Eğer bu araç için önceden tanımlanmış eski rota varsa temizle (Çakışma ve mükerrer kayıtları engelle)
    if (shuttle_id) {
      const oldRoutes = await client.query('SELECT id FROM routes WHERE company_id = $1 AND shuttle_id = $2', [companyId, shuttle_id]);
      const oldIds = oldRoutes.rows.map(r => r.id);
      if (oldIds.length > 0) {
        await client.query('DELETE FROM stops WHERE route_id = ANY($1)', [oldIds]);
        await client.query('DELETE FROM routes WHERE id = ANY($1)', [oldIds]);
      }
    }

    const routeRes = await client.query(`
      INSERT INTO routes 
      (company_id, shuttle_id, route_name, color, road_geometry, total_distance_km, total_duration_mins)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      companyId,
      shuttle_id || null,
      route_name,
      color || '#3b82f6',
      JSON.stringify(road_geometry || []),
      total_distance_km || 0,
      total_duration_mins || 0
    ]);

    const newRoute = routeRes.rows[0];

    if (stops && Array.isArray(stops)) {
      for (let i = 0; i < stops.length; i++) {
        const st = stops[i];
        await client.query(`
          INSERT INTO stops (route_id, stop_name, stop_order, lat, lng, eta_time, is_workplace_destination)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          newRoute.id,
          st.stop_name || `Durak ${i + 1}`,
          i + 1,
          st.lat,
          st.lng,
          st.eta_time || '07:30',
          st.is_workplace_destination || false
        ]);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, route: newRoute });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Route creation error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Rota Silme
app.delete('/api/company/:companyId/routes/:routeId', async (req, res) => {
  const { companyId, routeId } = req.params;
  try {
    await pool.query('DELETE FROM routes WHERE id = $1 AND company_id = $2', [routeId, companyId]);
    res.json({ success: true, message: 'Rota silindi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Personel VEYA Öğrenci/Veli Ekleme (Otomatik ID & Şifre Üretimi)
app.post('/api/company/:companyId/employees', async (req, res) => {
  const { companyId } = req.params;
  const {
    full_name,
    department,
    phone,
    shuttle_id,
    stop_id,
    passenger_type, // 'employee' | 'student'
    student_class,
    student_number,
    parent_name,
    parent_phone,
    parent_relation,
    role, // 'passenger' | 'driver'
    login_id,
    login_pass
  } = req.body;

  // Otomatik Login ID ve Şifre Üretimi (Eğer kullanıcı girmediyse)
  const autoLoginId = login_id || ((role === 'driver' ? 'SOFOR-' : 'PRS-') + Math.floor(1000 + Math.random() * 9000));
  const autoLoginPass = login_pass || '123456';
  const assignedRole = role || 'passenger';

  try {
    const empRes = await pool.query(`
      INSERT INTO employees 
      (company_id, shuttle_id, stop_id, full_name, department, phone, status, passenger_type, 
       student_class, student_number, parent_name, parent_phone, parent_relation, role, login_id, login_pass)
      VALUES ($1, $2, $3, $4, $5, $6, 'waiting', $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      companyId,
      shuttle_id || null,
      stop_id || null,
      full_name,
      department || 'Genel',
      phone || parent_phone || null,
      passenger_type || 'employee',
      student_class || null,
      student_number || null,
      parent_name || null,
      parent_phone || null,
      parent_relation || 'Veli',
      assignedRole,
      autoLoginId,
      autoLoginPass
    ]);

    const createdEmp = empRes.rows[0];

    // Eğer 'Servis Şoförü' olarak eklendiyse ve servis aracı seçildiyse, servis aracının şoför bilgilerini de güncelle
    if (assignedRole === 'driver' && shuttle_id) {
      await pool.query(`
        UPDATE shuttles 
        SET driver_name = $1, driver_phone = $2, driver_username = $3, driver_password = $4
        WHERE id = $5
      `, [full_name, phone || '', autoLoginId, autoLoginPass, shuttle_id]);
    }

    res.json({ success: true, employee: createdEmp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- ŞOFÖR MOBİL UYGULAMASI / PWA CANLI GPS ENDPOINTLERİ ---

// Tüm aktif servis araçlarını listele (Şoför seçim ekranı için)
app.get('/api/shuttles/available', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.plate, s.model, s.driver_name, s.driver_phone, s.shift_start_time, s.return_time, s.current_status,
             c.company_name, c.workplace_name, c.workplace_lat, c.workplace_lng, c.geofence_radius_meters, c.operation_type
      FROM shuttles s
      JOIN companies c ON s.company_id = c.id
      ORDER BY s.id ASC
    `);
    res.json({ success: true, shuttles: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Şoförün telefonundan anlık GPS konumu alma (Mobile -> Server)
app.post('/api/shuttle/:shuttleId/location', async (req, res) => {
  const { shuttleId } = req.params;
  const { lat, lng, speed, heading, status, trip_type } = req.body;

  try {
    const updateRes = await pool.query(`
      UPDATE shuttles 
      SET last_lat = $1, last_lng = $2, current_status = COALESCE($3, 'running'), last_location_time = NOW()
      WHERE id = $4
      RETURNING *
    `, [lat, lng, status || 'running', shuttleId]);

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Servis aracı bulunamadı.' });
    }

    const shuttle = updateRes.rows[0];
    const compRes = await pool.query('SELECT * FROM companies WHERE id = $1', [shuttle.company_id]);
    let arrived = false;
    let workplace = compRes.rows.length > 0 ? compRes.rows[0] : null;
    let reachedStopName = null;

    // Sefer Kaydı (service_trips) - Aktif sefer var mı kontrol et veya otomatik başlat
    let trip = null;
    const activeTripRes = await pool.query(`
      SELECT * FROM service_trips 
      WHERE shuttle_id = $1 AND status = 'in_progress' 
      ORDER BY start_time DESC LIMIT 1
    `, [shuttleId]);

    if (activeTripRes.rows.length === 0) {
      const rRes = await pool.query('SELECT * FROM routes WHERE shuttle_id = $1 LIMIT 1', [shuttleId]);
      const matchedRoute = rRes.rows[0];
      const stopCountRes = matchedRoute 
        ? await pool.query('SELECT COUNT(*) as c FROM stops WHERE route_id = $1', [matchedRoute.id])
        : { rows: [{ c: 0 }] };
      const passCountRes = await pool.query('SELECT COUNT(*) as c FROM employees WHERE shuttle_id = $1', [shuttleId]);

      const insertTrip = await pool.query(`
        INSERT INTO service_trips (
          company_id, shuttle_id, route_id, plate, driver_name, route_name,
          trip_type, trip_date, start_time, start_lat, start_lng, total_stops,
          passenger_count, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, NOW(), $8, $9, $10, $11, 'in_progress')
        RETURNING *
      `, [
        shuttle.company_id, shuttle.id, matchedRoute ? matchedRoute.id : null,
        shuttle.plate, shuttle.driver_name, matchedRoute ? matchedRoute.route_name : 'Servis Güzergahı',
        trip_type || 'morning', lat, lng,
        parseInt(stopCountRes.rows[0].c) || 0,
        parseInt(passCountRes.rows[0].c) || 0
      ]);
      trip = insertTrip.rows[0];
    } else {
      trip = activeTripRes.rows[0];
    }

    // Seferin kaç saniyedir sürdüğü (erken varış tetiklenmesini önlemek için)
    const tripSeconds = trip ? (Date.now() - new Date(trip.start_time).getTime()) / 1000 : 999;

    // 1. AKŞAM DÖNÜŞ SEFERİ: Hedef sabahki 1. durak (rotanın ilk durağı / son bırakma durağı)
    if (trip_type === 'evening') {
      const firstStopRes = await pool.query(`
        SELECT st.* 
        FROM stops st
        JOIN routes r ON st.route_id = r.id
        WHERE r.shuttle_id = $1
        ORDER BY st.stop_order ASC
        LIMIT 1
      `, [shuttleId]);

      if (firstStopRes.rows.length > 0) {
        const firstStop = firstStopRes.rows[0];
        const targetLat = firstStop.lat;
        const targetLng = firstStop.lng;
        const radiusMeters = 250; // 250 metre varış çiti

        const R = 6371e3;
        const phi1 = lat * Math.PI / 180;
        const phi2 = targetLat * Math.PI / 180;
        const deltaPhi = (targetLat - lat) * Math.PI / 180;
        const deltaLambda = (targetLng - lng) * Math.PI / 180;
        const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c;

        // Başlangıç noktasından ne kadar uzaklaştı?
        let distanceFromStart = 9999;
        if (trip && trip.start_lat && trip.start_lng) {
          const sPhi1 = lat * Math.PI / 180;
          const sPhi2 = parseFloat(trip.start_lat) * Math.PI / 180;
          const sDPhi = (parseFloat(trip.start_lat) - lat) * Math.PI / 180;
          const sDLam = (parseFloat(trip.start_lng) - lng) * Math.PI / 180;
          const sA = Math.sin(sDPhi/2) * Math.sin(sDPhi/2) +
                     Math.cos(sPhi1) * Math.cos(sPhi2) *
                     Math.sin(sDLam/2) * Math.sin(sDLam/2);
          distanceFromStart = R * 2 * Math.atan2(Math.sqrt(sA), Math.sqrt(1-sA));
        }

        // Sefer en az 3 dakika sürmüş olmalı, başlangıç noktasından en az 250m uzaklaşmış olmalı ve hedef çite girmeli
        const hasActuallyTraveled = distanceFromStart > 250;
        if (distance <= radiusMeters && tripSeconds >= 180 && hasActuallyTraveled) {
          arrived = true;
          reachedStopName = firstStop.stop_name || 'Sabahki 1. Durak';
          await pool.query("UPDATE shuttles SET current_status = 'completed' WHERE id = $1", [shuttleId]);

          if (trip) {
            await pool.query(`
              UPDATE service_trips 
              SET end_time = NOW(),
                  duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - start_time)) / 60)),
                  end_lat = $1, end_lng = $2,
                  status = 'completed',
                  end_reason = 'arrived_geofence'
            WHERE id = $3
            `, [lat, lng, trip.id]);

            // Durak loglarına akşam son bırakma durağını kaydet
            await pool.query(`
              INSERT INTO trip_stop_logs (
                trip_id, shuttle_id, company_id, stop_order, stop_name,
                trip_type, planned_eta, reached_at, delay_minutes
              ) VALUES ($1, $2, $3, $4, $5, 'evening', $6, NOW(), 0)
            `, [trip.id, shuttleId, shuttle.company_id, 99, reachedStopName, firstStop.eta_time || 'Varış']);
          }
        }
      }
    } 
    // 2. SABAH TOPLAMA SEFERİ: Hedef Fabrika / Okul varış noktası
    else if (workplace) {
      const targetLat = workplace.workplace_lat;
      const targetLng = workplace.workplace_lng;
      const radiusMeters = Math.max(workplace.geofence_radius_meters || 250, 250);

      const R = 6371e3;
      const phi1 = lat * Math.PI / 180;
      const phi2 = targetLat * Math.PI / 180;
      const deltaPhi = (targetLat - lat) * Math.PI / 180;
      const deltaLambda = (targetLng - lng) * Math.PI / 180;
      const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
                Math.cos(phi1) * Math.cos(phi2) *
                Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;

      // Başlangıç noktasından ne kadar uzaklaştı?
      let distanceFromStart = 9999;
      if (trip && trip.start_lat && trip.start_lng) {
        const sPhi1 = lat * Math.PI / 180;
        const sPhi2 = parseFloat(trip.start_lat) * Math.PI / 180;
        const sDPhi = (parseFloat(trip.start_lat) - lat) * Math.PI / 180;
        const sDLam = (parseFloat(trip.start_lng) - lng) * Math.PI / 180;
        const sA = Math.sin(sDPhi/2) * Math.sin(sDPhi/2) +
                   Math.cos(sPhi1) * Math.cos(sPhi2) *
                   Math.sin(sDLam/2) * Math.sin(sDLam/2);
        distanceFromStart = R * 2 * Math.atan2(Math.sqrt(sA), Math.sqrt(1-sA));
      }

      // Sefer en az 3 dakika sürmüş olmalı, başlangıç yerinden en az 250m hareket etmiş olmalı ve varış çitine girmeli
      const hasActuallyTraveled = distanceFromStart > 250;
      if (distance <= radiusMeters && tripSeconds >= 180 && hasActuallyTraveled) {
        arrived = true;
        reachedStopName = workplace.workplace_name;
        await pool.query("UPDATE shuttles SET current_status = 'arrived' WHERE id = $1", [shuttleId]);

        if (trip) {
          await pool.query(`
            UPDATE service_trips 
            SET end_time = NOW(),
                duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - start_time)) / 60)),
                end_lat = $1, end_lng = $2,
                status = 'completed',
                end_reason = 'arrived_geofence'
            WHERE id = $3
          `, [lat, lng, trip.id]);

          // Durak loglarına sabah fabrika varışını kaydet
          await pool.query(`
            INSERT INTO trip_stop_logs (
              trip_id, shuttle_id, company_id, stop_order, stop_name,
              trip_type, planned_eta, reached_at, delay_minutes
            ) VALUES ($1, $2, $3, $4, $5, 'morning', $6, NOW(), 0)
          `, [trip.id, shuttleId, shuttle.company_id, 99, reachedStopName, 'Varış']);
        }
      }
    }

    res.json({
      success: true,
      arrived,
      trip_type: trip_type || 'morning',
      reached_stop_name: reachedStopName,
      workplace_name: workplace ? workplace.workplace_name : null,
      operation_type: workplace ? workplace.operation_type : 'personnel'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Şoförün seferi manuel olarak bitirmesi ("Seferi Bitir" butonu)
app.post('/api/shuttle/:shuttleId/finish-trip', async (req, res) => {
  const { shuttleId } = req.params;
  const { trip_type } = req.body;
  try {
    const updateRes = await pool.query(`
      UPDATE shuttles 
      SET current_status = 'completed'
      WHERE id = $1
      RETURNING *
    `, [shuttleId]);

    // Aktif sefer kaydını kapat ve süreyi kaydet
    await pool.query(`
      UPDATE service_trips 
      SET end_time = NOW(),
          duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - start_time)) / 60)),
          status = 'completed',
          end_reason = 'driver_manual_end'
      WHERE shuttle_id = $1 AND status = 'in_progress'
    `, [shuttleId]);

    res.json({
      success: true,
      message: 'Sefer başarıyla tamamlandı ve sefer günlüğüne kaydedildi.',
      trip_type: trip_type || 'morning',
      shuttle: updateRes.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Şoförün yanlışlıkla bitirdiği seferi tekrar açması ("Seferi Tekrar Aç" butonu)
app.post('/api/shuttle/:shuttleId/reopen-trip', async (req, res) => {
  const { shuttleId } = req.params;
  const { trip_type } = req.body;
  try {
    const updateRes = await pool.query(`
      UPDATE shuttles 
      SET current_status = 'running'
      WHERE id = $1
      RETURNING *
    `, [shuttleId]);

    // Bugünün son tamamlanan seferini bul ve tekrar in_progress durumuna çek
    const lastTripRes = await pool.query(`
      SELECT * FROM service_trips 
      WHERE shuttle_id = $1 AND trip_date = CURRENT_DATE
      ORDER BY id DESC LIMIT 1
    `, [shuttleId]);

    if (lastTripRes.rows.length > 0 && lastTripRes.rows[0].status === 'completed') {
      await pool.query(`
        UPDATE service_trips 
        SET status = 'in_progress', end_time = NULL, end_reason = NULL
        WHERE id = $1
      `, [lastTripRes.rows[0].id]);
    }

    res.json({
      success: true,
      message: 'Sefer başarıyla yeniden açıldı ve canlı takibe alındı.',
      trip_type: trip_type || 'morning',
      shuttle: updateRes.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Şoförün canlı konumu durdurması durumunda statü güncelleme
app.post('/api/shuttle/:shuttleId/status', async (req, res) => {
  const { shuttleId } = req.params;
  const { status } = req.body;
  try {
    const updateRes = await pool.query(`
      UPDATE shuttles 
      SET current_status = $1
      WHERE id = $2
      RETURNING *
    `, [status || 'idle', shuttleId]);

    // Eğer durduruldu veya bittiyse aktif sefer kaydını tamamla
    if (status === 'idle' || status === 'completed') {
      await pool.query(`
        UPDATE service_trips 
        SET end_time = NOW(),
            duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - start_time)) / 60)),
            status = 'completed',
            end_reason = 'status_stopped'
        WHERE shuttle_id = $1 AND status = 'in_progress'
      `, [shuttleId]);
    }

    res.json({
      success: true,
      status: status || 'idle',
      shuttle: updateRes.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Durak geçildiğinde sefer kaydına durak sayacı ve durak logu ekleme
app.post('/api/shuttle/:shuttleId/stop-passed', async (req, res) => {
  const { shuttleId } = req.params;
  const { stop_order, stop_name, stop_id, planned_eta, trip_type } = req.body;
  try {
    // Aktif sefer kaydını bul
    const tripRes = await pool.query(`
      SELECT * FROM service_trips 
      WHERE shuttle_id = $1 AND status = 'in_progress'
      ORDER BY start_time DESC LIMIT 1
    `, [shuttleId]);

    let delayMinutes = 0;
    if (planned_eta && planned_eta.includes(':')) {
      const now = new Date();
      const [plannedH, plannedM] = planned_eta.split(':').map(Number);
      const currentMinsTotal = now.getHours() * 60 + now.getMinutes();
      const plannedMinsTotal = plannedH * 60 + plannedM;
      delayMinutes = currentMinsTotal - plannedMinsTotal;
    }

    if (tripRes.rows.length > 0) {
      const trip = tripRes.rows[0];
      await pool.query(`
        UPDATE service_trips 
        SET stops_visited = stops_visited + 1
        WHERE id = $1
      `, [trip.id]);

      // Mükerrerliği önleyerek durak logu kaydet
      const existingLog = await pool.query(`
        SELECT id FROM trip_stop_logs 
        WHERE trip_id = $1 AND (stop_order = $2 OR stop_name = $3)
        LIMIT 1
      `, [trip.id, stop_order || 1, stop_name]);

      if (existingLog.rows.length === 0) {
        await pool.query(`
          INSERT INTO trip_stop_logs (
            trip_id, shuttle_id, company_id, stop_id, stop_order,
            stop_name, trip_type, planned_eta, reached_at, delay_minutes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
        `, [
          trip.id, shuttleId, trip.company_id, stop_id || null,
          stop_order || 1, stop_name || 'Durak',
          trip.trip_type || trip_type || 'morning',
          planned_eta || null, delayMinutes
        ]);
      }
    } else {
      const sRes = await pool.query('SELECT company_id FROM shuttles WHERE id = $1', [shuttleId]);
      const compId = sRes.rows.length > 0 ? sRes.rows[0].company_id : 1;
      await pool.query(`
        INSERT INTO trip_stop_logs (
          trip_id, shuttle_id, company_id, stop_id, stop_order,
          stop_name, trip_type, planned_eta, reached_at, delay_minutes
        ) VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, NOW(), $8)
      `, [
        shuttleId, compId, stop_id || null, stop_order || 1,
        stop_name || 'Durak', trip_type || 'morning',
        planned_eta || null, delayMinutes
      ]);
    }

    res.json({ success: true, stop_order, stop_name, delay_minutes: delayMinutes });
  } catch (err) {
    console.error('Stop passed error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Şirket Sefer Geçmişi ve Günlük Raporlama API'si (Yıllık / Aylık / Günlük + Durak Logları)
app.get('/api/company/:companyId/trips', async (req, res) => {
  const { companyId } = req.params;
  const { date, shuttleId, tripType, range } = req.query;

  try {
    let conditions = ['t.company_id = $1'];
    let params = [companyId];

    if (date && date !== 'all') {
      params.push(date);
      conditions.push(`t.trip_date = $${params.length}`);
    } else if (range === 'week') {
      conditions.push(`t.trip_date >= CURRENT_DATE - INTERVAL '7 days'`);
    } else if (range === 'month') {
      conditions.push(`t.trip_date >= CURRENT_DATE - INTERVAL '30 days'`);
    } else if (range === 'year') {
      conditions.push(`t.trip_date >= CURRENT_DATE - INTERVAL '365 days'`);
    }

    if (shuttleId && shuttleId !== 'all') {
      params.push(shuttleId);
      conditions.push(`t.shuttle_id = $${params.length}`);
    }

    if (tripType && tripType !== 'all') {
      params.push(tripType);
      conditions.push(`t.trip_type = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const tripsRes = await pool.query(`
      SELECT t.*,
             to_char(t.trip_date, 'DD.MM.YYYY') as date_formatted,
             to_char(t.start_time, 'HH24:MI:SS') as start_time_formatted,
             to_char(t.end_time, 'HH24:MI:SS') as end_time_formatted
      FROM service_trips t
      ${whereClause}
      ORDER BY t.start_time DESC
      LIMIT 300
    `, params);

    const trips = tripsRes.rows;

    // Seferlerin durak giriş çizelgesini (stop_logs) ekle
    if (trips.length > 0) {
      const tripIds = trips.map(t => t.id);
      const stopLogsRes = await pool.query(`
        SELECT sl.*,
               to_char(sl.reached_at, 'HH24:MI:SS') as reached_time_formatted
        FROM trip_stop_logs sl
        WHERE sl.trip_id = ANY($1::int[])
        ORDER BY sl.stop_order ASC, sl.reached_at ASC
      `, [tripIds]);

      const logMap = {};
      stopLogsRes.rows.forEach(log => {
        if (!logMap[log.trip_id]) logMap[log.trip_id] = [];
        logMap[log.trip_id].push(log);
      });

      trips.forEach(t => {
        t.stop_logs = logMap[t.id] || [];
      });
    }

    // İstatistikler (KPI)
    const statsRes = await pool.query(`
      SELECT 
        COUNT(*) as total_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as active_count,
        COALESCE(ROUND(AVG(CASE WHEN status = 'completed' THEN duration_minutes END)), 0) as avg_duration_mins,
        COALESCE(SUM(passenger_count), 0) as total_passengers
      FROM service_trips t
      ${whereClause}
    `, params);

    res.json({
      success: true,
      trips,
      stats: statsRes.rows[0] || {
        total_count: 0,
        completed_count: 0,
        active_count: 0,
        avg_duration_mins: 0,
        total_passengers: 0
      }
    });
  } catch (err) {
    console.error('Trips list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Firma Sahipleri / İK İçin: Günde Ortalama Hangi Durağa Kaçta Giriliyor Analizi API'si
app.get('/api/company/:companyId/stop-averages', async (req, res) => {
  const { companyId } = req.params;
  const { shuttleId, tripType } = req.query;
  try {
    let conditions = ['sl.company_id = $1'];
    let params = [parseInt(companyId)];

    if (shuttleId && shuttleId !== 'all') {
      params.push(parseInt(shuttleId));
      conditions.push(`sl.shuttle_id = $${params.length}`);
    }
    if (tripType && tripType !== 'all') {
      params.push(tripType);
      conditions.push(`sl.trip_type = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');

    const avgRes = await pool.query(`
      SELECT 
        sl.stop_name,
        sl.stop_order,
        sl.planned_eta,
        sl.trip_type,
        COUNT(sl.id) as sample_count,
        ROUND(AVG(EXTRACT(EPOCH FROM sl.reached_at::time))) as avg_seconds,
        ROUND(AVG(sl.delay_minutes)) as avg_delay_minutes,
        MAX(sl.reached_at) as last_reached_at
      FROM trip_stop_logs sl
      WHERE ${whereClause}
      GROUP BY sl.stop_name, sl.stop_order, sl.planned_eta, sl.trip_type
      ORDER BY sl.trip_type, sl.stop_order ASC
    `, params);

    const formatted = avgRes.rows.map(row => {
      const totalSecs = parseInt(row.avg_seconds) || 0;
      const hours = Math.floor(totalSecs / 3600).toString().padStart(2, '0');
      const mins = Math.floor((totalSecs % 3600) / 60).toString().padStart(2, '0');
      return {
        ...row,
        avg_arrival_time: `${hours}:${mins}`,
        last_date_formatted: row.last_reached_at ? new Date(row.last_reached_at).toLocaleDateString('tr-TR') : '-'
      };
    });

    res.json({ success: true, averages: formatted });
  } catch (err) {
    console.error('Stop averages error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Şoför kokpiti için en güncel servis, sefer saatleri, güzergah ve yolcu senkronizasyonu
app.get('/api/shuttle/:shuttleId/sync', async (req, res) => {
  const { shuttleId } = req.params;
  try {
    const shuttleRes = await pool.query(`
      SELECT s.*, 
             c.company_name, c.workplace_name, c.workplace_lat, c.workplace_lng, c.geofence_radius_meters, c.operation_type
      FROM shuttles s
      JOIN companies c ON s.company_id = c.id
      WHERE s.id = $1
    `, [shuttleId]);

    if (shuttleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Servis bulunamadı' });
    }

    const shuttle = shuttleRes.rows[0];

    // Yolcuları getir
    const passRes = await pool.query(`
      SELECT e.*, st.stop_name, st.stop_order, st.eta_time
      FROM employees e
      LEFT JOIN stops st ON e.stop_id = st.id
      WHERE e.shuttle_id = $1
      ORDER BY COALESCE(st.stop_order, 999) ASC, e.id ASC
    `, [shuttleId]);

    // Servise ait rotayı ve durakları getir
    const routeRes = await pool.query(`
      SELECT * FROM routes WHERE shuttle_id = $1 ORDER BY id DESC LIMIT 1
    `, [shuttleId]);

    let stops = [];
    if (routeRes.rows.length > 0) {
      const stopsRes = await pool.query(`
        SELECT * FROM stops WHERE route_id = $1 ORDER BY stop_order ASC
      `, [routeRes.rows[0].id]);
      stops = stopsRes.rows;
    }

    res.json({
      success: true,
      shuttle,
      passengers: passRes.rows,
      route: routeRes.rows[0] || null,
      stops: stops
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Admin veya personelin şoförün anlık konumunu çekmesi (Server -> Dashboard)
app.get('/api/shuttle/:shuttleId/location', async (req, res) => {
  const { shuttleId } = req.params;
  try {
    const resRow = await pool.query(`
      SELECT s.id, s.plate, s.last_lat, s.last_lng, s.current_status, s.driver_name, s.shift_start_time, s.return_time
      FROM shuttles s
      WHERE s.id = $1
    `, [shuttleId]);

    if (resRow.rows.length === 0) {
      return res.status(404).json({ error: 'Servis bulunamadı.' });
    }

    res.json({ success: true, shuttle: resRow.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Firmanın tüm servislerinin canlı konumlarını toplu getirme (Haritada "Araçlar Nerede" görünümü için)
app.get('/api/company/:companyId/shuttles/live-locations', async (req, res) => {
  const { companyId } = req.params;
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (s.id)
             s.id, s.plate, s.model, s.driver_name, s.driver_phone, 
             s.shift_start_time, s.return_time, 
             CASE 
               WHEN s.current_status = 'running' AND (s.last_location_time IS NULL OR s.last_location_time < NOW() - INTERVAL '75 seconds') THEN 'idle'
               ELSE s.current_status 
             END as current_status,
             s.last_lat, s.last_lng, s.last_location_time,
             r.id as route_id, r.route_name
      FROM shuttles s
      LEFT JOIN routes r ON r.shuttle_id = s.id
      WHERE s.company_id = $1
      ORDER BY s.id ASC
    `, [companyId]);

    res.json({ success: true, shuttles: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Şoför Mobil Uygulaması: Giriş (Kullanıcı Adı/Plaka + Şifre)
app.post('/api/driver/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı/plaka ve şifre zorunludur.' });
  }

  const cleanUser = username.trim().toUpperCase().replace(/\s+/g, '');
  try {
    const shuttleRes = await pool.query(`
      SELECT s.*, 
             c.company_name, c.workplace_name, c.workplace_lat, c.workplace_lng, c.geofence_radius_meters, c.operation_type
      FROM shuttles s
      JOIN companies c ON s.company_id = c.id
      WHERE (UPPER(REPLACE(s.driver_username, ' ', '')) = $1 
         OR UPPER(REPLACE(s.plate, ' ', '')) = $1 
         OR s.driver_phone = $1)
        AND s.driver_password = $2
    `, [cleanUser, password.trim()]);

    let shuttle = null;

    if (shuttleRes.rows.length > 0) {
      shuttle = shuttleRes.rows[0];
    } else {
      // 2. Yol: Personel / Şoför olarak employees tablosunda kayıtlı mı kontrol et
      const empRes = await pool.query(`
        SELECT e.*, s.id as shuttle_id
        FROM employees e
        JOIN shuttles s ON e.shuttle_id = s.id
        WHERE (UPPER(REPLACE(e.login_id, ' ', '')) = $1 OR e.phone = $1)
          AND e.login_pass = $2
      `, [cleanUser, password.trim()]);

      if (empRes.rows.length > 0 && empRes.rows[0].shuttle_id) {
        const foundShuttleId = empRes.rows[0].shuttle_id;
        const matchedShuttleRes = await pool.query(`
          SELECT s.*, 
                 c.company_name, c.workplace_name, c.workplace_lat, c.workplace_lng, c.geofence_radius_meters, c.operation_type
          FROM shuttles s
          JOIN companies c ON s.company_id = c.id
          WHERE s.id = $1
        `, [foundShuttleId]);

        if (matchedShuttleRes.rows.length > 0) {
          shuttle = matchedShuttleRes.rows[0];
        }
      }
    }

    if (!shuttle) {
      return res.status(401).json({ error: 'Hatalı kullanıcı adı, personel ID, plaka veya şifre girdiniz.' });
    }

    // Bu araca atanan yolcuları / personelleri / öğrencileri biniş duraklarıyla çek
    const passRes = await pool.query(`
      SELECT e.*, st.stop_name, st.stop_order, st.eta_time
      FROM employees e
      LEFT JOIN stops st ON e.stop_id = st.id
      WHERE e.shuttle_id = $1
      ORDER BY COALESCE(st.stop_order, 999) ASC, e.id ASC
    `, [shuttle.id]);

    res.json({
      success: true,
      shuttle,
      passengers: passRes.rows
    });
  } catch (err) {
    console.error('Driver login error:', err);
    res.status(500).json({ error: 'Giriş sırasında hata oluştu: ' + err.message });
  }
});

// Şoförün aracına atanan yolcuları getirme
app.get('/api/shuttle/:shuttleId/passengers', async (req, res) => {
  const { shuttleId } = req.params;
  try {
    const passRes = await pool.query(`
      SELECT e.*, st.stop_name, st.stop_order, st.eta_time
      FROM employees e
      LEFT JOIN stops st ON e.stop_id = st.id
      WHERE e.shuttle_id = $1
      ORDER BY COALESCE(st.stop_order, 999) ASC, e.id ASC
    `, [shuttleId]);

    res.json({ success: true, passengers: passRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Şoförün yolcuyu 'Servise Bindi' / 'Binmedi' olarak işaretlemesi
app.post('/api/shuttle/:shuttleId/passengers/:passengerId/status', async (req, res) => {
  const { shuttleId, passengerId } = req.params;
  const { status } = req.body; // 'boarded' | 'waiting' | 'absent'

  try {
    const updateRes = await pool.query(`
      UPDATE employees
      SET status = $1
      WHERE id = $2 AND shuttle_id = $3
      RETURNING *
    `, [status || 'boarded', passengerId, shuttleId]);

    res.json({ success: true, passenger: updateRes.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- WEB PUSH BİLDİRİM API'LERİ (TELEFON EKRANI KAPALIYKEN VE UYGULAMA DIŞINDAYKEN BİLDİRİM) ---

// 1. Tarayıcının Push kaydı yapabilmesi için Public Key'i döndür
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

// 2. Şoförün telefonundaki Push Subscription'ı veritabanına kaydet
app.post('/api/push/subscribe', async (req, res) => {
  const { shuttleId, subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Geçersiz subscription objesi' });
  }

  try {
    const endpoint = subscription.endpoint;
    const p256dh = subscription.keys ? subscription.keys.p256dh : '';
    const auth = subscription.keys ? subscription.keys.auth : '';

    await pool.query(`
      INSERT INTO push_subscriptions (shuttle_id, endpoint, p256dh, auth, user_agent)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (endpoint) DO UPDATE 
      SET shuttle_id = EXCLUDED.shuttle_id,
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          last_notified_at = NOW()
    `, [shuttleId || null, endpoint, p256dh, auth, req.headers['user-agent'] || 'Mobile Browser']);

    res.json({ success: true, message: 'Push subscription başarıyla kaydedildi.' });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Şoförün telefonu kilitliyken anında test bildirimi gönder (Ekranı kilitleyip test edebilmesi için)
app.post('/api/push/test', async (req, res) => {
  const { shuttleId, delaySeconds = 5 } = req.body;
  try {
    const subsRes = await pool.query(`
      SELECT * FROM push_subscriptions 
      WHERE shuttle_id = $1 
      ORDER BY id DESC LIMIT 5
    `, [shuttleId]);

    if (subsRes.rows.length === 0) {
      return res.status(404).json({ error: 'Bu araca ait kayıtlı push aboneliği bulunamadı. Lütfen önce bildirim iznini verin.' });
    }

    // Kullanıcı ekranı kilitleyebilsin diye delay kadar asenkron bekle (Vercel serverless ortamında donmayı önler)
    const delayMs = Math.min(Math.max((parseInt(delaySeconds) || 5), 1), 8) * 1000;
    await new Promise(resolve => setTimeout(resolve, delayMs));

    const payload = JSON.stringify({
      title: '🔔 Servis360 Canlı Test Bildirimi',
      body: 'Harika! Telefon ekranınız kapalıyken bile sefer bildirimi başarıyla çalışıyor. Canlı yayını başlatmak için dokunun.',
      url: '/driver.html?autostart=1',
      tag: 'test-push-notification'
    });

    let sentCount = 0;
    for (const sub of subsRes.rows) {
      try {
        const pushConfig = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        };
        await webpush.sendNotification(pushConfig, payload);
        sentCount++;
      } catch (e) {
        console.warn('Push gönderim hatası:', e.message);
      }
    }

    res.json({
      success: true,
      sentCount,
      message: `${delaySeconds} saniye sonra test bildirimi telefonunuza gönderildi (${sentCount} cihaza iletildi).`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Firma için bildirim izni vermiş aktif cihazlar listesi
app.get('/api/company/:companyId/push-devices', async (req, res) => {
  const { companyId } = req.params;
  try {
    const r = await pool.query(`
      SELECT ps.id, ps.shuttle_id, s.plate, s.driver_name, ps.user_agent, 
             ps.last_notified_at, ps.created_at
      FROM push_subscriptions ps
      JOIN shuttles s ON ps.shuttle_id = s.id
      WHERE s.company_id = $1
      ORDER BY ps.id DESC
    `, [parseInt(companyId)]);
    res.json({ success: true, devices: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Şirket sahibinin kokpitten bir şoförün telefonunu anında çaldırması / bildirim göndermesi
app.post('/api/push/send-to-shuttle/:shuttleId', async (req, res) => {
  const { shuttleId } = req.params;
  const { title, body } = req.body;
  try {
    const subsRes = await pool.query('SELECT * FROM push_subscriptions WHERE shuttle_id = $1', [parseInt(shuttleId)]);
    if (subsRes.rows.length === 0) {
      return res.status(404).json({ error: 'Bu araca ait aktif bildirim izni verilmiş cihaz bulunamadı.' });
    }
    const payload = JSON.stringify({
      title: title || '🔔 Servis360 Bildirimi',
      body: body || 'Firma yönetimi tarafından gönderildi.',
      url: '/driver.html'
    });
    let sent = 0;
    for (const sub of subsRes.rows) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, payload);
        sent++;
      } catch (e) {
        console.warn('Push hatası:', e.message);
      }
    }
    res.json({ success: true, message: `${sent} adet cihaza bildirim iletildi.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. OTOMATİK SEFER SAATİ ARKA PLAN ZAMANLAYICISI & CRON ENDPOINT'I
// Türkiye saati (Europe/Istanbul) kullanarak saatleri kontrol eder. Vercel ve local ortamlarda çalışır.
async function runShiftCheckAndNotify() {
  try {
    const formatter = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const currentTimeStr = formatter.format(new Date());

    const [curH, curM] = currentTimeStr.split(':').map(Number);
    const curMinutes = curH * 60 + curM;

    const shuttlesRes = await pool.query(`
      SELECT s.*, c.company_name, c.workplace_name
      FROM shuttles s
      JOIN companies c ON s.company_id = c.id
    `);

    let sentNotifications = [];

    for (const shuttle of shuttlesRes.rows) {
      if (!shuttle.shift_start_time && !shuttle.return_time) continue;

      const mornMin = shuttle.shift_start_time ? (parseInt(shuttle.shift_start_time.split(':')[0]) * 60 + parseInt(shuttle.shift_start_time.split(':')[1])) : null;
      const eveMin = shuttle.return_time ? (parseInt(shuttle.return_time.split(':')[0]) * 60 + parseInt(shuttle.return_time.split(':')[1])) : null;

      let matchedMode = null;
      // Saat toleransı: tam o dakika veya son 4 dakika içinde (örneğin 10:23 için 10:23 - 10:27 arası)
      if (mornMin !== null && curMinutes >= mornMin && curMinutes <= mornMin + 4) {
        matchedMode = 'morning';
      } else if (eveMin !== null && curMinutes >= eveMin && curMinutes <= eveMin + 4) {
        matchedMode = 'evening';
      }

      if (!matchedMode) continue;

      // 1. Eğer araç gerçekten son 60 saniyede canlı sinyal gönderiyorsa bildirim atma (şoför zaten uygulamayı açmış)
      const isActivelyBroadcasting = shuttle.current_status === 'running' && shuttle.last_location_time && (Date.now() - new Date(shuttle.last_location_time).getTime() < 60000);
      if (isActivelyBroadcasting) continue;

      // 2. Bugünün bu seferi (sabah veya akşam) zaten tamamlanmış mı kontrol et
      const todayDoneTrip = await pool.query(`
        SELECT id FROM service_trips 
        WHERE shuttle_id = $1 AND trip_date = CURRENT_DATE AND trip_type = $2 AND status = 'completed'
        LIMIT 1
      `, [shuttle.id, matchedMode]);
      if (todayDoneTrip.rows.length > 0) continue;

      const tripLabel = matchedMode === 'evening' ? 'Akşam Dönüş (Dağıtım)' : 'Sabah Toplama';
      const scheduledTimeStr = matchedMode === 'evening' ? shuttle.return_time : shuttle.shift_start_time;

      // Son 3 dakikada bildirim atılmamış cihazları bul
      const subsRes = await pool.query(`
        SELECT * FROM push_subscriptions 
        WHERE shuttle_id = $1 
          AND (last_notified_at IS NULL OR last_notified_at < NOW() - INTERVAL '3 minutes')
      `, [shuttle.id]);

      if (subsRes.rows.length > 0) {
        const payload = JSON.stringify({
          title: `⏰ ${shuttle.plate}: ${tripLabel} Saati Geldi!`,
          body: `Planlanan saat: ${scheduledTimeStr}. Canlı GPS yayını başlatmak için dokunun.`,
          url: `/driver.html?autostart=1&mode=${matchedMode}`,
          trip_mode: matchedMode
        });

        for (const sub of subsRes.rows) {
          try {
            const pushConfig = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth }
            };
            await webpush.sendNotification(pushConfig, payload, { TTL: 60, urgency: 'high' });
            await pool.query('UPDATE push_subscriptions SET last_notified_at = NOW() WHERE id = $1', [sub.id]);
            sentNotifications.push({ plate: shuttle.plate, mode: matchedMode, subId: sub.id });
            console.log(`📡 [Web Push] ${shuttle.plate} (${tripLabel}) bildirimi başarıyla gönderildi!`);
          } catch (e) {
            console.warn(`Push gönderilemedi (${sub.id}):`, e.message);
            if (e.statusCode === 410 || e.statusCode === 404) {
              await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
            }
          }
        }
      }
    }

    return {
      success: true,
      timeZone: 'Europe/Istanbul',
      currentTime: currentTimeStr,
      sentCount: sentNotifications.length,
      notifications: sentNotifications
    };
  } catch (err) {
    console.error('runShiftCheckAndNotify error:', err);
    return { success: false, error: err.message };
  }
}

// Hem Vercel Serverless hem de şirket paneli tarafından tetiklenebilen cron endpoint'i
app.all('/api/cron/check-shifts', async (req, res) => {
  const result = await runShiftCheckAndNotify();
  res.json(result);
});

// Sürekli çalışan sunucu için yerel interval (20 saniyede bir kontrol)
setInterval(runShiftCheckAndNotify, 20000);

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servis360 HTTP Sunucusu http://localhost:${PORT} (ve ağda http://192.168.3.18:${PORT}) üzerinde aktif!`);
  });

  (async () => {
    try {
      const https = require('https');
      const selfsigned = require('selfsigned');
      const pems = await selfsigned.generate([{ name: 'commonName', value: '192.168.3.18' }], { days: 365 });
      const HTTPS_PORT = 4174;
      https.createServer({ key: pems.private, cert: pems.cert }, app).listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`🔒 Servis360 Güvenli HTTPS Sunucusu https://192.168.3.18:${HTTPS_PORT} üzerinde aktif (Mobil Bildirimler & PWA İçin)!`);
      });
    } catch (sslErr) {
      console.warn('HTTPS başlatılamadı:', sslErr.message);
    }
  })();
}

module.exports = app;
