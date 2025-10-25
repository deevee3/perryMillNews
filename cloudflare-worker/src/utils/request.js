export const getClientInfo = (request) => {
  const headers = request.headers;
  const ipAddress =
    headers.get('CF-Connecting-IP') ||
    headers.get('True-Client-IP') ||
    headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    null;

  const userAgent = headers.get('User-Agent') || null;
  return { ipAddress, userAgent };
};
