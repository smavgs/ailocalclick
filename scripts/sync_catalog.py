#!/usr/bin/env python3
"""Synchronize Ollama's official library listing into a static JSON snapshot.

The synchronizer intentionally uses only Python's standard library and one
official source URL. It extracts base-library entries, not the unbounded set of
community namespaces returned by Ollama search.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


DEFAULT_SOURCE = "https://ollama.com/library?sort=newest"
CAPABILITIES = {"vision", "tools", "thinking", "embedding", "cloud", "audio"}
MODEL_HREF = re.compile(r"^/library/([^/?#:]+)$")
PULLS = re.compile(r"([0-9]+(?:\.[0-9]+)?[KMB]?)\s+Pulls?", re.IGNORECASE)
TAGS = re.compile(r"([0-9]+)\s+Tags?", re.IGNORECASE)
UPDATED = re.compile(r"Updated\s+(.+?)$", re.IGNORECASE)


@dataclass
class Entry:
    slug: str
    href: str
    description_parts: list[str] = field(default_factory=list)
    all_parts: list[str] = field(default_factory=list)
    badges: list[str] = field(default_factory=list)
    updated_at: str | None = None


class LibraryParser(HTMLParser):
    """Extract model rows from Ollama's server-rendered library page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[Entry] = []
        self.current: Entry | None = None
        self.anchor_depth = 0
        self.description_depth = 0
        self.badge_depth = 0
        self.badge_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if self.current is None and tag == "a":
            href = attributes.get("href") or ""
            match = MODEL_HREF.match(href)
            if match:
                self.current = Entry(slug=match.group(1), href=href)
                self.anchor_depth = 1
                return

        if self.current is None:
            return

        if tag == "a":
            self.anchor_depth += 1

        if self.description_depth:
            self.description_depth += 1
        elif tag == "p" and "max-w-lg" in (attributes.get("class") or "").split():
            self.description_depth = 1

        if self.badge_depth:
            self.badge_depth += 1
        elif tag == "span":
            classes = set((attributes.get("class") or "").split())
            if "inline-flex" in classes and any(name.startswith("bg-") for name in classes):
                self.badge_depth = 1
                self.badge_parts = []

            title = attributes.get("title") or ""
            parsed = parse_ollama_datetime(title)
            if parsed:
                self.current.updated_at = parsed

    def handle_data(self, data: str) -> None:
        if self.current is None:
            return
        text = collapse(data)
        if not text:
            return
        self.current.all_parts.append(text)
        if self.description_depth:
            self.current.description_parts.append(text)
        if self.badge_depth:
            self.badge_parts.append(text)

    def handle_endtag(self, tag: str) -> None:
        if self.current is None:
            return

        if self.description_depth:
            self.description_depth -= 1

        if self.badge_depth:
            self.badge_depth -= 1
            if self.badge_depth == 0:
                badge = collapse(" ".join(self.badge_parts)).lower()
                if badge and badge not in self.current.badges:
                    self.current.badges.append(badge)
                self.badge_parts = []

        if tag == "a":
            self.anchor_depth -= 1
            if self.anchor_depth == 0:
                self.entries.append(self.current)
                self.current = None


def collapse(value: str) -> str:
    return " ".join(value.split())


def parse_ollama_datetime(value: str) -> str | None:
    if not value.endswith(" UTC"):
        return None
    try:
        parsed = datetime.strptime(value, "%b %d, %Y %I:%M %p UTC").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return parsed.isoformat().replace("+00:00", "Z")


def parse_pull_count(value: str) -> int:
    suffix = value[-1].upper() if value else ""
    multiplier = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get(suffix, 1)
    number = value[:-1] if multiplier != 1 else value
    try:
        return int(float(number) * multiplier)
    except ValueError:
        return 0


def entry_to_model(entry: Entry) -> dict[str, object]:
    full_text = collapse(" ".join(entry.all_parts))
    pulls_match = PULLS.search(full_text)
    tags_match = TAGS.search(full_text)
    updated_match = UPDATED.search(full_text)
    pulls = pulls_match.group(1).upper() if pulls_match else "0"
    badges = [badge for badge in entry.badges if badge]
    capabilities = [badge for badge in badges if badge in CAPABILITIES]
    sizes = [badge for badge in badges if badge not in CAPABILITIES]

    return {
        "slug": entry.slug,
        "name": entry.slug,
        "description": collapse(" ".join(entry.description_parts)),
        "capabilities": capabilities,
        "sizes": sizes,
        "pulls": pulls,
        "pullCount": parse_pull_count(pulls),
        "tagCount": int(tags_match.group(1)) if tags_match else 0,
        "updatedAt": entry.updated_at,
        "updatedLabel": updated_match.group(1) if updated_match else "unknown",
        "officialUrl": f"https://ollama.com/library/{quote(entry.slug)}",
        "runCommand": f"ollama run {entry.slug}",
    }


def parse_library(html: str) -> list[dict[str, object]]:
    parser = LibraryParser()
    parser.feed(html)
    parser.close()

    deduplicated: dict[str, dict[str, object]] = {}
    for entry in parser.entries:
        model = entry_to_model(entry)
        if model["description"]:
            deduplicated[entry.slug] = model

    return sorted(
        deduplicated.values(),
        key=lambda model: (model["updatedAt"] or "", model["name"]),
        reverse=True,
    )


def validate(models: Iterable[dict[str, object]], minimum: int) -> list[dict[str, object]]:
    materialized = list(models)
    if len(materialized) < minimum:
        raise ValueError(f"Expected at least {minimum} models, found {len(materialized)}")
    for model in materialized:
        if not model["name"] or not model["description"] or not model["officialUrl"]:
            raise ValueError(f"Incomplete catalog entry: {model!r}")
    return materialized


def download(url: str, timeout: int) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "ailocal.click catalog sync (+https://github.com/smavgs/ailocalclick)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def write_snapshot(output: Path, source: str, models: list[dict[str, object]]) -> None:
    payload = {
        "source": {
            "name": "Ollama official model library",
            "url": source,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "modelCount": len(models),
            "scope": "Base models listed in Ollama's official library; community search namespaces are not enumerated.",
        },
        "models": models,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(output)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--input", type=Path, help="Parse a local HTML fixture instead of downloading")
    parser.add_argument("--output", type=Path, default=Path("src/data/models.json"))
    parser.add_argument("--minimum", type=int, default=150)
    parser.add_argument("--timeout", type=int, default=30)
    return parser.parse_args()


def main() -> int:
    args = arguments()
    try:
        html = args.input.read_text(encoding="utf-8") if args.input else download(args.source, args.timeout)
        models = validate(parse_library(html), args.minimum)
        write_snapshot(args.output, args.source, models)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        print(f"Catalog sync failed: {error}", file=sys.stderr)
        return 1

    print(f"Synced {len(models)} models from {args.source} to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
