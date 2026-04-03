"""
query_sheet.py — CLI tool to query the Eleanor CEM Google Sheet via the Apps Script Web App API.

Usage:
    python query_sheet.py summary
    python query_sheet.py summary --month 2026-03
    python query_sheet.py query_fact --month 2026-03 --metric overall_satisfaction
    python query_sheet.py query_fact --date 2026-03-15 --bucket "10:30 AM to 2 PM"
    python query_sheet.py query_raw --month 2026-03
    python query_sheet.py list_sheets
    python query_sheet.py run_info
    python query_sheet.py schema
    python query_sheet.py schema --sheet fact_daily_metric
    python query_sheet.py read_sheet --sheet config_runtime
    python query_sheet.py reconcile --month 2026-03

POST actions (trigger server-side functions):
    python query_sheet.py post recompute_deltas
    python query_sheet.py post recompute_deltas --month 2026-03
    python query_sheet.py post reconcile_month --month 2026-03

Requires WEB_APP_URL and WEB_APP_SECRET in .env file.
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

from dotenv import load_dotenv

load_dotenv()

WEB_APP_URL = os.getenv("WEB_APP_URL", "")
WEB_APP_SECRET = os.getenv("WEB_APP_SECRET", "")


def get_request(action: str, params: dict | None = None) -> dict:
    if not WEB_APP_URL:
        print("ERROR: WEB_APP_URL not set in .env", file=sys.stderr)
        sys.exit(1)

    query = {"secret": WEB_APP_SECRET, "action": action}
    if params:
        query.update({k: v for k, v in params.items() if v is not None})

    url = WEB_APP_URL + "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, method="GET")
    req.add_header("Accept", "application/json")

    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def post_request(action: str, body: dict | None = None) -> dict:
    if not WEB_APP_URL:
        print("ERROR: WEB_APP_URL not set in .env", file=sys.stderr)
        sys.exit(1)

    payload = {"secret": WEB_APP_SECRET, "action": action}
    if body:
        payload.update(body)

    data = json.dumps(payload).encode()
    req = urllib.request.Request(WEB_APP_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")

    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def main():
    parser = argparse.ArgumentParser(description="Query Eleanor CEM Sheet via Web App API")
    parser.add_argument("action", help="API action (summary, query_fact, query_raw, list_sheets, run_info, schema, read_sheet, reconcile, post)")
    parser.add_argument("--month", help="YYYY-MM month filter")
    parser.add_argument("--date", help="YYYY-MM-DD date filter")
    parser.add_argument("--metric", help="metric_name filter")
    parser.add_argument("--bucket", help="time_bucket filter")
    parser.add_argument("--channel", help="sales_channel filter")
    parser.add_argument("--sheet", help="Sheet name (for read_sheet, schema)")
    parser.add_argument("--limit", type=int, help="Max rows to return")
    parser.add_argument("--compact", action="store_true", help="Compact JSON output")
    parser.add_argument("post_action", nargs="?", help="POST action name (when action=post)")

    args = parser.parse_args()

    params = {}
    if args.month:
        params["month"] = args.month
    if args.date:
        params["date"] = args.date
    if args.metric:
        params["metric"] = args.metric
    if args.bucket:
        params["bucket"] = args.bucket
    if args.channel:
        params["channel"] = args.channel
    if args.sheet:
        params["sheet"] = args.sheet
    if args.limit:
        params["limit"] = str(args.limit)

    if args.action == "post":
        if not args.post_action:
            print("ERROR: post requires a post_action argument (e.g., recompute_deltas)", file=sys.stderr)
            sys.exit(1)
        body = {}
        if args.month:
            body["month"] = args.month
        result = post_request(args.post_action, body)
    else:
        result = get_request(args.action, params)

    indent = None if args.compact else 2
    print(json.dumps(result, indent=indent, default=str))


if __name__ == "__main__":
    main()
