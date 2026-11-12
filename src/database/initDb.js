// Applies schema.sql to the database configured in .env.
// Usage: npm run db:init
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Database schema applied successfully');
  } catch (error) {
    console.error('Failed to apply schema:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error('Failed to close database connection:', error.message);
  process.exitCode = 1;
});
