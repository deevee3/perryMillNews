import { XMLParser } from 'fast-xml-parser';
import { jsonResponse } from './response.js';

const CURATED_FEEDS = {
  'top-stories': {
    name: 'Front Page',
    description: 'Morning digest of the most relevant headlines.',
    url: 'https://rss.feedspot.com/u/72252f9f2933826fe9d1a2da83d6122c/rss/rsscombiner',
  },
  business: {
    name: 'Business Ledger',
    description: 'Market movers, finance news, and boardroom shifts.',
    url: 'https://rss.feedspot.com/folder/4BnLtF8d5g==/rss/rsscombiner',
  },
  science: {
    name: 'Science Dispatch',
    description: 'Discoveries across biology, research, and innovation.',
    url: 'https://rss.feedspot.com/folder/5hnLtWAh7A==/rss/rsscombiner',
  },
};

const DEFAULT_FEED_URL = CURATED_FEEDS['top-stories'].url;
const MAX_ITEMS = 100;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  allowBooleanAttributes: true,
  htmlEntities: true,
  parseTagValue: false,
  trimValues: false,
});

const toArray = (value) => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const stripHtml = (value) => {
  if (!value || typeof value !== 'string') {
    return '';
  }
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

const firstSentence = (text) => {
  if (!text) {
    return null;
  }
  const sentences = text.match(/[^.!?]+[.!?]/g);
  const first = sentences ? sentences[0] : text;
  const trimmed = first.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157).trim()}…` : trimmed;
};

const extractImageFromHtml = (html) => {
  if (!html || typeof html !== 'string') {
    return null;
  }
  const match = html.match(/<img [^>]*src=["']?([^"'>\s]+)/i);
  return match ? match[1] : null;
};

const extractImage = (item) => {
  const mediaContent = toArray(item['media:content'] || item.mediaContent);
  for (const media of mediaContent) {
    const url = media?.url || media?.href || media?.src;
    if (url) {
      return url;
    }
  }

  const mediaThumb = toArray(item['media:thumbnail'] || item.mediaThumbnail);
  for (const media of mediaThumb) {
    const url = media?.url || media?.href || media?.src;
    if (url) {
      return url;
    }
  }

  const enclosure = toArray(item.enclosure);
  for (const en of enclosure) {
    const url = en?.url || en?.href;
    const type = (en?.type || '').toLowerCase();
    if (url && (!type || type.startsWith('image'))) {
      return url;
    }
  }

  const description = item.description || item.summary || item['content:encoded'];
  return extractImageFromHtml(description);
};

const parseDate = (value) => {
  if (!value) {
    return null;
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return null;
    }
    return date.toISOString();
  } catch (error) {
    return null;
  }
};

const buildFeedEntry = (item) => {
  const link =
    (typeof item.link === 'string' && item.link.trim()) ||
    (typeof item.link === 'object' && item.link?.href) ||
    (typeof item.link === 'object' && item.link?.['@_href']) ||
    (Array.isArray(item.link) && item.link.length && (item.link[0]?.href || item.link[0])) ||
    '';

  const summary = stripHtml(item.description || item.summary || item['content:encoded']);
  const subtitle = firstSentence(summary);

  let source = null;
  if (item.source) {
    source = item.source?.title || item.source?.name || item.source;
  }
  if (!source && link) {
    try {
      source = new URL(link).hostname;
    } catch (error) {
      source = null;
    }
  }

  return {
    title: (item.title || '').trim(),
    summary,
    link,
    published: parseDate(item.pubDate || item.published || item.updated),
    source: source || null,
    subtitle: subtitle || null,
    image: extractImage(item),
  };
};

const fetchFeed = async (feedUrl, limit) => {
  const response = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'PerryMill/1.0 (+https://perrymill.dev)',
    },
  });

  if (!response.ok) {
    throw new Error(`Feed fetch failed (${response.status})`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);

  const channel = parsed?.rss?.channel || parsed?.feed || parsed?.channel;
  if (!channel) {
    throw new Error('Unable to parse feed payload.');
  }

  const feedTitle =
    (channel.title && (typeof channel.title === 'string' ? channel.title : channel.title?.['#text'])) ||
    'RSS Feed';
  const feedLink =
    (channel.link && (typeof channel.link === 'string' ? channel.link : channel.link?.href || channel.link?.['@_href'])) ||
    feedUrl;

  const entriesRaw = toArray(channel.item || channel.entry || []);

  const effectiveLimit = (() => {
    if (typeof limit !== 'number' || Number.isNaN(limit) || limit <= 0) {
      return Math.min(entriesRaw.length, MAX_ITEMS);
    }
    return Math.min(Math.floor(limit), MAX_ITEMS);
  })();

  const entries = entriesRaw.slice(0, effectiveLimit).map(buildFeedEntry);

  return {
    feedTitle,
    feedLink,
    entries,
  };
};

const buildPrompt = (feed) => {
  const entries = Array.isArray(feed.entries) ? feed.entries : [];
  const lines = entries.slice(0, 15).map((entry) => {
    const title = (entry.title || '').trim();
    const summary = (entry.summary || '').trim();
    const source = entry.source || 'Unknown source';
    const published = entry.published || 'Unknown date';
    return `Title: ${title}\nSource: ${source}\nPublished: ${published}\nSummary: ${summary}\n`;
  });

  const joined = lines.join('\n');
  return (
    "You are an editorial AI assistant summarizing the latest news items for a digest called 'Perry Mill'. " +
    'Write a concise narrative (3-5 paragraphs) highlighting the major themes, noteworthy events, and overall sentiment. ' +
    'Tie related stories together, and mention sources when useful. Avoid bullet lists; respond with polished prose.\n\n' +
    `Stories:\n${joined}`
  );
};

export const handleConfig = (env) =>
  jsonResponse({
    hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
    feeds: Object.entries(CURATED_FEEDS).map(([slug, meta]) => ({
      slug,
      name: meta.name,
      description: meta.description,
    })),
  });

export const handleFeed = async (request) => {
  let payload = {};
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400);
  }

  const rawCategory = (payload.category || 'top-stories').toString().trim().toLowerCase();
  const feedMeta = CURATED_FEEDS[rawCategory];
  if (!feedMeta) {
    return jsonResponse({ error: 'Unknown feed category.' }, 400);
  }

  const limitRaw = payload.limit;
  const limit = typeof limitRaw === 'number' ? limitRaw : Number.parseInt(limitRaw, 10);

  try {
    const feedResult = await fetchFeed(feedMeta.url || DEFAULT_FEED_URL, limit);
    return jsonResponse({
      ...feedResult,
      category: rawCategory,
      categoryName: feedMeta.name,
      categoryDescription: feedMeta.description,
    });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Failed to load feed.' }, 400);
  }
};

export const handleAnalyze = async (request, env) => {
  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ error: 'Server missing OpenAI API key.' }, 500);
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400);
  }

  const { feed } = payload;
  if (!feed || typeof feed !== 'object') {
    return jsonResponse({ error: 'Feed payload is required for analysis.' }, 400);
  }

  const prompt = buildPrompt(feed);

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a seasoned news editor.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
    });
  } catch (error) {
    return jsonResponse({ error: `Failed to contact OpenAI: ${error.message}` }, 502);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    return jsonResponse({ error: `OpenAI responded with ${response.status}: ${errorBody}` }, 502);
  }

  const data = await response.json();
  const narrative = data?.choices?.[0]?.message?.content?.trim() || data?.choices?.[0]?.text?.trim();

  if (!narrative) {
    return jsonResponse({ error: 'OpenAI returned an empty response.' }, 502);
  }

  return jsonResponse({
    narrative,
    usage: data.usage || {},
  });
};
