from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import feedparser
from bs4 import BeautifulSoup

DEFAULT_FEED_URL = 'https://rss.feedspot.com/u/72252f9f2933826fe9d1a2da83d6122c/rss/rsscombiner'
MAX_ITEMS = 100


@dataclass(slots=True)
class FeedEntry:
  title: str
  summary: str
  link: str
  published: Optional[str]
  source: Optional[str]
  subtitle: Optional[str]
  image: Optional[str]


@dataclass(slots=True)
class FeedResult:
  feed_title: str
  feed_link: str
  entries: List[FeedEntry]

  def to_dict(self) -> Dict[str, Any]:
    return {
      'feedTitle': self.feed_title,
      'feedLink': self.feed_link,
      'entries': [asdict(entry) for entry in self.entries],
    }


def _extract_plain_text(html_fragment: Optional[str]) -> str:
  if not html_fragment:
    return ''

  soup = BeautifulSoup(html_fragment, 'html.parser')
  return soup.get_text(separator=' ', strip=True)


def _extract_image(entry: feedparser.FeedParserDict) -> Optional[str]:
  media_content = entry.get('media_content')
  if isinstance(media_content, list):
    for item in media_content:
      if isinstance(item, dict):
        url = item.get('url') or item.get('href')
        if url:
          return url

  media_thumbnail = entry.get('media_thumbnail')
  if isinstance(media_thumbnail, list):
    for item in media_thumbnail:
      if isinstance(item, dict):
        url = item.get('url') or item.get('href')
        if url:
          return url

  for link in entry.get('links', []) or []:
    if isinstance(link, dict) and link.get('type', '').startswith('image') and link.get('href'):
      return link['href']

  summary_detail = entry.get('summary_detail')
  if isinstance(summary_detail, dict):
    html_value = summary_detail.get('value')
    if html_value:
      soup = BeautifulSoup(html_value, 'html.parser')
      image_tag = soup.find('img')
      if image_tag and image_tag.get('src'):
        return image_tag['src']

  summary_html = entry.get('summary') or entry.get('description')
  if summary_html:
    soup = BeautifulSoup(summary_html, 'html.parser')
    image_tag = soup.find('img')
    if image_tag and image_tag.get('src'):
      return image_tag['src']

  return None


def _derive_subtitle(entry: feedparser.FeedParserDict, summary_text: str) -> Optional[str]:
  subtitle_candidate = entry.get('subtitle')
  if subtitle_candidate:
    return _extract_plain_text(subtitle_candidate)

  summary_detail = entry.get('summary_detail')
  if isinstance(summary_detail, dict) and summary_detail.get('value'):
    detail_text = _extract_plain_text(summary_detail.get('value'))
    if detail_text:
      subtitle_candidate = detail_text

  if not subtitle_candidate and summary_text:
    subtitle_candidate = summary_text

  if not subtitle_candidate:
    return None

  sentences = re.split(r'(?<=\.)\s+', subtitle_candidate)
  primary = sentences[0] if sentences else subtitle_candidate
  trimmed = primary.strip()
  if len(trimmed) > 160:
    return trimmed[:157].rstrip() + '…'
  return trimmed or None


def _format_datetime(struct_time: Optional[Any]) -> Optional[str]:
  if not struct_time:
    return None

  try:
    dt = datetime(
      year=struct_time.tm_year,
      month=struct_time.tm_mon,
      day=struct_time.tm_mday,
      hour=struct_time.tm_hour,
      minute=struct_time.tm_min,
      second=struct_time.tm_sec,
    )
    return dt.isoformat()
  except (TypeError, ValueError):
    return None


def _normalize_entry(entry: feedparser.FeedParserDict) -> FeedEntry:
  title = (entry.get('title') or '').strip()
  link = (entry.get('link') or '').strip()
  summary = _extract_plain_text(entry.get('summary') or entry.get('description'))

  published = entry.get('published_parsed') or entry.get('updated_parsed')
  published_iso = _format_datetime(published)

  source = None
  if 'source' in entry and isinstance(entry['source'], dict):
    source = (entry['source'].get('title') or '').strip() or None

  if not source and link:
    parsed = urlparse(link)
    if parsed.netloc:
      source = parsed.netloc

  image = _extract_image(entry)
  subtitle = _derive_subtitle(entry, summary)

  return FeedEntry(
    title=title,
    summary=summary,
    link=link,
    published=published_iso,
    source=source,
    subtitle=subtitle,
    image=image,
  )


def fetch_feed(feed_url: str = DEFAULT_FEED_URL, *, limit: Optional[int] = None) -> FeedResult:
  url = (feed_url or DEFAULT_FEED_URL).strip()
  parsed = feedparser.parse(url)

  if parsed.bozo and getattr(parsed, 'bozo_exception', None):
    raise ValueError(f'Unable to parse feed: {parsed.bozo_exception}')

  feed_title = (parsed.feed.get('title') if parsed.feed else '') or 'RSS Feed'
  feed_link = (parsed.feed.get('link') if parsed.feed else '') or url

  effective_limit = MAX_ITEMS
  if limit is not None and isinstance(limit, (int, float)):
    if limit <= 0:
      effective_limit = MAX_ITEMS
    else:
      effective_limit = min(int(limit), MAX_ITEMS)

  entries = [
    _normalize_entry(entry)
    for entry in parsed.entries[:effective_limit]
  ]

  return FeedResult(feed_title=feed_title, feed_link=feed_link, entries=entries)
