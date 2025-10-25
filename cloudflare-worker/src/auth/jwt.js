import { signJwt, verifyJwt } from '../utils/jwt.js';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 15; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 14;
const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

const randomToken = () => crypto.randomUUID().replace(/-/g, '');

export const issueTokens = async ({ user, secret }) => {
  const refreshToken = randomToken() + randomToken();
  const accessToken = await signJwt({
    payload: {
      sub: user.id,
      email: user.email,
      role: user.role,
    },
    secret,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
  });

  const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();

  return {
    accessToken,
    refreshToken,
    refreshTokenExpiresAt,
  };
};

export const verifyAccessToken = async ({ token, secret }) => verifyJwt({ token, secret });

export const refreshTokenTtlSeconds = REFRESH_TOKEN_TTL_SECONDS;
