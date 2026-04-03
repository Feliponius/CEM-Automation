# Eleanor — CEM Automation

Daily customer experience insights, automatically.

## What It Does

Ingests daily SMG CEM reports from Gmail, infers per-day performance from cumulative data, posts leadership Slack summaries, and powers Looker Studio dashboards.

Every morning by 7 AM, leadership knows: how yesterday went, how the month is trending, and where to focus today.

## Stack

| Layer | Technology |
|-------|-----------|
| Ingestion | Apps Script + Gmail |
| Storage | Google Sheets |
| Compute | Apps Script (daily delta inference) |
| Delivery | Slack Bot API |
| Visualization | Looker Studio |
| Scheduling | Apps Script Time-driven Triggers |

## Data Source

Daily emails from `SMGMailMgr@whysmg.com` with subject:
```
SMG Reporting: Daily Sales Channel Breakout by Time - {TimeBucket}
```

5 emails/day (Breakfast, Lunch, Afternoon, Dinner Rush, Closing), each with one CSV attachment containing cumulative month-to-date CEM scores across 7 metrics and multiple sales channels.

## Metrics

| Metric | Priority |
|--------|----------|
| Overall Satisfaction | **Primary** |
| Taste of Food | Secondary |
| Fast Service | Secondary |
| Attentive/Friendly | Secondary |
| Cleanliness | Secondary |
| Portion Size of Food | Secondary |
| Order Accuracy | Secondary |

## Documentation

| Document | Description |
|----------|-------------|
| [PROPOSAL.md](docs/PROPOSAL.md) | Full system vision, data flow, delivery design |
| [PLAN.md](docs/PLAN.md) | Implementation phases and technical architecture |
| [STACK.md](docs/STACK.md) | Technology stack details and migration path |
| [DATA_STRUCTURE.md](docs/DATA_STRUCTURE.md) | CSV format reference and target schema |
| [GAP_ANALYSIS.md](docs/GAP_ANALYSIS.md) | Comprehensive gap analysis and risk register |

## Samples

See `samples/` for real CSV examples from SMG reports.

## Monthly Reconciliation

A secondary report runs once a month (2nd day, 6 AM) to compare the final cumulative totals for the previous month against the sum of all inferred daily values. This serves two purposes:

1. **Integrity check** — catches any drift between cumulative-based inference and actual totals
2. **Last-day capture** — fills in the final day of the month that the `end_minus_1` business date mapping may miss

Run manually from the Eleanor CEM menu: **Run Monthly Reconciliation (Previous Month)** or **Run Monthly Reconciliation (Prompt Month)**.

## Web App API

The Apps Script can be deployed as a web app to enable external tools (Cursor, scripts, etc.) to query sheet data via HTTP.

### Setup

1. In the Apps Script editor, go to **Deploy > New deployment**
2. Select type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone** (protected by shared secret, not public data)
5. Click **Deploy** and copy the URL
6. In the Google Sheet's `config_runtime` sheet, add a row: `WEB_APP_SECRET` = a strong random value
7. Create a `.env` file locally (copy from `.env.example`) and fill in `WEB_APP_URL` and `WEB_APP_SECRET`

### Query from terminal

```bash
python query_sheet.py summary --month 2026-03
python query_sheet.py query_fact --date 2026-03-15 --metric overall_satisfaction
python query_sheet.py list_sheets
python query_sheet.py run_info
python query_sheet.py schema
```

### Available API actions

| Action | Method | Description |
|--------|--------|-------------|
| `summary` | GET | High-level stats: date range, metrics, latest day summary |
| `query_fact` | GET | Query `fact_daily_metric` with filters (month, date, metric, bucket, channel) |
| `query_raw` | GET | Query `raw_cumulative` with filters |
| `read_sheet` | GET | Read any sheet by name |
| `list_sheets` | GET | List all sheets with row/column counts |
| `run_info` | GET | Recent pipeline run log entries |
| `schema` | GET | Sheet headers and dimensions |
| `reconcile` | GET | Read monthly reconciliation results |
| `recompute_deltas` | POST | Trigger delta recomputation |
| `reconcile_month` | POST | Trigger reconciliation for a specific month |

## Quick Start

See [PLAN.md](docs/PLAN.md) for implementation phases. Phase 1 = core pipeline (Gmail → parse → store → infer daily).
