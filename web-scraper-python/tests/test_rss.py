import time
import types

import pytest

import rss


def test_fetch_feed_normalizes_entries(monkeypatch):
    """Feed entries should normalize HTML content and metadata."""

    parsed = types.SimpleNamespace(
        bozo=False,
        feed={"title": "Sample Feed", "link": "https://example.com/feed"},
        entries=[
            {
                "title": "Breaking Story",
                "link": "https://example.com/story",
                "summary": "<p>Summary <strong>content</strong>.</p><img src=\"https://example.com/image.jpg\"/>",
                "published_parsed": time.struct_time((2024, 7, 4, 10, 30, 0, 3, 186, -1)),
                "source": {"title": "Example Source"},
            },
            {
                "title": "Ignored Story",
                "link": "https://example.com/ignored",
                "summary": "<p>Another summary</p>",
                "published_parsed": time.struct_time((2024, 7, 4, 11, 0, 0, 3, 186, -1)),
            },
        ],
    )

    monkeypatch.setattr("rss.feedparser.parse", lambda url: parsed)

    result = rss.fetch_feed("https://example.com/feed", limit=1)

    assert result.feed_title == "Sample Feed"
    assert result.feed_link == "https://example.com/feed"
    assert len(result.entries) == 1

    entry = result.entries[0]
    assert entry.title == "Breaking Story"
    assert entry.link == "https://example.com/story"
    assert entry.summary == "Summary content ."
    assert entry.subtitle == "Summary content ."
    assert entry.image == "https://example.com/image.jpg"
    assert entry.source == "Example Source"
    assert entry.published == "2024-07-04T10:30:00"


def test_fetch_feed_raises_on_bozo(monkeypatch):
    parsed = types.SimpleNamespace(
        bozo=True,
        bozo_exception=ValueError("boom"),
        feed={},
        entries=[],
    )

    monkeypatch.setattr("rss.feedparser.parse", lambda url: parsed)

    with pytest.raises(ValueError) as excinfo:
        rss.fetch_feed("https://example.com/feed")

    assert "Unable to parse feed" in str(excinfo.value)
