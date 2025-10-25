const runtimeConfig = window.__CONFIG__ || {};

const normalizeBaseUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\/+$/, '');
};

const apiBaseUrl = normalizeBaseUrl(runtimeConfig.apiBaseUrl);
const authBaseUrl = normalizeBaseUrl(runtimeConfig.authBaseUrl) || apiBaseUrl;

const withApiBase = (path) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
};

const withAuthBase = (path) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return authBaseUrl ? `${authBaseUrl}${normalizedPath}` : normalizedPath;
};

let apiFetch = (path, options) => fetch(withApiBase(path), options);

const AUTH_STORAGE_KEY = 'perryMill:auth';
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // Mirrors Worker access token TTL
const REFRESH_TOKEN_FALLBACK_TTL_SECONDS = 14 * 24 * 60 * 60;
const ACCESS_TOKEN_EXPIRY_GRACE_SECONDS = 60;

const safeJsonParse = (raw, fallback = null) => {
  if (!raw || typeof raw !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Failed to parse JSON payload.', error);
    return fallback;
  }
};

const loadConfig = async ({ silent = false } = {}) => {
  if (configLoaded) {
    return true;
  }

  const authenticated = await requireAuthentication({ silent });
  if (!authenticated) {
    return false;
  }

  try {
    const response = await authFetch('/api/config', { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const data = await response.json();
    applyConfig(data);
    configLoaded = true;
    return true;
  } catch (error) {
    console.error('Config load error:', error);
    setStatus(error.message || 'Failed to load Perry Mill configuration.', true);
    return false;
  }
};

const handleAuthSubmit = async (event) => {
  event.preventDefault();

  if (!authForm) {
    return;
  }

  const formData = new FormData(authForm);
  const payload = Object.fromEntries(formData.entries());

  const email = payload.email?.toString().trim() ?? '';
  const password = payload.password?.toString() ?? '';

  if (!email || !password) {
    showAuthError('Email and password are required.');
    return;
  }

  if (password.length < 12) {
    showAuthError('Password must be at least 12 characters long.');
    return;
  }

  setAuthSubmitting(true);
  showAuthError('');

  const { data, error } = await authApiRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  setAuthSubmitting(false);

  if (error) {
    showAuthError(error.message || 'Unable to sign in.');
    return;
  }

  const { accessToken, refreshToken, expiresIn, user } = data;
  setAuthState({
    accessToken,
    refreshToken,
    accessTokenExpiresAt: computeAccessExpiry(),
    refreshTokenExpiresAt: computeRefreshExpiry(expiresIn),
    user: user ?? null,
  });

  closeAuthModal();
  setStatus('Signed in to Perry Mill.');
  const configured = await loadConfig({ silent: true });
  if (configured) {
    fetchFeed();
  }
};

const handleLogout = async () => {
  if (!authState.refreshToken) {
    resetAuthState();
    return;
  }

  try {
    await fetch(withAuthBase('/api/auth/logout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: authState.refreshToken }),
    });
  } catch (error) {
    console.warn('Logout request failed:', error);
  } finally {
    resetAuthState();
    configLoaded = false;
    setStatus('Signed out.');
    clearResults();
  }
};

const isAuthenticated = () => Boolean(authState.accessToken);

const requireAuthentication = async ({ silent = false } = {}) => {
  const authed = await ensureAccessToken();
  if (authed) {
    return true;
  }

  if (!silent) {
    setStatus('Sign in to continue.', true);
  }

  openAuthModal();

  return false;
};

const loadStoredAuthState = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    const parsed = safeJsonParse(raw, {});

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, user } = parsed;

    if (!accessToken || !refreshToken || !accessTokenExpiresAt) {
      return null;
    }

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshTokenExpiresAt ?? null,
      user: user && typeof user === 'object' ? user : null,
    };
  } catch (error) {
    console.warn('Failed to read auth state from storage:', error);
    return null;
  }
};

const persistAuthState = (state) => {
  if (!state) {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to clear auth state:', error);
    }
    return;
  }

  try {
    const payload = {
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      accessTokenExpiresAt: state.accessTokenExpiresAt,
      refreshTokenExpiresAt: state.refreshTokenExpiresAt ?? null,
      user: state.user ?? null,
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to persist auth state:', error);
  }
};

const clearAuthState = () => {
  persistAuthState(null);
};

const computeAccessExpiry = () => new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();
const computeRefreshExpiry = (seconds) => {
  const ttl = typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : REFRESH_TOKEN_FALLBACK_TTL_SECONDS;
  return new Date(Date.now() + ttl * 1000).toISOString();
};

const isExpired = (isoString, graceSeconds = 0) => {
  if (!isoString) {
    return true;
  }

  const target = new Date(isoString).getTime();
  if (Number.isNaN(target)) {
    return true;
  }

  return Date.now() >= target - graceSeconds * 1000;
};

const authListeners = new Set();

const notifyAuthListeners = (state) => {
  authListeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.warn('Auth listener error:', error);
    }
  });
};

const authState = {
  accessToken: null,
  refreshToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  user: null,
  loading: false,
};

const setAuthState = (patch, { persist = true, notify = true } = {}) => {
  Object.assign(authState, patch);

  if (persist) {
    if (!authState.accessToken || !authState.refreshToken) {
      clearAuthState();
    } else {
      persistAuthState(authState);
    }
  }

  if (notify) {
    notifyAuthListeners({ ...authState });
  }
};

const resetAuthState = ({ notify = true } = {}) => {
  setAuthState(
    {
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      user: null,
    },
    { notify }
  );
};

const subscribeToAuth = (listener) => {
  if (typeof listener !== 'function') {
    return () => {};
  }

  authListeners.add(listener);
  listener({ ...authState });

  return () => {
    authListeners.delete(listener);
  };
};

const authFetch = async (path, options = {}, { useAuthBase = false, retry = true } = {}) => {
  const targetUrl = useAuthBase ? withAuthBase(path) : withApiBase(path);

  const headers = new Headers(options.headers || {});
  const shouldAttachToken = !headers.has('Authorization') && authState.accessToken;

  if (shouldAttachToken) {
    headers.set('Authorization', `Bearer ${authState.accessToken}`);
  }

  const response = await fetch(targetUrl, {
    ...options,
    headers,
  });

  if (response.status !== 401 || !retry) {
    return response;
  }

  const refreshed = await ensureAccessToken();
  if (!refreshed) {
    return response;
  }

  const retryHeaders = new Headers(options.headers || {});
  retryHeaders.set('Authorization', `Bearer ${authState.accessToken}`);

  return fetch(targetUrl, {
    ...options,
    headers: retryHeaders,
  });
};

const readJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('Failed to parse response JSON:', error);
    return {};
  }
};

const authApiRequest = async (path, options = {}, { useAuthBase = true } = {}) => {
  try {
    const response = await authFetch(path, options, { useAuthBase });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      const message = data?.error || `Request failed (${response.status})`;
      throw new Error(message);
    }

    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
};

const ensureAccessToken = async () => {
  if (!authState.refreshToken) {
    resetAuthState();
    return false;
  }

  if (isExpired(authState.refreshTokenExpiresAt)) {
    resetAuthState();
    return false;
  }

  if (!isExpired(authState.accessTokenExpiresAt, ACCESS_TOKEN_EXPIRY_GRACE_SECONDS)) {
    return true;
  }

  try {
    const response = await fetch(withAuthBase('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: authState.refreshToken }),
    });

    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.error || `Request failed (${response.status})`);
    }

    setAuthState({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accessTokenExpiresAt: computeAccessExpiry(),
      refreshTokenExpiresAt: computeRefreshExpiry(data.expiresIn),
      user: data.user ?? authState.user ?? null,
    });

    return true;
  } catch (error) {
    console.warn('Token refresh failed:', error);
    resetAuthState();
    return false;
  }
};

const form = document.getElementById('feed-form');
const submitBtn = document.getElementById('submit');
const statusEl = document.getElementById('status');
const entriesContainer = document.getElementById('entries');
const featuredContainer = document.getElementById('featured');
const summaryEl = document.getElementById('summary');
const categoryInput = document.getElementById('category');
const navContainer = document.getElementById('feed-nav');
const autoRefreshCheckbox = document.getElementById('autoRefresh');
const aiAnalyzeButton = document.getElementById('ai-analyze');
const analysisSection = document.getElementById('analysis');
const analysisContent = document.getElementById('analysis-content');
const analysisMeta = document.getElementById('analysis-meta');
const analysisHeadlineEl = document.getElementById('analysis-headline');
const libraryList = document.getElementById('library-list');
const libraryEmpty = document.getElementById('library-empty');
const libraryButtons = document.querySelectorAll('.library-button');
const libraryModal = document.getElementById('library-modal');
const libraryBackdrop = document.getElementById('library-backdrop');
const libraryPanel = libraryModal?.querySelector('.library-panel');
const libraryCloseButton = document.getElementById('library-close');
const libraryOpenButton = document.getElementById('library-open');
const reader = document.getElementById('reader');
const readerBackdrop = document.getElementById('reader-backdrop');
const readerPanel = reader?.querySelector('.reader-panel');
const readerCloseButton = document.getElementById('reader-close');
const readerTitle = document.getElementById('reader-title');
const readerSubtitle = document.getElementById('reader-subtitle');
const readerBody = document.getElementById('reader-body');
const readerSource = document.getElementById('reader-source');
const readerTime = document.getElementById('reader-time');
const readerImage = document.getElementById('reader-image');
const readerLink = document.getElementById('reader-link');

const authModal = document.getElementById('auth-modal');
const authBackdrop = document.getElementById('auth-backdrop');
const authCloseButton = document.getElementById('auth-close');
const authCancelButton = document.getElementById('auth-cancel');
const authForm = document.getElementById('auth-form');
const authErrorEl = document.getElementById('auth-error');
const authLoginButton = document.getElementById('auth-login');
const authLogoutButton = document.getElementById('auth-logout');
const authUserContainer = document.getElementById('auth-user');
const authEmailDisplay = document.getElementById('auth-email');
const authEmailInput = document.getElementById('auth-email-input');
const authPasswordInput = document.getElementById('auth-password-input');
const authSubmitButton = document.getElementById('auth-submit');
const authControls = document.getElementById('auth-controls');

const setInsightsLabel = (mode = 'idle') => {
  if (mode === 'refresh') {
    aiAnalyzeButton.textContent = 'Refresh';
  } else if (mode === 'working') {
    aiAnalyzeButton.textContent = 'Summarizing…';
  } else {
    aiAnalyzeButton.textContent = 'Mill My News';
  }
};
const lastUpdatedEl = document.getElementById('last-updated');
const activeEditionEl = document.getElementById('active-edition');
const autoRefreshHint = document.getElementById('auto-refresh-label');

let refreshTimer = null;
let latestFeed = null;
let config = { hasOpenAIKey: false };
let configLoaded = false;
let activeLibrary = 'saved';
let lastFocusedElement = null;
let authInitialized = false;

const STORIES_HEADING = 'Real stories, right now';

const LIBRARY_KEYS = {
  saved: 'perryMill:saved',
  recommended: 'perryMill:recommended',
};

const LIBRARY_EMPTY_COPY = {
  saved: 'No saved stories yet. Click Save on any article to revisit it here.',
  recommended: 'Recommend stories you love to see them collected here.',
};

const LIBRARY_TAB_KEY = 'perryMill:libraryTab';

const migrateQueueToSaved = () => {
  try {
    const queueRaw = localStorage.getItem('perryMill:queue');
    if (!queueRaw) {
      return;
    }

    const queueItems = JSON.parse(queueRaw);
    if (!Array.isArray(queueItems) || !queueItems.length) {
      localStorage.removeItem('perryMill:queue');
      return;
    }

    const savedRaw = localStorage.getItem(LIBRARY_KEYS.saved);
    const savedItems = savedRaw ? JSON.parse(savedRaw) : [];

    const merged = [...savedItems];
    queueItems.forEach((item) => {
      if (!item || !item.link || merged.some((existing) => existing.link === item.link)) {
        return;
      }

      const normalized = hydrateEntry({ ...item, migratedFromQueue: true, savedAt: Date.now() });
      merged.push(normalized);
    });

    localStorage.setItem(LIBRARY_KEYS.saved, JSON.stringify(merged));
    localStorage.removeItem('perryMill:queue');
  } catch (error) {
    console.warn('Queue migration failed:', error);
  }
};

const coalesceString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
};

const coalesceValue = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return '';
};

const findLatestEntry = (link) => {
  if (!link || !latestFeed?.entries) {
    return null;
  }
  return latestFeed.entries.find((entry) => entry && entry.link === link);
};

const hydrateEntry = (entry = {}) => {
  const fallback = findLatestEntry(entry.link);

  const hydrated = {
    title: coalesceString(entry.title, fallback?.title, fallback?.headline),
    link: coalesceString(entry.link, fallback?.link, fallback?.url),
    summary: coalesceString(entry.summary, fallback?.summary, fallback?.description, fallback?.content),
    subtitle: coalesceString(entry.subtitle, fallback?.subtitle, fallback?.dek),
    image: coalesceString(entry.image, fallback?.image, fallback?.thumbnail, fallback?.leadImage),
    source: coalesceString(
      entry.source,
      fallback?.source,
      fallback?.site,
      fallback?.feedTitle,
      fallback?.author,
      fallback?.byline
    ),
    published: coalesceValue(
      entry.published,
      entry.date,
      entry.pubDate,
      fallback?.published,
      fallback?.date,
      fallback?.pubDate
    ),
    savedAt: entry.savedAt,
    migratedFromQueue: entry.migratedFromQueue,
  };

  return hydrated;
};

const normalizeLibraryEntries = (key, entries) => {
  if (!Array.isArray(entries) || !entries.length) {
    return entries;
  }

  let mutated = false;
  const normalized = entries.map((entry) => {
    const hydrated = hydrateEntry(entry);
    const merged = { ...entry, ...hydrated };

    if (!mutated) {
      const fields = ['title', 'summary', 'subtitle', 'image', 'source', 'published'];
      mutated = fields.some((field) => merged[field] !== entry[field]);
    }

    return merged;
  });

  if (mutated) {
    try {
      localStorage.setItem(key, JSON.stringify(normalized));
    } catch (error) {
      console.warn('Failed to persist normalized library entries:', error);
    }
  }

  return normalized;
};

const formatRelativeTime = (isoString) => {
  if (!isoString) {
    return 'Just now';
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Just now';
  }

  const diffMs = Date.now() - date.getTime();
  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 45) {
    return 'Just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (hours < 24) {
    return `${hours}h ago`;
  }

  if (days < 7) {
    return `${days}d ago`;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

const getFaviconUrl = (link) => {
  if (!link) {
    return null;
  }

  try {
    const { hostname } = new URL(link);
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`;
  } catch (error) {
    return null;
  }
};

const clearResults = () => {
  entriesContainer.innerHTML = '';
  featuredContainer.innerHTML = '';
  summaryEl.textContent = STORIES_HEADING;
};

const showAuthError = (message) => {
  if (!authErrorEl) {
    return;
  }

  authErrorEl.textContent = message;
  authErrorEl.hidden = !message;
};

const setAuthSubmitting = (isSubmitting) => {
  if (authSubmitButton) {
    authSubmitButton.disabled = isSubmitting;
  }

  if (authLoginButton && authLoginButton.hidden === false) {
    authLoginButton.disabled = isSubmitting;
  }

  if (authEmailInput) {
    authEmailInput.disabled = isSubmitting;
  }

  if (authPasswordInput) {
    authPasswordInput.disabled = isSubmitting;
  }
};

const openAuthModal = () => {
  if (!authModal) {
    return;
  }

  lastFocusedElement = document.activeElement;
  authModal.classList.add('is-open');
  authModal.removeAttribute('aria-hidden');
  document.body.classList.add('overlay-open');

  requestAnimationFrame(() => {
    authModal.querySelector('.modal-panel')?.focus({ preventScroll: true });
  });
};

const closeAuthModal = () => {
  if (!authModal) {
    return;
  }

  authModal.classList.remove('is-open');
  authModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overlay-open');
  showAuthError('');
  authForm?.reset();

  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus({ preventScroll: true });
  }
};

const syncAuthControls = (state) => {
  if (!authControls) {
    return;
  }

  const isLoggedIn = Boolean(state?.accessToken && state?.user);

  if (authLoginButton) {
    authLoginButton.hidden = isLoggedIn;
    authLoginButton.disabled = state.loading;
  }

  if (authUserContainer) {
    authUserContainer.hidden = !isLoggedIn;
  }

  if (authEmailDisplay) {
    authEmailDisplay.textContent = state.user?.email || '';
  }

  if (authLogoutButton) {
    authLogoutButton.disabled = state.loading;
  }
};

const attachAuthListeners = () => {
  subscribeToAuth(syncAuthControls);
};

const initializeAuthFromStorage = async () => {
  if (authInitialized) {
    return;
  }

  authInitialized = true;

  const stored = loadStoredAuthState();
  if (!stored) {
    resetAuthState({ notify: false });
    return;
  }

  setAuthState({
    ...stored,
    refreshTokenExpiresAt: stored.refreshTokenExpiresAt ?? computeRefreshExpiry(),
  }, { notify: false, persist: false });

  if (!stored.user) {
    await ensureAccessToken();
    if (!authState.accessToken) {
      return;
    }

    const response = await authFetch('/api/auth/me');
    if (!response.ok) {
      resetAuthState();
      return;
    }

    const data = await readJsonResponse(response);
    if (data?.user) {
      setAuthState({ user: data.user });
    }
  }
};

const createMeta = (entry) => {
  const meta = document.createElement('div');
  meta.className = 'article-meta';

  const sourceWrap = document.createElement('div');
  sourceWrap.className = 'meta-source';

  const faviconUrl = getFaviconUrl(entry.link);
  if (faviconUrl) {
    const favicon = document.createElement('img');
    favicon.src = faviconUrl;
    favicon.alt = `${entry.source || 'Publication'} icon`;
    favicon.loading = 'lazy';
    favicon.decoding = 'async';
    sourceWrap.appendChild(favicon);
  }

  const sourceName = document.createElement('span');
  sourceName.className = 'source-name';
  sourceName.textContent = entry.source || 'Source';
  sourceWrap.appendChild(sourceName);

  const sourceLink = document.createElement('a');
  sourceLink.className = 'source-link';
  sourceLink.href = entry.link || '#';
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener noreferrer';
  sourceLink.textContent = 'Source';
  sourceLink.setAttribute('aria-label', `Open source article from ${entry.source || 'this publication'}`);
  sourceWrap.appendChild(sourceLink);
  meta.append(sourceWrap);
  return meta;
};

const createTimeTag = (entry) => {
  const timeSpan = document.createElement('span');
  timeSpan.className = 'meta-time';
  timeSpan.textContent = formatRelativeTime(entry.published);
  return timeSpan;
};

const truncate = (value, max = 220) => {
  if (!value) {
    return '';
  }

  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
};

const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();

const dedupeSummary = (subtitleText, summaryText) => {
  const subtitleNorm = normalize(subtitleText).replace(/[…\.]+$/, '');
  const summaryNorm = normalize(summaryText).replace(/[…\.]+$/, '');

  if (!summaryNorm) {
    return '';
  }

  if (!subtitleNorm) {
    return summaryText;
  }

  if (summaryNorm === subtitleNorm) {
    return '';
  }

  if (!subtitleNorm) {
    return summaryText;
  }

  if (summaryNorm.startsWith(subtitleNorm)) {
    const trimmedSummary = summaryText.trim();
    const trimmedSubtitle = subtitleText.trim();

    let remainder = trimmedSummary;
    if (trimmedSubtitle.length > 0) {
      remainder = trimmedSummary.slice(trimmedSubtitle.length).trim();
    }

    remainder = remainder.replace(/^[-–—,:;\s]+/, '');

    if (normalize(remainder) === normalize(trimmedSubtitle)) {
      return '';
    }

    return remainder;
  }

  if (subtitleNorm.startsWith(summaryNorm)) {
    return '';
  }

  return summaryText;
};

const createActionButton = ({
  element = 'button',
  href,
  target = '_blank',
  rel = 'noopener noreferrer',
  desktopLabel,
  mobileLabel,
  label,
  ariaLabel,
  className = '',
  onClick,
}) => {
  const action = element === 'a' ? document.createElement('a') : document.createElement('button');
  action.className = `action ${className}`.trim();

  if (element === 'a') {
    action.href = href || '#';
    action.target = target;
    action.rel = rel;
  } else {
    action.type = 'button';
  }

  if (ariaLabel) {
    action.setAttribute('aria-label', ariaLabel);
  }

  if (desktopLabel || mobileLabel) {
    const desktopSpan = document.createElement('span');
    desktopSpan.className = 'label-desktop';
    desktopSpan.textContent = desktopLabel || label;

    const mobileSpan = document.createElement('span');
    mobileSpan.className = 'label-mobile';
    mobileSpan.textContent = mobileLabel || desktopLabel || label;

    action.append(desktopSpan, mobileSpan);
  } else if (label) {
    action.textContent = label;
  }

  if (typeof onClick === 'function') {
    action.addEventListener('click', (event) => {
      event.preventDefault();
      onClick();
    });
  }

  return action;
};

const persistEntry = (storageKey, entry) => {
  if (!entry.link) {
    return false;
  }

  try {
    const existingRaw = localStorage.getItem(storageKey);
    const existing = existingRaw ? JSON.parse(existingRaw) : [];

    if (existing.some((item) => item.link === entry.link)) {
      return false;
    }

    const storedEntry = hydrateEntry({ ...entry, savedAt: Date.now() });

    if (!storedEntry.link) {
      return false;
    }

    existing.push(storedEntry);
    localStorage.setItem(storageKey, JSON.stringify(existing));
    return true;
  } catch (error) {
    console.warn('Persist entry failed:', error);
    return false;
  }
};

const getLibraryEntries = (key) => {
  if (!key || typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(key);
    const entries = raw ? JSON.parse(raw) : [];
    return Array.isArray(entries)
      ? entries
          .filter((item) => item && item.link)
          .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      : [];
  } catch (error) {
    console.warn('Failed to read library entries:', error);
    return [];
  }
};

const setActiveLibraryButton = (type) => {
  libraryButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.library === type);
  });
};

const renderLibrary = (type) => {
  if (!libraryList || !libraryEmpty) {
    return;
  }

  const key = LIBRARY_KEYS[type];
  const entries = normalizeLibraryEntries(key, getLibraryEntries(key));

  libraryList.innerHTML = '';
  libraryEmpty.hidden = entries.length > 0;
  libraryEmpty.textContent = LIBRARY_EMPTY_COPY[type] || 'No stories yet.';

  if (!entries.length) {
    return;
  }

  entries.forEach((entry) => {
    const hydrated = hydrateEntry(entry);

    const item = document.createElement('li');
    item.className = 'library-item';

    const textWrap = document.createElement('div');
    textWrap.className = 'library-item-copy';

    const title = document.createElement('p');
    title.className = 'library-item-title';
    title.textContent = hydrated.title || entry.title || 'Untitled story';

    const meta = document.createElement('span');
    meta.className = 'library-item-meta';
    if (entry.savedAt) {
      const added = new Date(entry.savedAt);
      const migrated = entry.migratedFromQueue ? ' (queued)' : '';
      meta.textContent = `Added ${added.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${added.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${migrated}`;
    } else {
      meta.textContent = 'Added earlier';
    }

    textWrap.append(title, meta);

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'library-open';
    openButton.textContent = 'Open';
    openButton.setAttribute('aria-label', `Open saved story: ${hydrated.title || entry.title || 'story'}`);
    openButton.addEventListener('click', () => {
      openReader(hydrated);
    });

    item.append(textWrap, openButton);
    libraryList.appendChild(item);
  });
};

const showLibrary = (type) => {
  activeLibrary = type;
  setActiveLibraryButton(type);
  renderLibrary(type);
  try {
    localStorage.setItem(LIBRARY_TAB_KEY, type);
  } catch (error) {
    console.warn('Failed to persist library tab:', error);
  }
};

const refreshLibraryIfActive = (type) => {
  if (activeLibrary === type) {
    renderLibrary(type);
  }
};

const closeReader = () => {
  if (!reader) {
    return;
  }

  reader.classList.remove('is-open');
  reader.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overlay-open');

  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus({ preventScroll: true });
  }
};

const openReader = (entry) => {
  if (!reader || !readerPanel) {
    return;
  }

  lastFocusedElement = document.activeElement;

  readerTitle.textContent = entry.title || 'Untitled story';
  readerSubtitle.textContent = entry.subtitle || entry.summary || '';
  readerSubtitle.hidden = !readerSubtitle.textContent.trim();

  readerBody.innerHTML = '';
  const summaryText = entry.summary || '';
  if (summaryText) {
    const paragraphs = summaryText.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
    if (paragraphs.length) {
      paragraphs.forEach((paragraph) => {
        const p = document.createElement('p');
        p.textContent = paragraph;
        readerBody.appendChild(p);
      });
    } else {
      const p = document.createElement('p');
      p.textContent = summaryText;
      readerBody.appendChild(p);
    }
  } else {
    const p = document.createElement('p');
    p.textContent = 'No summary available for this story.';
    readerBody.appendChild(p);
  }

  const sourceName = entry.source || 'Source';
  readerSource.textContent = sourceName;
  const timeLabel = formatRelativeTime(entry.published);
  readerTime.textContent = timeLabel;
  readerTime.hidden = !timeLabel;

  if (entry.image && entry.image.trim()) {
    readerImage.src = entry.image;
    readerImage.alt = entry.title || sourceName;
    readerImage.hidden = false;
  } else {
    readerImage.hidden = true;
  }

  if (entry.link) {
    readerLink.href = entry.link;
    readerLink.removeAttribute('aria-disabled');
  } else {
    readerLink.href = '#';
    readerLink.setAttribute('aria-disabled', 'true');
  }

  reader.classList.add('is-open');
  reader.removeAttribute('aria-hidden');
  document.body.classList.add('overlay-open');

  requestAnimationFrame(() => {
    readerPanel.focus({ preventScroll: true });
  });
};

const closeLibrary = () => {
  if (!libraryModal) {
    return;
  }

  libraryModal.classList.remove('is-open');
  libraryModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overlay-open');

  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus({ preventScroll: true });
  }
};

const openLibrary = () => {
  if (!libraryModal || !libraryPanel) {
    return;
  }

  lastFocusedElement = document.activeElement;
  libraryModal.classList.add('is-open');
  libraryModal.removeAttribute('aria-hidden');
  document.body.classList.add('overlay-open');

  requestAnimationFrame(() => {
    libraryPanel.focus({ preventScroll: true });
  });
};

const createActions = (entry) => {
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const storyTitle = entry.title || 'Article';

  const readAction = createActionButton({
    desktopLabel: 'Read',
    mobileLabel: 'Open',
    ariaLabel: `Open story: ${storyTitle}`,
    className: 'action-primary',
    onClick: () => {
      openReader(entry);
    },
  });

  const saveAction = createActionButton({
    label: 'Save',
    ariaLabel: `Save story for later: ${storyTitle}`,
    onClick: () => {
      const added = persistEntry(LIBRARY_KEYS.saved, entry);
      setStatus(added ? 'Saved for later.' : 'Already in Saved.');
      if (added) {
        refreshLibraryIfActive('saved');
      }
    },
  });

  const shareAction = createActionButton({
    label: 'Share',
    ariaLabel: `Share story: ${storyTitle}`,
    onClick: async () => {
      if (entry.link && navigator.share) {
        try {
          await navigator.share({ title: entry.title, url: entry.link });
          setStatus('Shared successfully.');
          return;
        } catch (error) {
          console.warn('Share cancelled or failed:', error);
        }
      }

      if (entry.link && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(entry.link);
          setStatus('Link copied to clipboard.');
        } catch (error) {
          console.warn('Clipboard copy failed:', error);
          setStatus('Unable to copy link.', true);
        }
        return;
      }

      setStatus('Sharing not available in this browser.', true);
    },
  });

  const recommendAction = createActionButton({
    label: 'Recommend',
    ariaLabel: `Recommend story: ${storyTitle}`,
    onClick: () => {
      const added = persistEntry(LIBRARY_KEYS.recommended, entry);
      setStatus(added ? 'Thanks for recommending this story!' : 'Already in your recommended list.');
      if (added) {
        refreshLibraryIfActive('recommended');
      }
    },
  });

  actions.append(readAction, saveAction, shareAction, recommendAction);
  return actions;
};

const createImage = (entry, className) => {
  if (!entry.image || !entry.image.trim()) {
    return null;
  }

  const image = document.createElement('img');
  image.src = entry.image;
  image.alt = entry.title ? `${entry.title} illustration` : 'Article image';
  image.loading = 'lazy';
  image.decoding = 'async';
  if (className) {
    image.className = className;
  }

  return image;
};

const createFeaturedCard = (entry) => {
  const card = document.createElement('article');
  card.className = 'featured-card';

  const heroImage = createImage(entry, 'featured-image');
  if (heroImage) {
    card.appendChild(heroImage);
  }

  const content = document.createElement('div');
  content.className = 'featured-content';

  const title = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.href = entry.link || '#';
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.textContent = entry.title || 'Untitled article';
  title.appendChild(titleLink);

  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = entry.subtitle || truncate(entry.summary, 160) || 'Untitled story';

  const summary = document.createElement('p');
  summary.className = 'summary';
  summary.textContent = dedupeSummary(subtitle.textContent, truncate(entry.summary, 260));

  const timeTag = createTimeTag(entry);
  const actions = createActions(entry);
  const meta = createMeta(entry);

  content.append(timeTag, title, subtitle, summary, meta, actions);
  card.appendChild(content);

  return card;
};

const createArticleCard = (entry) => {
  const card = document.createElement('article');
  card.className = 'article-card';

  const elements = [];

  const leadImage = createImage(entry);
  if (leadImage) {
    elements.push(leadImage);
  }

  const timeTag = createTimeTag(entry);
  elements.push(timeTag);

  const title = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.href = entry.link || '#';
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.textContent = entry.title || 'Untitled article';
  title.appendChild(titleLink);

  elements.push(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = entry.subtitle || truncate(entry.summary, 140);

  if (subtitle.textContent) {
    elements.push(subtitle);
  }

  const summaryText = dedupeSummary(subtitle.textContent, truncate(entry.summary, 220));

  if (summaryText) {
    const summary = document.createElement('p');
    summary.className = 'summary';
    summary.textContent = summaryText;
    elements.push(summary);
  }

  const meta = createMeta(entry);
  elements.push(meta);

  const actions = createActions(entry);
  elements.push(actions);
  card.append(...elements);

  return card;
};

const renderEntries = (feed) => {
  const { entries, categoryName } = feed;
  latestFeed = { entries };

  analysisSection.hidden = true;
  analysisContent.innerHTML = '';
  analysisMeta.textContent = '';

  entriesContainer.innerHTML = '';
  featuredContainer.innerHTML = '';

  summaryEl.textContent = STORIES_HEADING;

  activeEditionEl.hidden = false;
  const editionName = categoryName || 'Perry Mill';
  activeEditionEl.textContent = `${editionName} edition`;
  analysisHeadlineEl.textContent = `${editionName} edition`;
  setInsightsLabel('idle');

  const entriesWithImages = entries.filter((entry) => entry.image && entry.image.trim());
  const featured = entriesWithImages.slice(0, 3);
  const remainder = entries.filter((entry) => !featured.includes(entry));

  featured.forEach((entry) => {
    featuredContainer.appendChild(createFeaturedCard(entry));
  });

  const contentEntries = [...remainder];
  if (featured.length === 0) {
    contentEntries.splice(0, 0, ...entries.slice(0, 3));
  }

  contentEntries.forEach((entry) => {
    entriesContainer.appendChild(createArticleCard(entry));
  });

  if (!featuredContainer.childElementCount) {
    featuredContainer.style.display = 'none';
  } else {
    featuredContainer.style.display = '';
  }
};

const setStatus = (message, isError = false) => {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
};

const toggleBusy = (isBusy) => {
  submitBtn.disabled = isBusy;
  submitBtn.textContent = isBusy ? 'Refreshing…' : 'Refresh';
};

const fetchFeed = async () => {
  const authenticated = await requireAuthentication();
  if (!authenticated || !configLoaded) {
    return;
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  if (!payload.category) {
    setStatus('Select a Perry Mill edition.', true);
    return;
  }

  toggleBusy(true);
  setStatus('Fetching feed…');

  try {
    const response = await authFetch('/api/feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    setStatus(`${data.categoryName || 'Edition'} refreshed.`);
    renderEntries(data);
    lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (error) {
    console.error('Feed fetch error:', error);
    setStatus(error.message || 'Failed to load feed.', true);
    clearResults();
  } finally {
    toggleBusy(false);
  }
};

form.addEventListener('submit', (event) => {
  event.preventDefault();
  fetchFeed();
});

autoRefreshCheckbox.addEventListener('change', () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (autoRefreshCheckbox.checked) {
    refreshTimer = setInterval(fetchFeed, 5 * 60 * 1000);
    autoRefreshHint.textContent = 'Auto-refresh on';
  }
});

autoRefreshCheckbox.addEventListener('change', () => {
  if (!autoRefreshCheckbox.checked) {
    autoRefreshHint.textContent = 'Manual refresh';
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    return;
  }

  if (!autoRefreshCheckbox.checked && latestFeed) {
    lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
});

aiAnalyzeButton.addEventListener('click', async () => {
  const authenticated = await requireAuthentication();
  if (!authenticated) {
    return;
  }

  if (!latestFeed) {
    setStatus('Fetch headlines before generating a Perry Mill insight.', true);
    return;
  }

  setStatus('Crafting a Perry Mill summary…');
  aiAnalyzeButton.disabled = true;
  setInsightsLabel('working');

  authFetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feed: latestFeed,
    }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      return response.json();
    })
    .then((data) => {
      const narrative = data.narrative || '';
      if (!narrative) {
        setStatus('Perry Mill summary returned empty content.', true);
        return;
      }

      analysisContent.innerHTML = '';
      const paragraphs = narrative.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);

      if (!paragraphs.length) {
        paragraphs.push(`${feed.categoryName || 'Perry Mill'} edition highlights`);
      }

      paragraphs.forEach((paragraph, index) => {
        const p = document.createElement('p');
        p.textContent = paragraph;
        if (index === 0) {
          p.classList.add('lede');
        }
        analysisContent.appendChild(p);
      });

      const tokens = data.usage?.total_tokens;
      analysisMeta.textContent = tokens ? `Tokens used: ${tokens}` : '';

      analysisSection.hidden = false;
      setStatus('Perry Mill summary ready.');
      setInsightsLabel('refresh');
    })
    .catch((error) => {
      console.error('AI analysis error:', error);
      setStatus(error.message || 'Perry Mill summary failed.', true);
      setInsightsLabel('idle');
    })
    .finally(() => {
      aiAnalyzeButton.disabled = false;
      if (!analysisSection.hidden) {
        setInsightsLabel('refresh');
      }
    });
});

const initializeAuthUi = () => {
  if (authLoginButton) {
    authLoginButton.addEventListener('click', () => {
      showAuthError('');
      openAuthModal();
      authEmailInput?.focus();
    });
  }

  if (authCancelButton) {
    authCancelButton.addEventListener('click', () => {
      closeAuthModal();
    });
  }

  if (authCloseButton) {
    authCloseButton.addEventListener('click', () => {
      closeAuthModal();
    });
  }

  if (authBackdrop) {
    authBackdrop.addEventListener('click', () => {
      closeAuthModal();
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', handleAuthSubmit);
  }

  if (authLogoutButton) {
    authLogoutButton.addEventListener('click', handleLogout);
  }
};

const boot = async () => {
  attachAuthListeners();
  initializeAuthUi();
  await initializeAuthFromStorage();
  const configured = await loadConfig({ silent: true });
  if (configured) {
    fetchFeed();
  }
};

boot().catch((error) => {
  console.error('Failed to initialize application:', error);
});

const applyConfig = (cfg) => {
  config = cfg;
  renderNavigation(cfg.feeds || []);
  if ((cfg.feeds || []).length) {
    selectCategory((cfg.feeds || [])[0].slug);
  }
  if (!config.hasOpenAIKey) {
    aiAnalyzeButton.disabled = true;
    aiAnalyzeButton.title = 'Add an OpenAI API key to enable insights.';
  } else {
    aiAnalyzeButton.disabled = false;
    aiAnalyzeButton.removeAttribute('title');
  }
};

const renderNavigation = (feeds) => {
  navContainer.innerHTML = '';

  feeds.forEach((feed) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-item';
    button.dataset.slug = feed.slug;
    button.innerHTML = `
      <span class="catalog-title">${feed.name}</span>
      <span class="catalog-description">${feed.description}</span>
    `;

    button.addEventListener('click', () => {
      selectCategory(feed.slug);
      fetchFeed();
    });

    navContainer.appendChild(button);
  });
};

const selectCategory = (slug) => {
  if (!slug) {
    return;
  }

  categoryInput.value = slug;

  [...navContainer.querySelectorAll('.catalog-item')].forEach((button) => {
    button.classList.toggle('active', button.dataset.slug === slug);
  });
};

apiFetch('/api/config')
  .then((response) => response.json())
  .then((data) => {
    applyConfig(data);
    if ((data.feeds || []).length) {
      fetchFeed();
    }
    migrateQueueToSaved();
    if (libraryButtons.length) {
      libraryButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const type = button.dataset.library;
          if (type && LIBRARY_KEYS[type]) {
            showLibrary(type);
          }
        });
      });
      try {
        const storedTab = localStorage.getItem(LIBRARY_TAB_KEY);
        if (storedTab && LIBRARY_KEYS[storedTab]) {
          showLibrary(storedTab);
        } else {
          showLibrary(activeLibrary);
        }
      } catch (error) {
        console.warn('Failed to read library tab:', error);
        showLibrary(activeLibrary);
      }
    }
    const readerElements = [readerBackdrop, readerCloseButton];
    readerElements.forEach((element) => {
      if (!element) {
        return;
      }

      element.addEventListener('click', () => {
        closeReader();
      });
    });

    if (reader) {
      reader.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          closeReader();
        }
      });
    }

    const libraryElements = [libraryBackdrop, libraryCloseButton];
    libraryElements.forEach((element) => {
      if (!element) {
        return;
      }

      element.addEventListener('click', () => {
        closeLibrary();
      });
    });

    if (libraryOpenButton) {
      libraryOpenButton.addEventListener('click', () => {
        showLibrary(activeLibrary);
        openLibrary();
      });
    }

    if (libraryModal) {
      libraryModal.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          closeLibrary();
        }
      });
    }
  })
  .catch((error) => {
    console.error('Config load error:', error);
  });
