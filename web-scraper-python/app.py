from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests
from flask import Flask, jsonify, request, send_from_directory
from dotenv import load_dotenv

from rss import DEFAULT_FEED_URL, fetch_feed

load_dotenv()

HOST = os.environ.get('HOST', '127.0.0.1')
APP_PORT = int(os.environ.get('PORT', '5100'))
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '').strip()

CURATED_FEEDS: Dict[str, Dict[str, str]] = {
  'top-stories': {
    'name': 'Front Page',
    'description': 'Morning digest of the most relevant headlines.',
    'url': DEFAULT_FEED_URL,
  },
  'business': {
    'name': 'Business Ledger',
    'description': 'Market movers, finance news, and boardroom shifts.',
    'url': 'https://rss.feedspot.com/folder/4BnLtF8d5g==/rss/rsscombiner',
  },
  'science': {
    'name': 'Science Dispatch',
    'description': 'Discoveries across biology, research, and innovation.',
    'url': 'https://rss.feedspot.com/folder/5hnLtWAh7A==/rss/rsscombiner',
  },
}

app = Flask(__name__, static_folder='static', static_url_path='')


def _serialize_feed(feed_result, *, category: str, feed_meta: Dict[str, str]) -> Dict[str, Any]:
  payload = feed_result.to_dict()
  payload['category'] = category
  payload['categoryName'] = feed_meta.get('name', '')
  payload['categoryDescription'] = feed_meta.get('description', '')
  return payload


@app.get('/')
def root():
  return send_from_directory(app.static_folder, 'index.html')


@app.get('/api/config')
def api_config():
  return jsonify({
    'hasOpenAIKey': bool(OPENAI_API_KEY),
    'feeds': [
      {
        'slug': slug,
        'name': meta.get('name', ''),
        'description': meta.get('description', ''),
      }
      for slug, meta in CURATED_FEEDS.items()
    ],
  })


@app.post('/api/feed')
def api_feed():
  payload: Dict[str, Any] = request.get_json(silent=True) or {}
  category = str(payload.get('category') or 'top-stories').strip().lower()
  feed_meta = CURATED_FEEDS.get(category)
  if not feed_meta:
    return jsonify({'error': 'Unknown feed category.'}), 400

  feed_url = feed_meta['url'] or DEFAULT_FEED_URL
  limit_raw = payload.get('limit')

  limit: Optional[int] = None
  if isinstance(limit_raw, (str, int, float)):
    try:
      limit = int(limit_raw)
    except (TypeError, ValueError):
      limit = None

  try:
    feed_result = fetch_feed(feed_url, limit=limit)
  except Exception as exc:  # pylint: disable=broad-except
    return jsonify({'error': str(exc)}), 400

  return jsonify(_serialize_feed(feed_result, category=category, feed_meta=feed_meta))


def _build_prompt(feed: Dict[str, Any]) -> str:
  entries = feed.get('entries') or []
  lines = []
  for entry in entries[:15]:
    title = entry.get('title', '').strip()
    summary = entry.get('summary', '').strip()
    source = entry.get('source', 'Unknown source')
    published = entry.get('published')
    lines.append(f"Title: {title}\nSource: {source}\nPublished: {published}\nSummary: {summary}\n")

  joined = "\n".join(lines)
  return (
    "You are an editorial AI assistant summarizing the latest news items for a digest called 'Perry Mill'. "
    "Write a concise narrative (3-5 paragraphs) highlighting the major themes, noteworthy events, and overall sentiment. "
    "Tie related stories together, and mention sources when useful. Avoid bullet lists; respond with polished prose.\n\n"
    f"Stories:\n{joined}"
  )


@app.post('/api/analyze')
def api_analyze():
  if not OPENAI_API_KEY:
    return jsonify({'error': 'Server missing OpenAI API key.'}), 500

  payload: Dict[str, Any] = request.get_json(silent=True) or {}
  feed = payload.get('feed')

  if not isinstance(feed, dict):
    return jsonify({'error': 'Feed payload is required for analysis.'}), 400

  prompt = _build_prompt(feed)

  try:
    response = requests.post(
      'https://api.openai.com/v1/chat/completions',
      headers={
        'Authorization': f'Bearer {OPENAI_API_KEY}',
        'Content-Type': 'application/json',
      },
      json={
        'model': 'gpt-4o-mini',
        'messages': [
          {'role': 'system', 'content': 'You are a seasoned news editor.'},
          {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.7,
      },
      timeout=30,
    )
    response.raise_for_status()
  except requests.RequestException as exc:
    return jsonify({'error': f'Failed to contact OpenAI: {exc}'}), 502

  data = response.json()

  narrative = None
  try:
    narrative = data['choices'][0]['message']['content'].strip()
  except (KeyError, IndexError, AttributeError):
    narrative = data.get('choices', [{}])[0].get('text')

  if not narrative:
    return jsonify({'error': 'OpenAI returned an empty response.'}), 502

  usage = data.get('usage', {})

  return jsonify({
    'narrative': narrative,
    'usage': usage,
  })


if __name__ == '__main__':
  app.run(host=HOST, port=APP_PORT, debug=False)
