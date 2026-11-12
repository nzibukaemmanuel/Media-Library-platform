// Applies schema.sql to the database configured in .env.
// Usage: npm run db:init
require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('../config/db');
const { getErrorMessage } = require('../utils/errorMessage');

const main = async () => {
  try {
    const sql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Database schema applied successfully');
  } finally {
    // Always release the connections so the process can exit, success or not
    await pool.end();
  }
};

// One place that decides what a failure looks like
main().catch((error) => {
  console.error(`Failed to apply schema: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
