export const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export const jsonResponse = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });

export const textResponse = (text, status = 200, headers = {}) =>
  new Response(text, {
    status,
    headers,
  });

export const unauthorizedResponse = () =>
  jsonResponse({ error: 'Unauthorized' }, 401);

export const forbiddenResponse = () =>
  jsonResponse({ error: 'Forbidden' }, 403);

export const badRequestResponse = (message) =>
  jsonResponse({ error: message || 'Bad request.' }, 400);

export const serverErrorResponse = (message) =>
  jsonResponse({ error: message || 'Internal server error.' }, 500);
