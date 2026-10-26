const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.ipujjwfhdsxusgwnjhnc:5bT5YVLNVwutR2tW@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('--- Migrating employees table for Login ID, Password, and Role ---');
    
    // Add columns if they do not exist
    await client.query(`
      ALTER TABLE employees 
      ADD COLUMN IF NOT EXISTS login_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS login_pass VARCHAR(50) DEFAULT '123456',
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'passenger';
    `);

    // Backfill login_id for existing employees who don't have one
    const { rows } = await client.query(`SELECT id, full_name, phone, shuttle_id FROM employees WHERE login_id IS NULL OR login_id = ''`);
    for (const emp of rows) {
      // Generate clean login_id e.g. PRS-100 + id or based on phone
      const loginId = 'PRS-' + (1000 + emp.id);
      await client.query(`UPDATE employees SET login_id = $1, login_pass = '123456' WHERE id = $2`, [loginId, emp.id]);
      console.log(`Updated employee ${emp.full_name} (ID: ${emp.id}) -> Login ID: ${loginId}, Pass: 123456`);
    }

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    client.release();
    pool.end();
  }
}

run();
