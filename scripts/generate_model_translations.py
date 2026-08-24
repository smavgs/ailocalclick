#!/usr/bin/env python3
"""Generate reviewed, static model-description translations with local Ollama.

The generated files are shipped with the static site. No translation request is
made by a visitor's browser, and English remains the safe fallback for a newly
listed model until this maintenance script is run again.
"""

from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
from http.client import RemoteDisconnected
import json
import re
import time
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "src/data/models.json"
OUTPUT_DIRECTORY = ROOT / "src/i18n/model-descriptions"
DEFAULT_MODEL = "qwen3.5:9b"
DEFAULT_ENDPOINT = "http://127.0.0.1:11434/api/chat"
LOCALES = {
    "ru": (
        "Russian",
        "Use fluent modern Russian for a technical product directory. Use established Russian AI terminology while keeping trademarks, model names, benchmark names, code, and parameter labels unchanged.",
    ),
    "ko": (
        "Korean",
        "Use natural professional Korean suitable for a Korean technology directory. Use Korean explanatory prose throughout; never insert Chinese characters into a Korean word and never leave an English marketing phrase such as state-of-the-art untranslated. Translate 'to date' or 'so far' as '현재까지', never with Chinese characters. Keep trademarks, model names, benchmark names, code, and parameter labels unchanged.",
    ),
    "ja": (
        "Japanese",
        "Use concise natural Japanese suitable for a Japanese technology directory. Every explanatory sentence must be Japanese and use normal Japanese kana and particles; never output Chinese prose. Keep trademarks, model names, benchmark names, code, and parameter labels unchanged.",
    ),
    "zh-CN": (
        "Simplified Chinese",
        "Use concise natural Simplified Chinese suitable for a mainland Chinese technology directory. Translate general English phrases such as state-of-the-art completely and never create mixed English-Chinese words. Keep trademarks, model names, benchmark names, code, and parameter labels unchanged.",
    ),
}
TARGET_SCRIPT = {
    "ru": re.compile(r"[А-Яа-яЁё]"),
    "ko": re.compile(r"[가-힣]"),
    "ja": re.compile(r"[ぁ-んァ-ン]"),
    "zh-CN": re.compile(r"[\u3400-\u9fff]"),
}
UNEXPECTED_SCRIPT = {
    "ru": re.compile(r"[가-힣ぁ-んァ-ン\u3400-\u9fff]"),
    "ko": re.compile(r"[А-Яа-яЁёぁ-んァ-ン\u3400-\u9fff]"),
    "ja": re.compile(r"[А-Яа-яЁё가-힣]"),
    "zh-CN": re.compile(r"[А-Яа-яЁё가-힣ぁ-んァ-ン]"),
}
UNTRANSLATED_MARKETING = re.compile(
    r"\b(?:state[- ]of[- ]the[- ]art|open[- ]source|large language model)\b",
    re.IGNORECASE,
)
PERCENTAGE = re.compile(r"\d+(?:\.\d+)?\s*%")
NUMBER_QUANTITY = re.compile(r"(?<![A-Za-z0-9.])(\d+(?:\.\d+)?)([KkMmBbTt]?)")
UNTRANSLATED_PROSE = re.compile(r"\b(?:Coverage|fact-checking|instruct)\b")
BROKEN_MIXED_CAPS = {
    "ru": re.compile(r"[А-Яа-яЁё][A-Z]{4,}"),
    "ko": re.compile(r"[가-힣][A-Z]{4,}"),
}


def collapse(value: str) -> str:
    return " ".join(value.split())


def source_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def decimal_text(value: Decimal) -> str:
    rendered = format(value, "f")
    return rendered.rstrip("0").rstrip(".") if "." in rendered else rendered


def number_variants(locale: str, source: str, match: re.Match[str]) -> set[str]:
    raw, suffix = match.groups()
    amount = Decimal(raw)
    unit = suffix.upper()
    if not unit:
        following = source[match.end() : match.end() + 18].lower()
        spelled_unit = re.match(r"[-\s]*(billion|million|trillion)\b", following)
        if spelled_unit:
            unit = {"billion": "B", "million": "M", "trillion": "T"}[spelled_unit.group(1)]

    variants = {raw, raw.replace(".", ",")}
    if locale in {"ko", "ja", "zh-CN"}:
        if unit == "B":
            variants.add(decimal_text(amount * 10))
        elif unit == "M":
            localized = amount / 100 if amount >= 100 else amount * 100
            variants.add(decimal_text(localized))
        elif unit == "K":
            variants.add(decimal_text(amount / 10))
    return variants


def preserves_number(locale: str, source: str, translated: str, match: re.Match[str]) -> bool:
    return any(
        re.search(rf"(?<![\d.]){re.escape(variant)}(?!\d)", translated)
        for variant in number_variants(locale, source, match)
    )


def chunks(values: list[dict[str, str]], size: int) -> Iterable[list[dict[str, str]]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def read_json(path: Path, fallback: object) -> object:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def normalized_entry(model: dict[str, str], entry: dict[str, str]) -> dict[str, str]:
    normalized = dict(entry)
    if normalized.get("sourceHash") == source_hash(model["description"]):
        normalized["source"] = model["description"]
    return normalized


def prompt_for(locale: str, batch: list[dict[str, str]]) -> str:
    language, guidance = LOCALES[locale]
    return f"""Translate every English description below into publication-quality {language}.

Rules:
- Preserve the exact meaning. Do not add, remove, advertise, or infer claims.
- Preserve every number, version, percentage, emoji, model or company name, benchmark, code token, and technical parameter.
- Translate normal explanatory prose completely; do not leave an English sentence behind.
- {guidance}
- Keep each result as one concise paragraph without Markdown.
- Return one valid JSON object only. Each input slug must be a key and its translated description the string value. Do not include other keys.

Input:
{json.dumps(batch, ensure_ascii=False, separators=(",", ":"))}
"""


def request_translations(
    endpoint: str,
    model: str,
    locale: str,
    batch: list[dict[str, str]],
    timeout: int,
    attempt: int,
    correction: str | None,
) -> dict[str, str]:
    correction_note = ""
    if correction:
        correction_note = (
            "\nCorrection required: the previous attempt failed validation: "
            f"{correction}. Re-check every value and fix that problem throughout the batch.\n"
        )
    payload = {
        "model": model,
        "stream": False,
        "think": False,
        "format": "json",
        "keep_alive": "30m",
        "options": {
            "temperature": 0 if attempt == 1 else 0.15,
            "num_ctx": 12288,
            "num_predict": max(1600, len(batch) * 180),
        },
        "messages": [
            {
                "role": "system",
                "content": "You are a meticulous native technical translator. Return valid JSON only.",
            },
            {"role": "user", "content": prompt_for(locale, batch) + correction_note},
        ],
    }
    request = Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        result = json.loads(response.read().decode("utf-8"))
    content = result.get("message", {}).get("content", "")
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise ValueError("Ollama returned a non-object translation payload")
    return {str(key): collapse(str(value)) for key, value in parsed.items()}


def validate_batch(
    locale: str,
    batch: list[dict[str, str]],
    translations: dict[str, str],
) -> dict[str, str]:
    expected = {item["slug"] for item in batch}
    if set(translations) != expected:
        missing = sorted(expected - set(translations))
        extra = sorted(set(translations) - expected)
        raise ValueError(f"translation keys differ; missing={missing}, extra={extra}")

    checked: dict[str, str] = {}
    for item in batch:
        slug = item["slug"]
        source = item["description"]
        translated = collapse(translations[slug])
        if not translated or len(translated) < max(12, len(source) // 5):
            raise ValueError(f"translation for {slug} is empty or implausibly short")
        if len(translated) > max(300, len(source) * 4):
            raise ValueError(f"translation for {slug} is implausibly long")
        if len(re.findall(r"[A-Za-z]", source)) >= 12 and not TARGET_SCRIPT[locale].search(translated):
            raise ValueError(f"translation for {slug} contains no {locale} script")
        unexpected = UNEXPECTED_SCRIPT[locale].search(translated)
        if unexpected:
            raise ValueError(f"translation for {slug} contains unexpected script {unexpected.group(0)!r}")
        mixed_phrase = UNTRANSLATED_MARKETING.search(translated)
        if mixed_phrase:
            raise ValueError(f"translation for {slug} left {mixed_phrase.group(0)!r} untranslated")
        untranslated_prose = UNTRANSLATED_PROSE.search(translated)
        if untranslated_prose:
            raise ValueError(f"translation for {slug} left {untranslated_prose.group(0)!r} untranslated")
        broken_caps = BROKEN_MIXED_CAPS.get(locale)
        if broken_caps and (mixed_caps := broken_caps.search(translated)):
            raise ValueError(f"translation for {slug} contains malformed mixed-script word {mixed_caps.group(0)!r}")
        missing_numbers = [
            match.group(0)
            for match in NUMBER_QUANTITY.finditer(source)
            if not preserves_number(locale, source, translated, match)
        ]
        if missing_numbers:
            raise ValueError(f"translation for {slug} lost numbers: {missing_numbers}")
        source_percentages = PERCENTAGE.findall(source)
        missing_percentages = [
            percentage for percentage in source_percentages
            if percentage not in translated
            and percentage.replace(".", ",") not in translated
            and percentage.replace(" ", "") not in translated
        ]
        if missing_percentages:
            raise ValueError(f"translation for {slug} lost percentages: {missing_percentages}")
        checked[slug] = translated
    return checked


def translate_batch(
    endpoint: str,
    model: str,
    locale: str,
    batch: list[dict[str, str]],
    timeout: int,
    attempts: int,
) -> dict[str, str]:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            translated = request_translations(
                endpoint,
                model,
                locale,
                batch,
                timeout,
                attempt,
                str(last_error) if last_error else None,
            )
            return validate_batch(locale, batch, translated)
        except (HTTPError, URLError, RemoteDisconnected, TimeoutError, json.JSONDecodeError, ValueError) as error:
            last_error = error
            if attempt < attempts:
                print(f"  retry {attempt}/{attempts - 1}: {error}")
                time.sleep(attempt * 2)
    if len(batch) > 1:
        midpoint = len(batch) // 2
        print(f"  splitting failed batch after {attempts} attempts: {last_error}")
        left = translate_batch(endpoint, model, locale, batch[:midpoint], timeout, attempts)
        right = translate_batch(endpoint, model, locale, batch[midpoint:], timeout, attempts)
        return {**left, **right}
    raise RuntimeError(f"translation for {batch[0]['slug']} failed after {attempts} attempts: {last_error}")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--locales", nargs="+", choices=tuple(LOCALES), default=list(LOCALES))
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--refresh", action="store_true", help="Regenerate existing current translations")
    parser.add_argument("--limit", type=int, help="Translate only the first N pending models")
    parser.add_argument("--slugs", nargs="+", help="Translate only these model slugs")
    return parser.parse_args()


def main() -> int:
    args = arguments()
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be positive")
    catalog = read_json(CATALOG_PATH, {})
    if not isinstance(catalog, dict) or not isinstance(catalog.get("models"), list):
        raise SystemExit(f"Invalid catalog: {CATALOG_PATH}")
    models = [
        {"slug": str(model["slug"]), "description": collapse(str(model["description"]))}
        for model in catalog["models"]
    ]
    selected_models = models
    if args.slugs:
        requested = set(args.slugs)
        available = {model["slug"] for model in models}
        unknown = sorted(requested - available)
        if unknown:
            raise SystemExit(f"Unknown model slugs: {', '.join(unknown)}")
        selected_models = [model for model in models if model["slug"] in requested]

    for locale in args.locales:
        output = OUTPUT_DIRECTORY / f"{locale}.json"
        loaded = read_json(output, {})
        existing = loaded if isinstance(loaded, dict) else {}
        pending = [
            model for model in selected_models
            if args.refresh
            or not isinstance(existing.get(model["slug"]), dict)
            or existing[model["slug"]].get("sourceHash") != source_hash(model["description"])
        ]
        if args.limit is not None:
            pending = pending[: args.limit]
        print(f"{locale}: {len(pending)} descriptions pending")
        for index, batch in enumerate(chunks(pending, args.batch_size), start=1):
            print(f"  batch {index}: {batch[0]['slug']} … {batch[-1]['slug']} ({len(batch)})")
            translated = translate_batch(
                args.endpoint,
                args.model,
                locale,
                batch,
                args.timeout,
                args.attempts,
            )
            for model in batch:
                existing[model["slug"]] = {
                    "source": model["description"],
                    "sourceHash": source_hash(model["description"]),
                    "text": translated[model["slug"]],
                }
            ordered = {
                model["slug"]: normalized_entry(model, existing[model["slug"]])
                for model in models
                if model["slug"] in existing
            }
            write_json(output, ordered)
        ordered = {
            model["slug"]: normalized_entry(model, existing[model["slug"]])
            for model in models
            if model["slug"] in existing
        }
        write_json(output, ordered)
        print(f"{locale}: {len(existing)} translations available")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
