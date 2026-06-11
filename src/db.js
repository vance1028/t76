'use strict';

const mysql = require('mysql2/promise');

/** MySQL 连接池，连接参数来自环境变量。 */
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 13346,
  user: process.env.DB_USER || 'cd',
  password: process.env.DB_PASSWORD || 'cdpass',
  database: process.env.DB_NAME || 'civildefense',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
});

async function waitForDb({ retries = 30, delayMs = 1000 } = {}) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, waitForDb, close };
