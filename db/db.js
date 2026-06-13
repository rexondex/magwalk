const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL or POSTGRES_URL is required in .env.local');
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS location_logs (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      accuracy DOUBLE PRECISION,
      user_agent TEXT,
      collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE location_logs
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS username TEXT
  `);

  await pool.query(`
    ALTER TABLE location_logs
      DROP COLUMN IF EXISTS checkpoint_id,
      DROP COLUMN IF EXISTS checkpoint_at
  `);
}

async function createUser(user) {
  const result = await pool.query(
    `
      INSERT INTO users (id, username, password_hash, password_salt)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, created_at AS "createdAt"
    `,
    [user.id, user.username, user.passwordHash, user.passwordSalt]
  );

  return result.rows[0];
}

async function findUserByUsername(username) {
  const result = await pool.query(
    `
      SELECT
        id,
        username,
        password_hash AS "passwordHash",
        password_salt AS "passwordSalt",
        created_at AS "createdAt"
      FROM users
      WHERE username = $1
    `,
    [username]
  );

  return result.rows[0] || null;
}

async function saveLocationLogs(locationLogs, user) {
  if (!locationLogs.length) {
    return [];
  }

  const values = [];
  const placeholders = locationLogs.map((locationLog, index) => {
    const offset = index * 8;
    values.push(
      locationLog.id,
      user.id,
      user.username,
      locationLog.latitude,
      locationLog.longitude,
      locationLog.accuracy,
      locationLog.userAgent,
      locationLog.collectedAt
    );

    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${
      offset + 6
    }, $${offset + 7}, $${offset + 8})`;
  });

  const result = await pool.query(
    `
      INSERT INTO location_logs (
        id,
        user_id,
        username,
        latitude,
        longitude,
        accuracy,
        user_agent,
        collected_at
      )
      VALUES ${placeholders.join(', ')}
      RETURNING
        id,
        user_id AS "userId",
        username,
        latitude,
        longitude,
        accuracy,
        user_agent AS "userAgent",
        collected_at AS "collectedAt"
    `,
    values
  );

  return result.rows;
}

async function getLocationLogs(user, limit = 100) {
  const result = await pool.query(
    `
      SELECT
        id,
        user_id AS "userId",
        username,
        latitude,
        longitude,
        accuracy,
        user_agent AS "userAgent",
        collected_at AS "collectedAt"
      FROM location_logs
      WHERE user_id = $1
      ORDER BY collected_at DESC
      LIMIT $2
    `,
    [user.id, limit]
  );

  return result.rows;
}

module.exports = {
  createUser,
  findUserByUsername,
  getLocationLogs,
  initializeDatabase,
  saveLocationLogs,
};
