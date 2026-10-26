const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ipujjwfhdsxusgwnjhnc:5bT5YVLNVwutR2tW@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Doğa Koleji öğrenci ve okul servisi verileri hazırlanıyor...');

    // 1. Şirket güncelle: Doğa Koleji Çamlıca Kampüsü
    await client.query(`
      UPDATE companies 
      SET 
        company_name = 'Doğa Koleji Çamlıca Kampüsü',
        operation_type = 'school',
        service_type = 'portal',
        workplace_name = 'Doğa Koleji Çamlıca Ana Kampüs',
        workplace_lat = 41.0280,
        workplace_lng = 29.0680,
        geofence_radius_meters = 150
      WHERE id = 4
    `);

    // 2. Servis Aracı Ekle
    const shuttleRes = await client.query(`
      INSERT INTO shuttles 
      (company_id, plate, model, capacity, driver_name, driver_phone, shift_start_time, current_status)
      VALUES 
      (4, '34 OKL 789', 'Mercedes Sprinter (Okul Paketi)', 24, 'Hasan Şentürk', '0533 456 78 90', '07:15', 'waiting')
      RETURNING id
    `);
    const shuttleId = shuttleRes.rows[0].id;

    // 3. OSRM API ile gerçek yol rotasını çek
    // Durak 1: Kadıköy Rıhtım (40.9915, 29.0260)
    // Durak 2: Bağlarbaşı Üsküdar (41.0210, 29.0430)
    // Hedef: Çamlıca Okul (41.0280, 29.0680)
    let roadGeometry = [];
    let distanceKm = 6.4;
    let durationMins = 18;

    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/29.0260,40.9915;29.0430,41.0210;29.0680,41.0280?overview=full&geometries=geojson`;
      const res = await fetch(osrmUrl);
      const data = await res.json();
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        roadGeometry = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        distanceKm = (data.routes[0].distance / 1000).toFixed(1);
        durationMins = Math.round(data.routes[0].duration / 60);
        console.log(`OSRM yol motorundan gerçek virajlı güzergah başarıyla alındı: ${distanceKm} km, ~${durationMins} dk`);
      }
    } catch (e) {
      console.warn('OSRM hatası, varsayılan noktalar atanıyor:', e.message);
    }

    // 4. Rota Ekle
    const routeRes = await client.query(`
      INSERT INTO routes 
      (company_id, shuttle_id, route_name, color, road_geometry, total_distance_km, total_duration_mins)
      VALUES 
      (4, $1, 'Kadıköy - Üsküdar - Çamlıca Okul Hattı', '#3b82f6', $2, $3, $4)
      RETURNING id
    `, [shuttleId, JSON.stringify(roadGeometry), distanceKm, durationMins]);
    const routeId = routeRes.rows[0].id;

    // 5. Durakları Ekle
    const stop1 = await client.query(`
      INSERT INTO stops (route_id, stop_name, stop_order, lat, lng, eta_time)
      VALUES ($1, '1. Durak - Kadıköy Rıhtım (Kalkış)', 1, 40.9915, 29.0260, '07:15')
      RETURNING id
    `, [routeId]);

    const stop2 = await client.query(`
      INSERT INTO stops (route_id, stop_name, stop_order, lat, lng, eta_time)
      VALUES ($1, '2. Durak - Altunizade / Bağlarbaşı', 2, 41.0210, 29.0430, '07:30')
      RETURNING id
    `, [routeId]);

    // 6. Öğrencileri & Velileri Ekle
    await client.query(`DELETE FROM employees WHERE company_id = 4`);

    await client.query(`
      INSERT INTO employees 
      (company_id, shuttle_id, stop_id, full_name, passenger_type, student_class, student_number, parent_name, parent_phone, parent_relation, status)
      VALUES 
      (4, $1, $2, 'Efe Can Kaya', 'student', '6-A', '182', 'Murat Kaya', '0532 111 22 33', 'Baba', 'waiting'),
      (4, $1, $3, 'Zeynep Defne Demir', 'student', '4-C', '304', 'Ayşe Demir', '0533 555 44 22', 'Anne', 'waiting'),
      (4, $1, $3, 'Kaan Yıldırım', 'student', '7-B', '512', 'Bülent Yıldırım', '0542 987 65 43', 'Baba', 'waiting')
    `, [shuttleId, stop1.rows[0].id, stop2.rows[0].id]);

    console.log('Doğa Koleji Okul & Öğrenci Servisi verileri başarıyla oluşturuldu!');
  } catch (err) {
    console.error('Seed hatası:', err);
  } finally {
    client.release();
    pool.end();
  }
}

seed();
