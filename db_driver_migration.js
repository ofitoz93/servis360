const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ipujjwfhdsxusgwnjhnc:5bT5YVLNVwutR2tW@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Şoför Girişi ve Dönüş Saati tablosu güncelleniyor...');

    // 1. shuttles tablosuna return_time, driver_username, driver_password ekle
    await client.query(`
      ALTER TABLE shuttles 
      ADD COLUMN IF NOT EXISTS return_time VARCHAR(20) DEFAULT '17:30',
      ADD COLUMN IF NOT EXISTS driver_username VARCHAR(100),
      ADD COLUMN IF NOT EXISTS driver_password VARCHAR(100) DEFAULT '123456';
    `);

    // 2. Mevcut araçların şoför hesaplarını tanımla
    await client.query(`
      UPDATE shuttles 
      SET 
        driver_username = COALESCE(driver_username, '41ABC41'),
        driver_password = COALESCE(driver_password, '123456'),
        shift_start_time = COALESCE(shift_start_time, '07:15'),
        return_time = COALESCE(return_time, '17:30')
      WHERE plate = '41 ABC 41';
    `);

    await client.query(`
      UPDATE shuttles 
      SET 
        driver_username = COALESCE(driver_username, '34OKL789'),
        driver_password = COALESCE(driver_password, '123456'),
        shift_start_time = COALESCE(shift_start_time, '07:15'),
        return_time = COALESCE(return_time, '16:30')
      WHERE plate = '34 OKL 789';
    `);

    console.log('Şoför kolonları ve başlangıç/dönüş saatleri başarıyla eklendi!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
