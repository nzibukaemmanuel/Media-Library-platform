require('dotenv').config();

const { Pool } = require('pg');

const { getErrorMessage } = require('../utils/errorMessage');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10, // maximum clients in the pool
  idleTimeoutMillis: 30000, // close idle clients after 30s
  connectionTimeoutMillis: 5000, // fail fast if the database is unreachable
});

// An idle client erroring (e.g. the database restarting) must not crash the app
pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

// Verify the database is reachable.
// pool.query checks out a connection and always returns it to the pool, even
// when the query fails; checking out a client by hand here would leak it on
// any error between connect() and release().
const connectDB = async () => {
  try {
    const { rows } = await pool.query('SELECT current_database() AS db');
    console.log(`PostgreSQL connected successfully (database: ${rows[0].db})`);
  } catch (error) {
    console.error(`Database connection failed: ${getErrorMessage(error)}`);
    throw error;
  }
};

// Close all pooled connections (used on shutdown)
const closeDB = () => pool.end();

module.exports = {
  pool,
  connectDB,
  closeDB,
};
