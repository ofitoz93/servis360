const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 4173;

const connectionString = 'postgresql://postgres.ipujjwfhdsxusgwnjhnc:5bT5YVLNVwutR2tW@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

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
      SELECT s.id, s.plate, s.model, s.driver_name, s.driver_phone, s.shift_start_time, s.current_status,
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
      SET last_lat = $1, last_lng = $2, current_status = COALESCE($3, 'running')
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

        // Haversine hesaplama
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

        if (distance <= radiusMeters) {
          arrived = true;
          reachedStopName = firstStop.stop_name || 'Sabahki 1. Durak';
          await pool.query("UPDATE shuttles SET current_status = 'completed' WHERE id = $1", [shuttleId]);
        }
      }
    } 
    // 2. SABAH TOPLAMA SEFERİ: Hedef Fabrika / Okul varış noktası
    else if (workplace) {
      const targetLat = workplace.workplace_lat;
      const targetLng = workplace.workplace_lng;
      const radiusMeters = workplace.geofence_radius_meters || 180;

      // Haversine mesafe hesabı
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

      if (distance <= radiusMeters) {
        arrived = true;
        reachedStopName = workplace.workplace_name;
        await pool.query("UPDATE shuttles SET current_status = 'arrived' WHERE id = $1", [shuttleId]);
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

    res.json({
      success: true,
      message: 'Sefer başarıyla tamamlandı ve kapatıldı.',
      trip_type: trip_type || 'morning',
      shuttle: updateRes.rows[0]
    });
  } catch (err) {
    console.error(err);
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

    // Servise ait rotayı getir
    const routeRes = await pool.query(`
      SELECT * FROM routes WHERE shuttle_id = $1 ORDER BY id DESC LIMIT 1
    `, [shuttleId]);

    res.json({
      success: true,
      shuttle,
      passengers: passRes.rows,
      route: routeRes.rows[0] || null
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
      SELECT s.id, s.plate, s.last_lat, s.last_lng, s.current_status, s.driver_name, s.shift_start_time
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servis360 Sunucusu http://localhost:${PORT} üzerinde PostgreSQL ile aktif!`);
  });
}

module.exports = app;
