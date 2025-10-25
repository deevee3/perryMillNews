import { textResponse, JSON_HEADERS, jsonResponse } from './response.js';
import { handleConfig, handleFeed, handleAnalyze } from './feed.js';
import {
  authenticateRequest,
  handleLogin,
  handleLogout,
  handleMe,
  handleRefresh,
  handleRegister,
} from './auth/service.js';

const requireAuth = async (request, env) => {
  const userContext = await authenticateRequest(request, env);
  if (!userContext) {
    return { user: null, response: jsonResponse({ error: 'Unauthorized' }, 401) };
  }
  return { user: userContext, response: null };
};

const handleRequest = async (request, env) => {
  if (request.method === 'OPTIONS') {
    return textResponse('', 204, JSON_HEADERS);
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === '/api/auth/register' && request.method === 'POST') {
    return handleRegister(request, env);
  }

  if (pathname === '/api/auth/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }

  if (pathname === '/api/auth/refresh' && request.method === 'POST') {
    return handleRefresh(request, env);
  }

  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    return handleLogout(request, env);
  }

  if (pathname === '/api/auth/me' && request.method === 'GET') {
    const { user, response } = await requireAuth(request, env);
    if (response) {
      return response;
    }
    return handleMe(request, env, user);
  }

  if (pathname === '/api/config' && request.method === 'GET') {
    const { response } = await requireAuth(request, env);
    if (response) {
      return response;
    }
    return handleConfig(env);
  }

  if (pathname === '/api/feed' && request.method === 'POST') {
    const { response } = await requireAuth(request, env);
    if (response) {
      return response;
    }
    return handleFeed(request);
  }

  if (pathname === '/api/analyze' && request.method === 'POST') {
    const { response } = await requireAuth(request, env);
    if (response) {
      return response;
    }
    return handleAnalyze(request, env);
  }

  return jsonResponse({ error: 'Not found.' }, 404);
};

export default {
  fetch: (request, env) => handleRequest(request, env),
};
