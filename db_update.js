const { Pool } = require('pg');

const connectionString = 'postgresql://postgres.ipujjwfhdsxusgwnjhnc:5bT5YVLNVwutR2tW@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function updateDb() {
  const client = await pool.connect();
  try {
    console.log('Veritabanı güncelleniyor...');

    // 1. Admin şifresini kullanıcının istediği gibi '123456' yap
    await client.query(`
      UPDATE users 
      SET password = '123456' 
      WHERE email = 'admin@servis360.com'
    `);
    console.log("admin@servis360.com şifresi '123456' olarak güncellendi.");

    // 2. companies tablosuna service_type ekle (portal: Bizim Sitemizden Takip, integration: Kendi Sistemlerine Entegrasyonlu)
    await client.query(`
      ALTER TABLE companies 
      ADD COLUMN IF NOT EXISTS service_type VARCHAR(50) DEFAULT 'portal';
    `);

    // Mevcut kayıtları güncelle
    await client.query(`
      UPDATE companies 
      SET service_type = 'integration' 
      WHERE id = 1
    `);

    console.log('Şema güncellendi ve hazır!');
  } catch (err) {
    console.error('Hata:', err);
  } finally {
    client.release();
    pool.end();
  }
}

updateDb();
