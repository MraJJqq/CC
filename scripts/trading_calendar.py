from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from chinese_calendar import is_workday

CHINA_TZ = ZoneInfo("Asia/Shanghai")


def china_today() -> date:
    return datetime.now(CHINA_TZ).date()


def is_a_share_trading_day(day: date) -> bool:
    # A-share exchanges never trade on weekends, including make-up work Saturdays.
    if day.weekday() >= 5:
        return False
    # chinese-calendar follows the published mainland public-holiday work/rest calendar.
    # Unsupported future dates raise; callers must fail closed rather than guess.
    return bool(is_workday(day))


def previous_a_share_trading_day(day: date) -> date:
    candidate = day - timedelta(days=1)
    while not is_a_share_trading_day(candidate):
        candidate -= timedelta(days=1)
    return candidate


def upcoming_trading_days(start: date, count: int = 40) -> list[str]:
    days = []
    candidate = start
    while len(days) < count:
        try:
            if is_a_share_trading_day(candidate):
                days.append(candidate.isoformat())
        except Exception:
            # Calendar package coverage may end in the future; never guess beyond it.
            break
        candidate += timedelta(days=1)
    return days


def build_status(day: date) -> dict:
    trading = is_a_share_trading_day(day)
    return {
        "date": day.isoformat(),
        "timezone": "Asia/Shanghai",
        "is_trading_day": trading,
        "trading_days": upcoming_trading_days(day),
        "calendar_source": "chinese-calendar statutory holiday calendar + A-share weekday rule",
        "checked_at": datetime.now(CHINA_TZ).isoformat(),
        "policy": "No scan or Bark push on weekends or mainland public holidays.",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=china_today().isoformat())
    parser.add_argument("--write", default="site/data/trading-calendar.json")
    parser.add_argument("--github-output", default="")
    args = parser.parse_args()

    day = date.fromisoformat(args.date)
    # Do not catch calendar coverage errors: failing the job is safer than scanning
    # on a date whose trading status cannot be established.
    status = build_status(day)

    output = Path(args.write)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.github_output:
        with Path(args.github_output).open("a", encoding="utf-8") as handle:
            handle.write(f"is-trading-day={'true' if status['is_trading_day'] else 'false'}\n")
            handle.write(f"trade-date={day.isoformat()}\n")

    print(json.dumps(status, ensure_ascii=False), flush=True)
    if not status["is_trading_day"]:
        print(f"{day.isoformat()} is not an A-share trading day; scan and notification will be skipped.", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Trading calendar unavailable or unsupported; fail-closed: {exc}", file=sys.stderr, flush=True)
        raise
