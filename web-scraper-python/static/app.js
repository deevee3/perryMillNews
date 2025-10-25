const runtimeConfig = window.__CONFIG__ || {};

const normalizeBaseUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\/+$/, '');
};

const apiBaseUrl = normalizeBaseUrl(runtimeConfig.apiBaseUrl);

const withApiBase = (path) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
};

const apiFetch = (path, options) => fetch(withApiBase(path), options);

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
let activeLibrary = 'saved';
let lastFocusedElement = null;

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
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  if (!payload.category) {
    setStatus('Select a Perry Mill edition.', true);
    return;
  }

  toggleBusy(true);
  setStatus('Fetching feed…');

  try {
    const response = await apiFetch('/api/feed', {
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

aiAnalyzeButton.addEventListener('click', () => {
  if (!latestFeed) {
    setStatus('Fetch headlines before generating a Perry Mill insight.', true);
    return;
  }

  setStatus('Crafting a Perry Mill summary…');
  aiAnalyzeButton.disabled = true;
  setInsightsLabel('working');

  apiFetch('/api/analyze', {
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

// Load default feed on startup
fetchFeed();

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
