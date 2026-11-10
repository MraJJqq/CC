from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from .trading_calendar import is_a_share_trading_day
except ImportError:
    from trading_calendar import is_a_share_trading_day


BARK_LINE_WIDTH = 32


def format_bark_body(names: list[str], line_width: int = BARK_LINE_WIDTH) -> str:
    """Pack complete ▰ name ▰ units left-to-right and wrap at the fixed width."""
    lines: list[str] = []
    current = ""
    for name in names:
        unit = f"▰ {name} ▰"
        candidate = f"{current} {unit}" if current else unit
        if current and len(candidate) > line_width:
            lines.append(current)
            current = unit
        else:
            current = candidate
    if current:
        lines.append(current)
    return "\n".join(lines) if lines else "▰ No change ▰"


def main() -> int:
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    if not is_a_share_trading_day(today):
        print(f"{today.isoformat()} is not an A-share trading day; Bark push skipped.")
        return 0

    key = os.environ.get("BARK_KEY", "").strip()
    if not key:
        print("BARK_KEY is not configured; Bark push skipped.")
        return 0

    rows = json.loads(Path("site/data/signals.json").read_text(encoding="utf-8"))
    names = []
    seen = set()
    for row in rows:
        name = str(row.get("name") or "").strip()
        if name and name not in seen:
            names.append(name)
            seen.add(name)

    body = format_bark_body(names)
    server = os.environ.get("BARK_SERVER", "").strip().rstrip("/") or "https://api.day.app"
    payload = json.dumps(
        {"device_key": key, "body": body, "level": "active"},
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{server}/push",
        data=payload,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "CC-CN500/1.0",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=20) as response:
        response_body = response.read().decode("utf-8", "replace")
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"Bark push failed: HTTP {response.status}")
    result = json.loads(response_body)
    if result.get("code") != 200:
        raise RuntimeError(f"Bark rejected notification: {response_body[:300]}")
    print(f"Bark push sent: {len(names)} stock names; response={response_body[:300]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
