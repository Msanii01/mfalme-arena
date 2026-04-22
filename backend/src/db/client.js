'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../..', '.env') });

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set. Check your .env file.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('✅ PostgreSQL connected');
  }
});

pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Execute a query against the PostgreSQL pool.
 * @param {string} text - SQL query string with $1, $2, ... placeholders
 * @param {Array} params - parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[DB] ${text.slice(0, 60).trim()} — ${duration}ms, rows: ${result.rowCount}`);
    }
    return result;
  } catch (err) {
    console.error('[DB] Query error:', err.message);
    console.error('[DB] Query was:', text);
    throw err;
  }
}

/**
 * Get a dedicated client from the pool (for transactions).
 * Remember to call client.release() when done.
 */
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };
