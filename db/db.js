const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const { decryptJson, decryptText, encryptJson, encryptText, lookupHash } = require('./cryptoStore');

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

const LOCATION_LOG_LIMIT_MAX = 50000;

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      username_lookup TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS location_logs (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      owner_lookup TEXT,
      username TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      accuracy DOUBLE PRECISION,
      user_agent TEXT,
      encrypted_payload TEXT,
      collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_lookup TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS username_lookup TEXT
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lookup_unique
    ON users (username_lookup)
    WHERE username_lookup IS NOT NULL
  `);

  await pool.query(`
    ALTER TABLE location_logs
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS owner_lookup TEXT,
      ADD COLUMN IF NOT EXISTS username TEXT,
      ADD COLUMN IF NOT EXISTS encrypted_payload TEXT
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS location_logs_owner_lookup_idx
    ON location_logs (owner_lookup)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx
    ON user_sessions (expires_at)
  `);

  await pool.query(`
    ALTER TABLE location_logs
      ALTER COLUMN latitude DROP NOT NULL,
      ALTER COLUMN longitude DROP NOT NULL
  `);

  await pool.query(`
    ALTER TABLE location_logs
      DROP COLUMN IF EXISTS checkpoint_id,
      DROP COLUMN IF EXISTS checkpoint_at
  `);

  await migrateExistingPlaintextData();
}

async function migrateExistingPlaintextData() {
  const users = await pool.query(`
    SELECT id, username, password_hash, password_salt
    FROM users
    WHERE username_lookup IS NULL
      OR username NOT LIKE 'v1:%'
      OR password_hash NOT LIKE 'v1:%'
      OR password_salt NOT LIKE 'v1:%'
  `);

  for (const user of users.rows) {
    const username = decryptText(user.username);
    const normalizedUsername = String(username || '').trim().toLowerCase();

    if (!normalizedUsername) {
      continue;
    }

    await pool.query(
      `
        UPDATE users
        SET
          username = $1,
          username_lookup = $2,
          password_hash = $3,
          password_salt = $4
        WHERE id = $5
      `,
      [
        encryptText(normalizedUsername),
        lookupHash(normalizedUsername),
        encryptText(decryptText(user.password_hash)),
        encryptText(decryptText(user.password_salt)),
        user.id,
      ]
    );
  }

  const logs = await pool.query(`
    SELECT id, user_id, username, latitude, longitude, accuracy, user_agent, encrypted_payload
    FROM location_logs
    WHERE (owner_lookup IS NULL AND user_id IS NOT NULL)
      OR (
        encrypted_payload IS NULL
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      )
  `);

  for (const log of logs.rows) {
    const encryptedPayload =
      log.encrypted_payload ||
      encryptJson({
        latitude: Number(log.latitude),
        longitude: Number(log.longitude),
        accuracy: log.accuracy === null || log.accuracy === undefined ? null : Number(log.accuracy),
        userAgent: log.user_agent || '',
      });

    await pool.query(
      `
        UPDATE location_logs
        SET
          username = CASE WHEN username IS NULL THEN NULL ELSE $1 END,
          owner_lookup = CASE WHEN $2::uuid IS NULL THEN owner_lookup ELSE $3 END,
          encrypted_payload = $4,
          latitude = NULL,
          longitude = NULL,
          accuracy = NULL,
          user_agent = NULL,
          user_id = NULL
        WHERE id = $5
      `,
      [
        log.username ? encryptText(decryptText(log.username)) : null,
        log.user_id,
        log.user_id ? lookupHash(log.user_id) : null,
        encryptedPayload,
        log.id,
      ]
    );
  }
}

function hydrateUser(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    username: decryptText(row.username),
    passwordHash: decryptText(row.passwordHash),
    passwordSalt: decryptText(row.passwordSalt),
  };
}

function hydrateLocationLog(row) {
  const payload = row.encryptedPayload
    ? decryptJson(row.encryptedPayload)
    : {
        latitude: row.latitude,
        longitude: row.longitude,
        accuracy: row.accuracy,
        userAgent: row.userAgent,
      };

  return {
    id: row.id,
    userId: row.userId,
    username: row.username ? decryptText(row.username) : null,
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracy: payload.accuracy,
    userAgent: payload.userAgent,
    collectedAt: row.collectedAt,
  };
}

async function createUser(user) {
  const result = await pool.query(
    `
      INSERT INTO users (id, username, username_lookup, password_hash, password_salt)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, created_at AS "createdAt"
    `,
    [
      user.id,
      encryptText(user.username),
      lookupHash(user.username),
      encryptText(user.passwordHash),
      encryptText(user.passwordSalt),
    ]
  );

  return hydrateUser(result.rows[0]);
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
      WHERE username_lookup = $1
    `,
    [lookupHash(username)]
  );

  return hydrateUser(result.rows[0]);
}

async function saveLocationLogs(locationLogs, user) {
  if (!locationLogs.length) {
    return [];
  }

  const values = [];
  const placeholders = locationLogs.map((locationLog, index) => {
    const offset = index * 5;
    values.push(
      locationLog.id,
      lookupHash(user.id),
      encryptText(user.username),
      encryptJson({
        latitude: locationLog.latitude,
        longitude: locationLog.longitude,
        accuracy: locationLog.accuracy,
        userAgent: locationLog.userAgent,
      }),
      locationLog.collectedAt
    );

    return `($${offset + 1}, NULL, $${offset + 2}, $${offset + 3}, NULL, NULL, NULL, NULL, $${
      offset + 4
    }, $${offset + 5})`;
  });

  const result = await pool.query(
    `
      INSERT INTO location_logs (
        id,
        user_id,
        owner_lookup,
        username,
        latitude,
        longitude,
        accuracy,
        user_agent,
        encrypted_payload,
        collected_at
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (id) DO NOTHING
      RETURNING
        id,
        user_id AS "userId",
        username,
        latitude,
        longitude,
        accuracy,
        user_agent AS "userAgent",
        encrypted_payload AS "encryptedPayload",
        collected_at AS "collectedAt"
    `,
    values
  );

  return result.rows.map(hydrateLocationLog);
}

async function getLocationLogs(user, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 500, 1), LOCATION_LOG_LIMIT_MAX);
  const values = [user.id, lookupHash(user.id)];
  const dateFilters = [];

  if (filters.from) {
    values.push(filters.from);
    dateFilters.push(`collected_at >= $${values.length}`);
  }

  if (filters.to) {
    values.push(filters.to);
    dateFilters.push(`collected_at <= $${values.length}`);
  }

  values.push(limit);

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
        encrypted_payload AS "encryptedPayload",
        collected_at AS "collectedAt"
      FROM location_logs
      WHERE (user_id = $1 OR owner_lookup = $2)
        ${dateFilters.length ? `AND ${dateFilters.join(' AND ')}` : ''}
      ORDER BY collected_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows.map(hydrateLocationLog);
}

async function getLocationLogDayCounts(user, filters = {}) {
  const offsetMinutes = Math.min(Math.max(Number(filters.timezoneOffsetMinutes) || 0, -840), 840);
  const values = [user.id, lookupHash(user.id), Math.trunc(offsetMinutes)];
  const dateFilters = [];
  const localDayExpression = `(collected_at - ($3::int * INTERVAL '1 minute'))::date`;

  if (filters.from) {
    values.push(filters.from);
    dateFilters.push(`collected_at >= $${values.length}`);
  }

  if (filters.to) {
    values.push(filters.to);
    dateFilters.push(`collected_at < $${values.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        TO_CHAR(${localDayExpression}, 'YYYY-MM-DD') AS date,
        COUNT(*)::int AS count
      FROM location_logs
      WHERE (user_id = $1 OR owner_lookup = $2)
        ${dateFilters.length ? `AND ${dateFilters.join(' AND ')}` : ''}
      GROUP BY ${localDayExpression}
      ORDER BY ${localDayExpression} ASC
    `,
    values
  );

  return result.rows;
}

async function createSession(token, user, expiresAt) {
  await pool.query(
    `
      INSERT INTO user_sessions (token_lookup, user_id, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (token_lookup)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        expires_at = EXCLUDED.expires_at,
        last_seen_at = NOW()
    `,
    [lookupHash(token), user.id, expiresAt]
  );
}

async function findSessionUser(token) {
  await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');

  const result = await pool.query(
    `
      UPDATE user_sessions
      SET last_seen_at = NOW()
      FROM users
      WHERE user_sessions.token_lookup = $1
        AND user_sessions.user_id = users.id
        AND user_sessions.expires_at > NOW()
      RETURNING
        users.id,
        users.username,
        users.created_at AS "createdAt"
    `,
    [lookupHash(token)]
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: decryptText(row.username),
    createdAt: row.createdAt,
  };
}

async function deleteSession(token) {
  await pool.query('DELETE FROM user_sessions WHERE token_lookup = $1', [lookupHash(token)]);
}

module.exports = {
  createSession,
  createUser,
  deleteSession,
  findUserByUsername,
  findSessionUser,
  getLocationLogDayCounts,
  getLocationLogs,
  initializeDatabase,
  saveLocationLogs,
};
