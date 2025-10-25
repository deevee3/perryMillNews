import { hmacSha256, toBase64Url, fromBase64Url, bufferToString, stringToUint8 } from './crypto.js';

const encoder = new TextEncoder();

const encodeSegment = (obj) => {
  const json = JSON.stringify(obj);
  return toBase64Url(encoder.encode(json));
};

const decodeSegment = (segment) => {
  const bytes = fromBase64Url(segment);
  const json = bufferToString(bytes.buffer);
  return JSON.parse(json);
};

export const signJwt = async ({ payload, secret, expiresInSeconds, issuedAt, expiresAt }) => {
  if (!secret) {
    throw new Error('JWT secret is required.');
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const iat = typeof issuedAt === 'number' ? issuedAt : Math.floor(Date.now() / 1000);
  let exp;
  if (typeof expiresAt === 'number') {
    exp = expiresAt;
  } else if (typeof expiresInSeconds === 'number') {
    exp = iat + expiresInSeconds;
  }

  const body = typeof exp === 'number' ? { ...payload, iat, exp } : { ...payload, iat };

  const encodedHeader = encodeSegment(header);
  const encodedPayload = encodeSegment(body);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signatureBytes = await hmacSha256({ data: signingInput, secret });
  const signature = toBase64Url(signatureBytes);
  return `${signingInput}.${signature}`;
};

export const verifyJwt = async ({ token, secret }) => {
  if (!token || typeof token !== 'string') {
    throw new Error('Token is required');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeSegment(encodedHeader);
  if (header.alg !== 'HS256') {
    throw new Error('Unsupported JWT algorithm');
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSigBytes = await hmacSha256({ data: signingInput, secret });
  const expectedSig = toBase64Url(expectedSigBytes);

  if (expectedSig !== encodedSignature) {
    throw new Error('JWT signature mismatch');
  }

  const payload = decodeSegment(encodedPayload);
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error('JWT expired');
  }

  return payload;
};
