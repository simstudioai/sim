const { drizzle } = require('drizzle-orm/node-postgres');
const pkg = require('pg');
const { Pool } = pkg;
const { sql } = require('drizzle-orm');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function main() {
  // Create a new pool
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  // Create a new drizzle instance
  const db = drizzle(pool);

  try {
    // Add the deployed_state column if it doesn't exist
    await db.execute(sql`ALTER TABLE workflow ADD COLUMN IF NOT EXISTS deployed_state json;`);
    console.log('Column added successfully');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Close the pool
    await pool.end();
  }
}

main(); 