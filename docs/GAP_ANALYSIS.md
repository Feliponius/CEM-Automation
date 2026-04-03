# CEM Automation — Gap Analysis & Orchestration Review

> Generated: 2026-03-31
> Context: Full review after obtaining real CSV samples and defining the "Eleanor" daily insights system.

---

## 1. Data Model Gaps (Critical)

### GAP-D1: Existing docs describe a hypothetical CSV — actual format is completely different

**Old assumption** (DATA_STRUCTURE.md):
```
Report_Date,Cumulative_Count,Cumulative_Score
2026-03-06,52,62
```

**Reality**: Multi-block CSV with:
- Header metadata (date range, visit-date timestamp, filters, time-of-day bucket)
- Block 1: Store, Sales Channel Breakout, Count, Overall Satisfaction (Score/n), Taste of Food (Score/n), Fast Service (Score/n), Attentive/Friendly (Score/n)
- Block 2: Store, Sales Channel Breakout, Count, Cleanliness (Score/n), Portion Size of Food (Score/n), Order Accuracy Y/N (Score/n)
- Each metric has its own `n` (denominator) — they differ (e.g., Portion Size n ≠ Count)

**Impact**: Parser, schema, and delta math all need redesign.

### GAP-D2: Per-metric `n` varies — cannot use a single Count field

The `Count` column is the total survey count for that row, but individual metrics like "Portion Size of Food" have a different `n` because not every respondent answers every question.

Example from real data:
- Count: 81, Overall Satisfaction n: 81, Portion Size n: 42

**Implication**: Must store and delta each metric's `n` independently. The daily inference formula must use per-metric numerators:
```
cum_numerator = round(cum_pct × cum_n)
daily_numerator = cum_numerator(today) − cum_numerator(yesterday)
daily_n = cum_n(today) − cum_n(yesterday)
daily_pct = daily_numerator / daily_n  (when daily_n > 0)
```

### GAP-D3: Sentinel values not handled

Real data contains `**` for suppressed metrics (low sample size). Must map to `null`, not error.

### GAP-D4: Aggregate row vs channel rows

Each block has a summary row (blank Sales Channel Breakout = store total) plus per-channel rows. Parser must distinguish these and tag accordingly.

### GAP-D5: Store ID parsing

Values like `04465 - West Lufkin FSU` need to be split into `store_id` (04465) and `store_name` (West Lufkin FSU) for multi-location support.

### GAP-D6: Time bucket lives in header metadata, not in row data

The time-of-day bucket (e.g., "Before 10:30 AM") is in the CSV header (line 6), not in a column. Parser must extract it from the `Filters Applied: Time of Day:` header line.

### GAP-D7: Date range lives in header metadata

`Comparison: 3/1/2026 - 3/31/2026` is in line 1. The end date is the business date for that cumulative snapshot. Parser must extract both start and end dates.

### GAP-D8: No concept of multi-file-per-email

Each email has ONE CSV attachment, but there are 5 emails per day (one per time bucket). The system receives 5 separate emails daily, each with one attachment.

---

## 2. Architecture Gaps

### GAP-A1: No Slack integration in any existing doc

All docs reference Charts-in-Sheets as the output. The actual requirement is:
- Daily Slack message to leadership channels
- Slack Block Kit formatted summaries
- Slack bot token integration in Apps Script via `UrlFetchApp`

### GAP-A2: No Looker Studio in the plan

The visualization layer should be Looker Studio connected to the Sheets data model, not embedded Sheets charts. This gives:
- Drill-down filters (date, location, time bucket, channel)
- Scheduled email delivery of PDF snapshots
- Mobile-friendly dashboards
- Shared links for leadership

### GAP-A3: No config_targets sheet for thresholds

Need a threshold configuration sheet with:
- effective_start_date, effective_end_date
- metric_name, store_id, time_bucket, sales_channel (with wildcard support)
- target_green_min, target_yellow_min
- owner_notes

Must support retroactive changes (backfill threshold application).

### GAP-A4: No config_locations sheet

For multi-location readiness:
- store_id, store_name, region, district, active flag
- leadership_slack_channel, leadership_members
- timezone

### GAP-A5: No retry/resilience logic

Current plan: single daily trigger. Required:
- Primary run at ~2:30 AM
- Retry at ~3:15 AM if not all 5 time buckets received
- Final attempt at ~3:50 AM
- Slack alert if still incomplete after final attempt

### GAP-A6: No trailing-day reprocessing

SMG disclaimer: "responses can be received within the 2 day response window."
Must reprocess the trailing 2–3 days on every run to capture late-arriving responses and update daily inferred values.

### GAP-A7: No message deduplication

Need a `processed_messages` log keyed by Gmail message ID to prevent double-processing. Must also handle reprocessing (same message, updated delta window) without creating duplicate raw rows.

### GAP-A8: Month boundary handling

First day of month: no previous-day cumulative exists. Must initialize with zeros. End of month: next month's first report resets cumulative. Must detect month transitions and handle cleanly.

---

## 3. Usability Gaps (Critical — Leadership Audience)

### GAP-U1: No "digest mode" — system dumps data, doesn't tell leaders what matters

Moderate-tech, low-executive-function users need:
- **Top-line summary in plain English** ("Yesterday we scored 72% overall, up 3 points from the day before")
- **Where to act** ("Drive Thru during Lunch dropped to 58% — 4th day in a row below target")
- **What's working** ("Mobile Drive Thru is at 89% this month, best channel")

The Slack message must be scannable in under 10 seconds.

### GAP-U2: No traffic-light color system

Every score should be accompanied by a status indicator:
- Green: at or above target
- Yellow: within warning zone
- Red: below minimum threshold

In Slack: use emoji (🟢 🟡 🔴). In Looker Studio: conditional formatting.

### GAP-U3: No "compared to what" context

Raw numbers are meaningless without comparison:
- vs yesterday (day-over-day delta)
- vs same day last week
- vs MTD target
- vs prior month same period

Every displayed metric needs at least one comparison.

### GAP-U4: No glossary or metric definitions

Leaders may not know what "n" means or why Portion Size has a different sample size than Overall Satisfaction. Need:
- A `Reference` tab or doc with plain-English metric definitions
- Tooltips in Looker Studio
- A `/cem-help` Slack command (future)

### GAP-U5: No onboarding path for new leaders

When a new location or new leader is added:
- How do they get access?
- How do they get added to the Slack channel?
- Is there a welcome message explaining what reports they'll receive and when?

### GAP-U6: Slack messages must have visual hierarchy

Primary metric (Overall Satisfaction) should be large/bold.
Secondary metrics should be in a compact table below.
Action items should be at the bottom with direct links.

### GAP-U7: No "quiet mode" for good days

If all metrics are green and stable, the daily message should be short:
"All green yesterday. Overall Satisfaction 78% (target: 75%). MTD: 76%. No action needed."

Reserve the detailed breakdown for days with movement or risk.

---

## 4. Operational Gaps

### GAP-O1: No pipeline failure alerting

If the daily run fails (Gmail API error, CSV format change, Sheets quota), nobody knows. Need:
- Slack alert to admin channel on failure
- Run log with status, error messages, stack traces

### GAP-O2: No data quality checks

Need automated checks:
- Expected 5 time buckets per day — alert if fewer
- Cumulative count should never decrease (flag if it does)
- Score percentages should be 0–100% (flag outliers)
- Daily inferred `n` should be ≥ 0 (negative = data error)

### GAP-O3: No archival strategy

Google Sheets has a 10M cell limit. At ~7 metrics × ~7 channels × 5 time buckets × 30 days × 12 columns ≈ 88,200 cells/month. Comfortable for years with one location, but multi-location will grow fast.

Plan:
- Archive completed months to a separate "archive" sheet or BigQuery
- Keep only current + prior month in active sheets
- Looker Studio can query both

### GAP-O4: No backup/recovery plan

If the Sheet is accidentally deleted or corrupted:
- Need periodic export to Drive folder (JSON or CSV backup)
- Or BigQuery as durable store with Sheets as a view layer

### GAP-O5: No audit trail for config changes

When someone changes a target threshold, there's no record of what it was before. Need:
- Change log tab, or
- Config sheet with effective_start/end dates (already proposed)

---

## 5. Future Expandability Gaps

### GAP-F1: No multi-location comparison framework

When locations are added, need:
- Store-vs-store leaderboard
- Regional rollups
- "Best practices" identification (which store/channel/bucket combos outperform)

### GAP-F2: No period-over-period comparison

Need infrastructure for:
- This month vs last month
- This week vs same week last month
- This quarter vs last quarter
- Year-over-year (long term)

### GAP-F3: No BigQuery migration path documented

When Sheets limits are reached or more complex analytics are needed:
- Same schema should lift directly to BigQuery
- Looker Studio data source swap (Sheets → BigQuery) should be seamless
- Apps Script can write to BigQuery via `BigQuery.Jobs.insert`

### GAP-F4: No provision for additional SMG report types

If SMG adds new report types or metrics:
- Parser should be config-driven (metric names from a config list, not hardcoded)
- New metrics should auto-create columns in the fact table

### GAP-F5: No API layer for custom web dashboard

If Looker Studio isn't enough long-term:
- Consider Apps Script web app endpoint (`doGet`/`doPost`) for JSON API
- Or migrate to a lightweight web app (Next.js + BigQuery)

### GAP-F6: No goal-setting or action-tracking integration

Beyond thresholds, future state might include:
- Action items assigned to leaders when metrics are red
- Follow-up tracking ("What did you do about Tuesday's Drive Thru score?")
- Integration with task management (Slack workflows, Asana, etc.)

### GAP-F7: No narrative generation infrastructure

User wants to "parse through information to create narratives." Future state:
- LLM-generated daily narrative summaries (GPT via API)
- Weekly/monthly trend narratives
- Anomaly detection and explanation

---

## 6. Gap Priority Matrix

| ID | Category | Severity | Must Fix for v1? | Effort |
|----|----------|----------|-------------------|--------|
| D1 | Data | Critical | Yes | High |
| D2 | Data | Critical | Yes | Medium |
| D3 | Data | Critical | Yes | Low |
| D4 | Data | Critical | Yes | Low |
| D5 | Data | Critical | Yes | Low |
| D6 | Data | Critical | Yes | Low |
| D7 | Data | Critical | Yes | Low |
| D8 | Data | Critical | Yes | Medium |
| A1 | Arch | Critical | Yes | Medium |
| A2 | Arch | High | Yes | Medium |
| A3 | Arch | High | Yes | Low |
| A4 | Arch | Medium | Yes (skeleton) | Low |
| A5 | Arch | High | Yes | Medium |
| A6 | Arch | Critical | Yes | Medium |
| A7 | Arch | Critical | Yes | Low |
| A8 | Arch | High | Yes | Low |
| U1 | Usability | Critical | Yes | Medium |
| U2 | Usability | High | Yes | Low |
| U3 | Usability | High | Yes | Medium |
| U4 | Usability | Medium | v1.1 | Low |
| U5 | Usability | Low | v2 | Low |
| U6 | Usability | High | Yes | Low |
| U7 | Usability | Medium | v1.1 | Low |
| O1 | Ops | Critical | Yes | Low |
| O2 | Ops | High | Yes | Medium |
| O3 | Ops | Low | v2 | Medium |
| O4 | Ops | Medium | v1.1 | Low |
| O5 | Ops | Low | v2 | Low |
| F1 | Future | Medium | Skeleton only | Low |
| F2 | Future | Medium | v1.1 | Medium |
| F3 | Future | Low | v2 | Low |
| F4 | Future | Medium | Design only | Low |
| F5 | Future | Low | v3+ | High |
| F6 | Future | Low | v3+ | High |
| F7 | Future | Medium | v2 | High |

---

## 7. Recommended Action

1. Rewrite DATA_STRUCTURE.md to match actual CSV format
2. Rewrite PLAN.md with updated phases (including Slack, Looker, multi-location skeleton)
3. Update STACK.md to include Slack Bot + Looker Studio
4. Update PROPOSAL.md with full "Eleanor" system vision
5. Update README.md as project entry point
6. Archive sample CSVs in samples/ directory for reference
7. Proceed to implementation with all v1 gaps addressed
