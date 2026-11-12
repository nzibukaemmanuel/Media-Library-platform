// Applies schema.sql to the database configured in .env.
// Usage: npm run db:init
//
// Safe to run repeatedly, and it also upgrades a database created by an older
// version of the schema (for example, it adds the category column).
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
  } catch (error) {
    console.error(`Failed to apply schema: ${getErrorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    // Always release the connections so the process can exit, success or not
    try {
      await pool.end();
    } catch (error) {
      console.error(`Failed to close the database connection: ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }
};

void main();
