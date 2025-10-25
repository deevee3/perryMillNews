import { hashPassword, verifyPassword } from './password.js';
import { issueTokens, verifyAccessToken, refreshTokenTtlSeconds } from './jwt.js';
import {
  createSession,
  createUser,
  getSessionByRefreshToken,
  getUserByEmail,
  getUserById,
  insertAuditLog,
  revokeSessionByRefreshToken,
  sanitizeUser,
  updateSessionWithNewToken,
} from '../db/repository.js';
import { jsonResponse, badRequestResponse, unauthorizedResponse, forbiddenResponse } from '../response.js';
import { getClientInfo } from '../utils/request.js';

const DEFAULT_ROLE = 'user';

const assertJwtSecret = (env) => {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable must be configured.');
  }
};

const readJson = async (request) => {
  try {
    return await request.json();
  } catch (error) {
    return null;
  }
};

const validateEmail = (value) => typeof value === 'string' && value.includes('@') && value.length <= 254;

const normalizeEmail = (value) => value.trim().toLowerCase();

export const handleRegister = async (request, env) => {
  assertJwtSecret(env);

  const payload = await readJson(request);
  if (!payload) {
    return badRequestResponse('Invalid JSON payload.');
  }

  const { email, password, role } = payload;
  if (!validateEmail(email)) {
    return badRequestResponse('Valid email is required.');
  }

  if (typeof password !== 'string' || password.length < 12) {
    return badRequestResponse('Password must be at least 12 characters long.');
  }

  const normalizedEmail = normalizeEmail(email);
  const existingUser = await getUserByEmail(env.AUTH_DB, normalizedEmail);
  if (existingUser) {
    return badRequestResponse('User already exists.');
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(env.AUTH_DB, {
    email: normalizedEmail,
    passwordHash,
    role: typeof role === 'string' ? role : DEFAULT_ROLE,
  });

  await insertAuditLog(env.AUTH_DB, {
    userId: user.id,
    eventType: 'USER_REGISTERED',
  });

  return jsonResponse({ user: sanitizeUser(user) }, 201);
};

const generateSession = async ({ env, user, request }) => {
  const { ipAddress, userAgent } = getClientInfo(request);
  const tokens = await issueTokens({ user, secret: env.JWT_SECRET });
  await createSession(env.AUTH_DB, {
    userId: user.id,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.refreshTokenExpiresAt,
    ipAddress,
    userAgent,
  });
  return tokens;
};

export const handleLogin = async (request, env) => {
  assertJwtSecret(env);

  const payload = await readJson(request);
  if (!payload) {
    return badRequestResponse('Invalid JSON payload.');
  }

  const { email, password } = payload;
  if (!validateEmail(email) || typeof password !== 'string' || password.length === 0) {
    return badRequestResponse('Email and password are required.');
  }

  const normalizedEmail = normalizeEmail(email);
  const user = await getUserByEmail(env.AUTH_DB, normalizedEmail);
  if (!user) {
    await insertAuditLog(env.AUTH_DB, {
      userId: null,
      eventType: 'LOGIN_FAILED_UNKNOWN_USER',
      metadata: JSON.stringify({ email: normalizedEmail }),
    });
    return unauthorizedResponse();
  }

  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    await insertAuditLog(env.AUTH_DB, {
      userId: user.id,
      eventType: 'LOGIN_FAILED_INVALID_PASSWORD',
    });
    return unauthorizedResponse();
  }

  await insertAuditLog(env.AUTH_DB, {
    userId: user.id,
    eventType: 'LOGIN_SUCCESS',
  });

  const tokens = await generateSession({ env, user, request });
  return jsonResponse({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: refreshTokenTtlSeconds,
    user: sanitizeUser(user),
  });
};

export const handleRefresh = async (request, env) => {
  assertJwtSecret(env);

  const payload = await readJson(request);
  if (!payload || typeof payload.refreshToken !== 'string') {
    return badRequestResponse('Refresh token required.');
  }

  const session = await getSessionByRefreshToken(env.AUTH_DB, payload.refreshToken);
  if (!session || session.revoked || new Date(session.expires_at) <= new Date()) {
    return unauthorizedResponse();
  }

  const user = await getUserById(env.AUTH_DB, session.user_id);
  if (!user) {
    return unauthorizedResponse();
  }

  const tokens = await issueTokens({ user, secret: env.JWT_SECRET });
  await updateSessionWithNewToken(env.AUTH_DB, session.id, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  await insertAuditLog(env.AUTH_DB, {
    userId: user.id,
    eventType: 'REFRESH_TOKEN_ROTATED',
  });

  return jsonResponse({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: refreshTokenTtlSeconds,
    user: sanitizeUser(user),
  });
};

export const handleLogout = async (request, env) => {
  const payload = await readJson(request);
  if (!payload || typeof payload.refreshToken !== 'string') {
    return badRequestResponse('Refresh token required.');
  }

  await revokeSessionByRefreshToken(env.AUTH_DB, payload.refreshToken, 'user_logout');
  return jsonResponse({ success: true });
};

export const authenticateRequest = async (request, env) => {
  assertJwtSecret(env);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const payload = await verifyAccessToken({ token, secret: env.JWT_SECRET });
    return payload;
  } catch (error) {
    return null;
  }
};

export const handleMe = async (request, env, userContext) => {
  if (!userContext) {
    return unauthorizedResponse();
  }

  const user = await getUserById(env.AUTH_DB, userContext.sub);
  if (!user) {
    return unauthorizedResponse();
  }

  return jsonResponse({ user: sanitizeUser(user) });
};
