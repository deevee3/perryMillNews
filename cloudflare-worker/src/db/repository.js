import { uuid, sha256, toBase64Url } from '../utils/crypto.js';

const mapUser = (row) =>
  row
    ? {
        id: row.id,
        email: row.email,
        role: row.role,
        mfaEnabled: Boolean(row.mfa_enabled),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

const hashRefreshTokenValue = async (refreshToken) => {
  const digest = await sha256(refreshToken);
  return toBase64Url(digest);
};

export const getUserByEmail = async (db, email) => {
  const lower = email.toLowerCase();
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(lower).first();
  return row ? { ...row } : null;
};

export const getUserById = async (db, id) => {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return row ? { ...row } : null;
};

export const createUser = async (db, { email, passwordHash, role }) => {
  const id = uuid();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, email.toLowerCase(), passwordHash, role, now, now)
    .run();
  return { id, email: email.toLowerCase(), role, createdAt: now, updatedAt: now, mfaEnabled: false };
};

export const insertAuditLog = async (db, { userId, eventType, ipAddress, userAgent, metadata }) => {
  const id = uuid();
  await db
    .prepare(
      `INSERT INTO audit_logs (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId ?? null, eventType, ipAddress ?? null, userAgent ?? null, metadata ?? null)
    .run();
};

export const createSession = async (db, { userId, refreshToken, expiresAt, ipAddress, userAgent }) => {
  const id = uuid();
  const now = new Date().toISOString();
  const hashed = await hashRefreshTokenValue(refreshToken);

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, refresh_token, expires_at, created_at, last_seen_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, hashed, expiresAt, now, now, ipAddress ?? null, userAgent ?? null)
    .run();

  return { id, userId, refreshToken, expiresAt, createdAt: now };
};

export const getSessionByRefreshToken = async (db, refreshToken) => {
  const hashed = await hashRefreshTokenValue(refreshToken);
  const row = await db.prepare('SELECT * FROM sessions WHERE refresh_token = ?').bind(hashed).first();
  return row ? { ...row } : null;
};

export const updateSessionWithNewToken = async (db, sessionId, refreshToken, expiresAt) => {
  const hashed = await hashRefreshTokenValue(refreshToken);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE sessions
         SET refresh_token = ?, expires_at = ?, last_seen_at = ?
       WHERE id = ?`,
    )
    .bind(hashed, expiresAt, now, sessionId)
    .run();
};

export const revokeSessionById = async (db, sessionId, reason = null) => {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE sessions SET revoked = 1, revoked_at = ?, revoke_reason = ?
       WHERE id = ?`,
    )
    .bind(now, reason, sessionId)
    .run();
};

export const revokeSessionByRefreshToken = async (db, refreshToken, reason = null) => {
  const hashed = await hashRefreshTokenValue(refreshToken);
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE sessions SET revoked = 1, revoked_at = ?, revoke_reason = ?
       WHERE refresh_token = ?`,
    )
    .bind(now, reason, hashed)
    .run();
};

export const cleanupExpiredSessions = async (db) => {
  const now = new Date().toISOString();
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
};

export const sanitizeUser = (row) => mapUser(row);
