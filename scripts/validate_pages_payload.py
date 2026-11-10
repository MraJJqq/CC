#!/usr/bin/env python3
"""Validate the complete static payload before Bark notifications or Pages deployment."""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path


REQUIRED_FILES = (
    "cards.json",
    "summary.json",
    "universe.json",
    "signals.json",
    "signals.previous.json",
    "trading-calendar.json",
)


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Missing or invalid JSON payload: {path.name}") from error


def validate_payload(data: Path) -> dict:
    missing = [name for name in REQUIRED_FILES if not (data / name).is_file()]
    if missing:
        raise ValueError(f"Missing Pages data files: {missing}")

    cards = _load(data / "cards.json")
    summary = _load(data / "summary.json")
    universe = _load(data / "universe.json")
    signals = _load(data / "signals.json")

    if not isinstance(cards, list) or len(cards) != 500:
        raise ValueError("CN500 cards payload must contain exactly 500 rows")
    card_symbols = [row.get("symbol") for row in cards if isinstance(row, dict)]
    if len(card_symbols) != 500 or len(set(card_symbols)) != 500 or any(not symbol for symbol in card_symbols):
        raise ValueError("CN500 cards payload must contain exactly 500 unique symbols")
    if not isinstance(universe, list) or not isinstance(signals, list):
        raise ValueError("Universe and signals payloads must be arrays")
    if summary.get("universe_size") != 500 or summary.get("eligible_count") != len(universe):
        raise ValueError("CN500 summary and eligible universe counts disagree")
    if summary.get("fetch_error_count") != 0:
        raise ValueError("Refusing to publish a snapshot with Tencent fetch errors")

    # The market date is the newest session present in the eligible universe.
    # Individual eligible stocks may legitimately have an older last_date
    # (e.g. suspension); their own chart must still match that stock's date.
    market_date = summary.get("market_date")
    newest_date = max((str(row.get("last_date") or "") for row in universe), default="")
    if not market_date or market_date != newest_date:
        raise ValueError("Summary market date must equal the newest eligible-stock date")

    symbols = [row.get("symbol") for row in universe if isinstance(row, dict)]
    if len(symbols) != len(universe) or len(set(symbols)) != len(symbols) or any(not symbol for symbol in symbols):
        raise ValueError("Eligible universe contains missing or duplicate symbols")
    symbol_set = set(symbols)
    if any(row.get("symbol") not in symbol_set or row.get("confirmation_date") != market_date for row in signals):
        raise ValueError("Signal payload contains an unknown symbol or non-current session")

    charts = data / "charts"
    chart_files = list(charts.glob("*.json.gz")) if charts.is_dir() else []
    if len(chart_files) != len(universe):
        raise ValueError(f"Expected {len(universe)} compressed charts, found {len(chart_files)}")

    for stock in universe:
        path = charts / f'{stock["symbol"]}.json.gz'
        if not path.is_file():
            raise ValueError(f"Missing compressed chart: {path.name}")
        try:
            with gzip.open(path, "rt", encoding="utf-8") as handle:
                chart = json.load(handle)
        except (OSError, EOFError, json.JSONDecodeError) as error:
            raise ValueError(f"Invalid compressed chart: {path.name}") from error
        if chart.get("symbol") != stock["symbol"] or chart.get("last_date") != stock.get("last_date") or not chart.get("bars"):
            raise ValueError(f"Invalid or date-mismatched compressed chart payload: {path.name}")

    return {
        "cards": len(cards),
        "eligible": len(universe),
        "signals": len(signals),
        "market_date": market_date,
    }


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    result = validate_payload(root / "site" / "data")
    print(
        "Pages payload verified: "
        f'{result["cards"]} CN500 cards, {result["eligible"]} eligible charts, '
        f'{result["signals"]} current-session signals ({result["market_date"]}).'
    )


if __name__ == "__main__":
    main()
