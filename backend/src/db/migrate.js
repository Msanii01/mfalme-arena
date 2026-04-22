'use strict';

/**
 * Migration runner — reads all .sql files in ./migrations in
 * lexicographic (numeric) order and executes them sequentially.
 *
 * Usage:  node src/db/migrate.js
 *
 * STOP condition: if DATABASE_URL is not set, the script exits with code 1
 * before touching the database.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../..', '.env') });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ── Guard: DATABASE_URL must be set ─────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error('❌ BLOCKER: DATABASE_URL is not set in .env');
  console.error('   Create a .env file from .env.example and set DATABASE_URL before running migrations.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  const client = await pool.connect();
  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        filename   VARCHAR UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Read all .sql files in order
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('⚠️  No migration files found in', MIGRATIONS_DIR);
      return;
    }

    console.log(`📂 Found ${files.length} migration file(s):`);

    for (const file of files) {
      // Check if already applied
      const { rows } = await client.query(
        'SELECT id FROM _migrations WHERE filename = $1',
        [file]
      );

      if (rows.length > 0) {
        console.log(`  ⏭️  ${file} — already applied, skipping`);
        continue;
      }

      // Apply migration inside a transaction
      console.log(`  ⚙️  Applying ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`  ✅ ${file} — applied successfully`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ ${file} — FAILED:`, err.message);
        console.error('     Migration rolled back. Fix the error and re-run.');
        process.exit(1);
      }
    }

    console.log('\n🎉 All migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('❌ Migration runner error:', err.message);
  process.exit(1);
});
