import { pbkdf2, randomBytes, toBase64, timingSafeEqual } from '../utils/crypto.js';

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 150000;
const HASH_ALGORITHM = 'SHA-256';
const ENCODING_PREFIX = 'pbkdf2';

export const hashPassword = async (password) => {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string.');
  }

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await pbkdf2({
    password,
    salt,
    iterations: ITERATIONS,
    hash: HASH_ALGORITHM,
    length: KEY_LENGTH,
  });

  const saltEncoded = toBase64(salt);
  const hashEncoded = toBase64(derivedKey);
  return `${ENCODING_PREFIX}$${HASH_ALGORITHM.toLowerCase()}$${ITERATIONS}$${saltEncoded}$${hashEncoded}`;
};

export const verifyPassword = async (password, encodedHash) => {
  if (typeof encodedHash !== 'string') {
    return false;
  }

  const parts = encodedHash.split('$');
  if (parts.length !== 5) {
    return false;
  }

  const [, algorithm, iterationsRaw, saltEncoded, hashEncoded] = parts;
  if (algorithm.toLowerCase() !== HASH_ALGORITHM.toLowerCase()) {
    return false;
  }

  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const salt = Uint8Array.from(atob(saltEncoded), (c) => c.charCodeAt(0));
  const derived = await pbkdf2({
    password,
    salt,
    iterations,
    hash: HASH_ALGORITHM,
    length: KEY_LENGTH,
  });

  const expected = Uint8Array.from(atob(hashEncoded), (c) => c.charCodeAt(0));
  return timingSafeEqual(derived, expected);
};
