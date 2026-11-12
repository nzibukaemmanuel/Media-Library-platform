
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Test the database connection
const connectDB = async () => {
  try {
    const client = await pool.connect();

    console.log('PostgreSQL connected successfully');

    client.release();
  } catch (error) {
    console.error('Database connection failed:', error.message);
    throw error;
  }
};

module.exports = {
  pool,
  connectDB,
};
