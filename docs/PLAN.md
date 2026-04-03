# CEM Automation — Implementation Plan

> Updated: 2026-03-31 — Reflects real CSV structure, Slack delivery, Looker Studio dashboards, and multi-location readiness.

---

## Overview

Eleanor is a daily customer experience insights system that:
1. Ingests SMG CEM reports from Gmail
2. Parses cumulative CSVs and infers daily performance
3. Stores structured data in Google Sheets
4. Delivers daily Slack summaries to leadership
5. Powers Looker Studio dashboards for drill-down analysis

---

## Phase 0: Scaffolding & Documentation ✅

- [x] Create README, PROPOSAL, PLAN, STACK, DATA_STRUCTURE docs
- [x] Obtain real sample CSVs from SMG reports
- [x] Document actual CSV layout (header metadata, two metric blocks, per-metric n)
- [x] Identify all 7 metrics and their canonical names
- [x] Map email subject suffixes to time buckets
- [x] Complete gap analysis (GAP_ANALYSIS.md)

---

## Phase 1: Core Data Pipeline

**Goal**: Ingest CSVs from Gmail, parse both metric blocks, store raw cumulative data.

### 1.1 Google Sheets Structure

| Sheet | Purpose |
|-------|---------|
| `raw_cumulative` | Append-only: one row per (date, bucket, channel, metric) as received |
| `fact_daily_metric` | Inferred daily values — the primary analysis table |
| `config_targets` | Thresholds by metric/store/bucket/channel with effective dates |
| `config_locations` | Store registry (id, name, region, active, Slack channel) |
| `config_runtime` | Slack tokens, trigger window, lookback days, feature flags |
| `processed_messages` | Gmail message IDs already processed (dedup) |
| `run_log` | Run status, files processed, errors, data quality flags |

### 1.2 Apps Script Modules

```
src/
├── main.gs          # Entry points, triggers, menu items
├── gmail.gs         # Gmail search, attachment extraction, dedup
├── parser.gs        # CSV header parsing, block 1 + block 2 extraction
├── normalize.gs     # Store ID split, sentinel handling, canonical metric names
├── infer.gs         # Cumulative delta math, daily score computation
├── sheets.gs        # Read/write helpers for all sheets
├── config.gs        # Sheet names, column mappings, constants
├── slack.gs         # Slack Block Kit message builder + poster
└── quality.gs       # Data quality checks, missing bucket detection
```

### 1.3 Gmail Query

```
from:SMGMailMgr@whysmg.com subject:"SMG Reporting: Daily Sales Channel Breakout by Time" has:attachment filename:csv newer_than:5d
```

Explicitly exclude: `subject:"Daily Comparison"`

### 1.4 Parser Logic

1. Read lines 1–8 for header metadata (date range, time bucket)
2. Detect Block 1 start (line with "Overall Satisfaction" header)
3. Read Block 1 data rows until next header row
4. Detect Block 2 start (line with "Cleanliness" header)
5. Read Block 2 data rows until EOF
6. For each data row: extract store, channel, count, and all (score, n) pairs
7. Handle `**` → null, `%` stripping, blank channel → `_TOTAL`

### 1.5 Triggers

| Trigger | Time | Purpose |
|---------|------|---------|
| Primary | 2:30 AM | Main daily run |
| Retry 1 | 3:15 AM | If <5 time buckets received |
| Retry 2 | 3:50 AM | Final attempt |
| Failure alert | 4:00 AM | Slack alert if still incomplete |

### 1.6 Deduplication

- Track processed Gmail message IDs in `processed_messages` sheet
- On each run: skip messages already in the log
- Exception: reprocessing window (trailing 3 days) re-reads messages but upserts rows

---

## Phase 2: Daily Inference Engine

**Goal**: Compute daily deltas from cumulative data.

### 2.1 Delta Computation

For each unique key (business_date, store_id, time_bucket, sales_channel, metric_name):

```
cum_numerator = round(cum_pct × cum_n)
daily_n = cum_n(today) − cum_n(yesterday)
daily_numerator = cum_numerator(today) − cum_numerator(yesterday)
daily_pct = daily_numerator / daily_n  (if daily_n > 0, else null)
```

### 2.2 Edge Cases

| Case | Handling |
|------|----------|
| Month day 1 | Yesterday values = 0 |
| Missing day | Flag gap; do not interpolate |
| Negative daily_n | Data quality error; flag in run_log |
| `**` sentinel | null; skip from aggregation |
| Channel appears/disappears | Only compute delta when both days present |

### 2.3 Trailing-Day Reprocessing

On every run, recompute deltas for the last 3 business days to account for SMG's 2-day late-response window. Upsert (replace) existing fact_daily_metric rows.

---

## Phase 3: Slack Delivery

**Goal**: Post daily leadership summary via Slack bot.

### 3.1 Message Structure (Block Kit)

**Header**: `Customer Experience Daily | Mon Mar 31, 2026`

**Primary Block** (large, scannable):
```
🟢 Overall Satisfaction: 78% yesterday (↑3 vs prior day)
   MTD: 72% | Target: 75% | 🟢 On Track
```

**Secondary Metrics** (compact table):
```
Metric            Yesterday  MTD    Target  Status
Taste of Food     75%        71%    70%     🟢
Fast Service      61%        63%    65%     🟡
Attentive         72%        74%    70%     🟢
Cleanliness       69%        70%    70%     🟡
Portion Size      70%        68%    65%     🟢
Order Accuracy    91%        90%    85%     🟢
```

**Insights Block** (plain English):
```
📈 Where we're winning:
  • Mobile Drive Thru: 89% overall satisfaction (best channel)
  • Breakfast: strongest time bucket at 83%

📉 Where to focus:
  • Drive Thru at Lunch: 58% overall satisfaction, 4th day below target
  • Fast Service during Dinner Rush: 54%, lowest cross-section

⚠️ Low sample warnings:
  • Curbside: only 3 responses MTD — scores unreliable
```

**Quiet Mode**: If all metrics green and stable (< 3pt movement), condense to 2-line summary.

**Footer**: Link to Looker Studio dashboard

### 3.2 Audience-Aware Design

For moderate-tech, low-executive-function leaders:
- Emoji status indicators (🟢🟡🔴) — instant visual parsing
- Bold the one thing that matters most
- "Where to focus" = specific, actionable, not abstract
- No jargon (no "n", no "delta", no "MTD" without first defining it)
- Consistent format every day — builds habit and reduces cognitive load

### 3.3 Implementation

- `UrlFetchApp.fetch()` to Slack `chat.postMessage` API
- Bot token stored in `config_runtime` sheet (or Script Properties for security)
- Channel IDs configurable per location in `config_locations`

---

## Phase 4: Config & Thresholds

**Goal**: Editable, retroactive threshold system.

### 4.1 `config_targets` Schema

| Column | Type | Description |
|--------|------|-------------|
| effective_start_date | DATE | When this threshold takes effect |
| effective_end_date | DATE | Nullable = currently active |
| metric_name | STRING | Canonical metric name |
| store_id | STRING | `*` = all stores |
| time_bucket | STRING | `*` = all buckets |
| sales_channel | STRING | `*` = all channels |
| target_green_min | NUMBER | Score ≥ this = green |
| target_yellow_min | NUMBER | Score ≥ this (but < green) = yellow; below = red |
| notes | STRING | Owner comments |

**Resolution order**: Most specific match wins (exact store > wildcard, exact bucket > wildcard, etc.)

### 4.2 `config_locations` Schema

| Column | Type | Description |
|--------|------|-------------|
| store_id | STRING | e.g., `04465` |
| store_name | STRING | e.g., `West Lufkin FSU` |
| region | STRING | For future multi-location grouping |
| district | STRING | For future multi-location grouping |
| active | BOOLEAN | Include in processing? |
| slack_channel_id | STRING | Where to post this store's report |
| timezone | STRING | e.g., `America/Chicago` |

---

## Phase 5: Looker Studio Dashboard

**Goal**: Interactive drill-down dashboard for leadership.

### 5.1 Data Source

Connect Looker Studio directly to `fact_daily_metric` sheet (or BigQuery when migrated).

### 5.2 Pages

| Page | Content |
|------|---------|
| **Executive Overview** | Yesterday KPI cards, MTD KPI cards, 30-day sparklines |
| **Wins & Risks** | Heatmap (metric × time bucket), channel leaderboard |
| **Deep Dive** | Filterable by date range, store, bucket, channel; trend lines per metric |
| **Data Quality** | Missing days, low-n warnings, late-arrival adjustment counts |

### 5.3 Filters (all pages)

- Date range picker
- Store selector (multi-location ready)
- Time bucket selector
- Sales channel selector

---

## Phase 6: Aggregation Views

**Goal**: Precomputed rollups for fast dashboarding.

### 6.1 Views to Build

| View | Grain | Purpose |
|------|-------|---------|
| By Day of Week | weekday (Mon–Sat) × metric | "Which days are strongest?" |
| By Week of Month | week 1–5 × metric | "Do we fade at month end?" |
| By Time Bucket | bucket × metric | "When are we weakest?" |
| By Sales Channel | channel × metric | "Which channels need work?" |
| MTD Summary | store × metric | Quick MTD reference |

All views are weighted averages using daily_numerator / daily_n sums.

Sunday exclusion is configurable in `config_runtime`.

---

## Phase 7: Resilience & Observability

**Goal**: The pipeline should self-diagnose and never silently fail.

### 7.1 Run Log

Each run writes to `run_log`:
- run_id, run_start, run_end, status (success/partial/failure)
- emails_found, files_parsed, rows_written
- missing_buckets (list)
- quality_flags (list)
- error_message (if any)

### 7.2 Data Quality Checks

| Check | Severity | Action |
|-------|----------|--------|
| < 5 time buckets received | Warning | Slack alert, retry |
| Cumulative count decreased | Error | Flag row, Slack alert |
| Negative daily_n | Error | Flag row, skip from aggregation |
| Score outside 0–100% | Error | Flag row |
| Same message_id processed twice | Info | Skip (dedup working) |

### 7.3 Failure Alerting

On any run failure or critical quality issue:
- Post to admin Slack channel (separate from leadership channel)
- Include: error details, which buckets are affected, manual remediation steps

---

## Phase 8: Future Expansion (Design Only)

### 8.1 Multi-Location

- `config_locations` table already supports it
- Regional rollups via GROUP BY region
- Store comparison leaderboards
- Per-store Slack channels

### 8.2 Period-over-Period

- Same day last week comparison
- Same week last month comparison
- Month-over-month trends

### 8.3 BigQuery Migration

- Same schema lifts directly
- Swap Looker Studio data source
- Apps Script writes via BigQuery API
- Enables SQL-powered advanced analytics

### 8.4 AI Narrative Generation

- Feed daily/weekly data to LLM API
- Generate plain-English summaries and action recommendations
- Post as part of Slack daily message

---

## File Structure (Apps Script)

```
src/
├── main.gs          # Entry points: runDailyPipeline(), onOpen(), manual triggers
├── gmail.gs         # fetchCemEmails(), extractCsvAttachment(), markProcessed()
├── parser.gs        # parseHeaderMetadata(), parseBlock1(), parseBlock2()
├── normalize.gs     # parseStoreId(), handleSentinels(), canonicalMetricName()
├── infer.gs         # computeDailyDeltas(), reprocessTrailingDays()
├── sheets.gs        # getSheet(), readRange(), upsertRows(), appendRows()
├── config.gs        # SHEET_NAMES, METRIC_NAMES, TIME_BUCKETS, getConfig()
├── slack.gs         # buildDailySummary(), postToSlack(), buildQuietMessage()
├── quality.gs       # checkBucketCompleteness(), validateDeltas(), logQuality()
└── triggers.gs      # setupTriggers(), retryIfIncomplete(), alertOnFailure()
```

---

## Timeline (Estimated)

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| 0 — Scaffolding | Done | — |
| 1 — Core Pipeline | 6–8 hrs | Gmail access, Sheets created |
| 2 — Inference Engine | 3–4 hrs | Phase 1 |
| 3 — Slack Delivery | 3–4 hrs | Slack bot token, Phase 2 |
| 4 — Config & Thresholds | 2–3 hrs | Phase 1 |
| 5 — Looker Studio | 3–4 hrs | Phase 2 |
| 6 — Aggregation Views | 2–3 hrs | Phase 2 |
| 7 — Resilience | 2–3 hrs | Phase 1 |
| 8 — Future (design only) | 0 hrs | — |

**Total v1**: ~22–29 hours

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| CSV format changes from SMG | Config-driven metric names; parser detects block headers dynamically |
| Missing emails / late delivery | Retry triggers at 3:15 + 3:50; 3-day reprocessing window |
| Google Sheets cell limits | Archive old months; BigQuery migration path ready |
| Slack token exposure | Store in Script Properties, not sheet cells |
| Leaders don't read Slack messages | Quiet-mode for good days; bold actionable items; consistent schedule builds habit |
| New locations added | config_locations table; parser handles any store ID format |
| Apps Script 6-min execution limit | Process only new/changed messages; batch writes |
