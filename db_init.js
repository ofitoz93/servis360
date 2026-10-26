const { Pool } = require('pg');

const connectionString = 'postgresql://postgres.ipujjwfhdsxusgwnjhnc:5bT5YVLNVwutR2tW@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDatabase() {
  console.log('PostgreSQL (Supabase) veritabanına bağlanılıyor...');
  const client = await pool.connect();
  try {
    console.log('Bağlantı başarılı! Tablolar oluşturuluyor...');

    await client.query(`
      -- Şirketler (Müşterilerimiz) Tablosu
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL,
        contact_person VARCHAR(100),
        contact_email VARCHAR(100) UNIQUE NOT NULL,
        contact_phone VARCHAR(50),
        workplace_name VARCHAR(255) DEFAULT 'Merkez Kampüs / Fabrika',
        workplace_lat DOUBLE PRECISION DEFAULT 41.1105,
        workplace_lng DOUBLE PRECISION DEFAULT 29.0225,
        geofence_radius_meters INT DEFAULT 180,
        package_type VARCHAR(50) DEFAULT 'Standard-50-Shuttle',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Kullanıcılar (Sistem Admini & Şirket Adminleri & Şoförler & Personeller)
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        company_id INT REFERENCES companies(id) ON DELETE CASCADE,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        phone VARCHAR(50),
        role VARCHAR(30) NOT NULL, -- 'superadmin', 'company_admin', 'driver', 'employee'
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Servis Araçları
      CREATE TABLE IF NOT EXISTS shuttles (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        plate VARCHAR(30) NOT NULL,
        model VARCHAR(100),
        capacity INT DEFAULT 24,
        driver_name VARCHAR(100),
        driver_phone VARCHAR(50),
        shift_start_time VARCHAR(10) DEFAULT '07:15',
        shift_end_time VARCHAR(10) DEFAULT '08:30',
        current_status VARCHAR(30) DEFAULT 'waiting', -- 'waiting', 'running', 'arrived'
        last_lat DOUBLE PRECISION,
        last_lng DOUBLE PRECISION,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Rotalar
      CREATE TABLE IF NOT EXISTS routes (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        shuttle_id INT REFERENCES shuttles(id) ON DELETE SET NULL,
        route_name VARCHAR(200) NOT NULL,
        color VARCHAR(20) DEFAULT '#3b82f6',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Duraklar
      CREATE TABLE IF NOT EXISTS stops (
        id SERIAL PRIMARY KEY,
        route_id INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        stop_name VARCHAR(200) NOT NULL,
        stop_order INT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        eta_time VARCHAR(10),
        is_workplace_destination BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Personeller
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        shuttle_id INT REFERENCES shuttles(id) ON DELETE SET NULL,
        stop_id INT REFERENCES stops(id) ON DELETE SET NULL,
        full_name VARCHAR(100) NOT NULL,
        department VARCHAR(100),
        phone VARCHAR(50),
        status VARCHAR(30) DEFAULT 'waiting', -- 'waiting', 'boarded', 'opted_out'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Tablolar başarıyla oluşturuldu / güncellendi!');

    // Süper Admin Hesabı var mı kontrol et, yoksa ekle
    const superAdminCheck = await client.query(`SELECT * FROM users WHERE role = 'superadmin' LIMIT 1`);
    if (superAdminCheck.rows.length === 0) {
      await client.query(`
        INSERT INTO users (email, password, full_name, phone, role)
        VALUES ('admin@servis360.com', 'admin123', 'Servis360 Sistem Yöneticisi', '0500 000 00 00', 'superadmin')
      `);
      console.log('Varsayılan Süper Admin eklendi: admin@servis360.com / admin123');
    }

    // Örnek Müşteri Firma var mı kontrol et
    const companyCheck = await client.query(`SELECT * FROM companies LIMIT 1`);
    let sampleCompanyId;
    if (companyCheck.rows.length === 0) {
      const compRes = await client.query(`
        INSERT INTO companies (company_name, contact_person, contact_email, contact_phone, workplace_name, workplace_lat, workplace_lng, geofence_radius_meters)
        VALUES ('TechNova Holding A.Ş.', 'Murat Özcan', 'holding@technova.com', '0212 555 88 99', 'Maslak Kampüs & Ar-Ge Merkezi', 41.1105, 29.0225, 180)
        RETURNING id
      `);
      sampleCompanyId = compRes.rows[0].id;

      // Şirket Admini Ekle
      await client.query(`
        INSERT INTO users (company_id, email, password, full_name, phone, role)
        VALUES ($1, 'holding@technova.com', 'technova123', 'Murat Özcan (İK Direktörü)', '0532 999 88 77', 'company_admin')
      `, [sampleCompanyId]);

      // 1. Örnek Servis Ekle (24 Kişilik)
      const shuttleRes = await client.query(`
        INSERT INTO shuttles (company_id, plate, model, capacity, driver_name, driver_phone, shift_start_time, current_status, last_lat, last_lng)
        VALUES ($1, '34 SRV 842', 'Mercedes-Benz Sprinter', 24, 'Ahmet Yılmaz', '0532 555 12 34', '07:15', 'waiting', 40.9904, 29.0255)
        RETURNING id
      `, [sampleCompanyId]);
      const shuttleId = shuttleRes.rows[0].id;

      // 2. Örnek Servis Ekle (19 Kişilik)
      await client.query(`
        INSERT INTO shuttles (company_id, plate, model, capacity, driver_name, driver_phone, shift_start_time, current_status, last_lat, last_lng)
        VALUES ($1, '34 LOP 910', 'Volkswagen Crafter', 19, 'Mehmet Demir', '0544 333 45 67', '07:30', 'waiting', 40.9780, 28.8720)
      `, [sampleCompanyId]);

      // Rota Ekle
      const routeRes = await client.query(`
        INSERT INTO routes (company_id, shuttle_id, route_name, color)
        VALUES ($1, $2, 'Kadıköy - Beşiktaş - Maslak Ekspres', '#3b82f6')
        RETURNING id
      `, [sampleCompanyId, shuttleId]);
      const routeId = routeRes.rows[0].id;

      // Duraklar Ekle
      const s1 = await client.query(`INSERT INTO stops (route_id, stop_name, stop_order, lat, lng, eta_time) VALUES ($1, 'Kadıköy Rıhtım Durağı', 1, 40.9904, 29.0255, '07:15') RETURNING id`, [routeId]);
      const s2 = await client.query(`INSERT INTO stops (route_id, stop_name, stop_order, lat, lng, eta_time) VALUES ($1, 'Üsküdar İskele Meydanı', 2, 41.0268, 29.0152, '07:30') RETURNING id`, [routeId]);
      const s3 = await client.query(`INSERT INTO stops (route_id, stop_name, stop_order, lat, lng, eta_time) VALUES ($1, 'Beşiktaş Meydan Durağı', 3, 41.0428, 29.0068, '07:45') RETURNING id`, [routeId]);
      const s4 = await client.query(`INSERT INTO stops (route_id, stop_name, stop_order, lat, lng, eta_time) VALUES ($1, 'Levent Metro Çıkışı', 4, 41.0782, 29.0118, '08:00') RETURNING id`, [routeId]);
      await client.query(`INSERT INTO stops (route_id, stop_name, stop_order, lat, lng, eta_time, is_workplace_destination) VALUES ($1, 'Maslak Kampüs (Fabrika Varış)', 5, 41.1105, 29.0225, '08:15', true)`, [routeId]);

      // Personeller Ekle
      await client.query(`
        INSERT INTO employees (company_id, shuttle_id, stop_id, full_name, department, phone)
        VALUES 
        ($1, $2, $3, 'Canan Yılmaz', 'Ar-Ge / Teknoloji', '0533 111 22 33'),
        ($1, $2, $4, 'Burak Kaya', 'Mali İşler', '0534 222 33 44')
      `, [sampleCompanyId, shuttleId, s3.rows[0].id, s2.rows[0].id]);

      console.log('Örnek müşteri ve veriler PostgreSQL veri tabanına başarıyla işlendi!');
    } else {
      console.log('Müşteri verileri zaten mevcut.');
    }

    console.log('--- Veri Tabanı Hazır! ---');
  } catch (err) {
    console.error('Veri tabanı hatası:', err);
  } finally {
    client.release();
    pool.end();
  }
}

initDatabase();
