const { Pool } = require('pg');

const connectionString = 'postgresql://postgres.ipujjwfhdsxusgwnjhnc:5bT5YVLNVwutR2tW@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('PostgreSQL Öğrenci/Personel ve Yol Geometrisi göçü başlatılıyor...');

    // 1. companies tablosuna operation_type (personnel / school) ekle
    await client.query(`
      ALTER TABLE companies 
      ADD COLUMN IF NOT EXISTS operation_type VARCHAR(30) DEFAULT 'personnel';
    `);

    // 2. routes tablosuna road_geometry (yol koordinatları) ekle
    await client.query(`
      ALTER TABLE routes 
      ADD COLUMN IF NOT EXISTS road_geometry JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS total_distance_km DOUBLE PRECISION DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_duration_mins DOUBLE PRECISION DEFAULT 0;
    `);

    // 3. employees / passengers tablosuna öğrenci ve veli alanlarını ekle
    await client.query(`
      ALTER TABLE employees 
      ADD COLUMN IF NOT EXISTS passenger_type VARCHAR(20) DEFAULT 'employee',
      ADD COLUMN IF NOT EXISTS student_class VARCHAR(30),
      ADD COLUMN IF NOT EXISTS student_number VARCHAR(30),
      ADD COLUMN IF NOT EXISTS parent_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS parent_relation VARCHAR(30) DEFAULT 'Veli';
    `);

    console.log('Öğrenci/Veli ve Yol Geometrisi kolonları başarıyla eklendi!');
  } catch (err) {
    console.error('Göç hatası:', err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
