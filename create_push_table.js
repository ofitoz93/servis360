const { Pool } = require('pg');

const connectionString = 'postgresql://postgres.ipujjwfhdsxusgwnjhnc:5bT5YVLNVwutR2tW@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('push_subscriptions tablosu oluşturuluyor...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        shuttle_id INT REFERENCES shuttles(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        last_notified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('push_subscriptions tablosu hazır!');
  } catch (err) {
    console.error('Hata:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

main();
