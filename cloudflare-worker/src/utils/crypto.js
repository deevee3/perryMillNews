const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const randomBytes = (length) => {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return array;
};

export const toBase64 = (input) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const fromBase64 = (text) => {
  const binary = atob(text);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    output[i] = binary.charCodeAt(i);
  }
  return output;
};

export const toBase64Url = (input) =>
  toBase64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

export const fromBase64Url = (text) => {
  let normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding) {
    normalized += '='.repeat(4 - padding);
  }
  return fromBase64(normalized);
};

export const bufferToString = (buffer) => decoder.decode(buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer));

export const toAsciiString = (bytes) => {
  let result = '';
  for (let i = 0; i < bytes.length; i += 1) {
    result += String.fromCharCode(bytes[i]);
  }
  return result;
};

export const timingSafeEqual = (a, b) => {
  const left = a instanceof Uint8Array ? a : new Uint8Array(a);
  const right = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (left.length !== right.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left[i] ^ right[i];
  }
  return result === 0;
};

export const pbkdf2 = async ({ password, salt, iterations, hash = 'SHA-256', length }) => {
  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash,
    },
    passwordKey,
    length * 8,
  );
  return new Uint8Array(derived);
};

export const hmacSha256 = async ({ data, secret }) => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return new Uint8Array(signature);
};

export const stringToUint8 = (value) => encoder.encode(value);

export const sha256 = async (value) => {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
};

export const uuid = () => crypto.randomUUID();
