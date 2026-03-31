# CEM Report — Data Structure Reference

> Updated: 2026-03-31 — Based on actual SMG CSV samples

---

## Source: SMG Daily Sales Channel Breakout by Time

Each day, 5 emails arrive from `SMGMailMgr@whysmg.com` with subject pattern:
```
SMG Reporting: Daily Sales Channel Breakout by Time - {TimeBucket}
```

Time buckets: `Breakfast`, `Lunch`, `Afternoon`, `Dinner Rush`, `Closing`

Each email contains **one CSV attachment** with cumulative month-to-date data.

---

## CSV Layout (Actual)

The CSV is **not** a standard flat table. It has:

### Header Block (Lines 1–8)

```
Comparison: 3/1/2026 - 3/31/2026,,,,,,,,,,
,,,,,,,,,,
Visit Date as of: 03/31/2026 01:30:53 CDT/CST,,,,,,,,,,
Disclaimer: Scores with Visit Date applied during this date range may change...
Filters Applied:,,,,,,,,,,
Time of Day: 'Before 10:30 AM',,,,,,,,,,
(blank lines)
```

**Extractable metadata:**
| Field | Line | Parse Rule | Example |
|-------|------|-----------|---------|
| `date_range_start` | 1 | Before ` - ` | `3/1/2026` |
| `date_range_end` | 1 | After ` - ` | `3/31/2026` |
| `visit_date_as_of` | 3 | After `Visit Date as of: ` | `03/31/2026 01:30:53 CDT/CST` |
| `time_bucket` | 6 | Inside single quotes after `Time of Day:` | `Before 10:30 AM` |

The **business date** = `date_range_end` (the last day of the cumulative window).

### Metric Block 1 (Lines ~10–17)

```
Store,Sales Channel Breakout,Count,Overall Satisfaction,,Taste of Food,,Fast Service,,Attentive/Friendly,
,,,Score,n,Score,n,Score,n,Score,n
04465 - West Lufkin FSU,,85,69%,85,75%,85,61%,85,72%,85
04465 - West Lufkin FSU,Carry Out,6,83%,6,83%,6,83%,6,83%,6
...
```

**Columns (0-indexed):**
| Index | Field |
|-------|-------|
| 0 | Store (e.g., `04465 - West Lufkin FSU`) |
| 1 | Sales Channel Breakout (blank = store total) |
| 2 | Count (total survey responses for this row) |
| 3 | Overall Satisfaction Score (%) |
| 4 | Overall Satisfaction n |
| 5 | Taste of Food Score (%) |
| 6 | Taste of Food n |
| 7 | Fast Service Score (%) |
| 8 | Fast Service n |
| 9 | Attentive/Friendly Score (%) |
| 10 | Attentive/Friendly n |

### Metric Block 2 (Lines ~18–25+)

```
Store,Sales Channel Breakout,Count,Cleanliness,,Portion Size of Food,,Order Accuracy Y/N,,,
,,,Score,n,Score,n,Score,n,,
04465 - West Lufkin FSU,,85,69%,85,70%,44,91%,85,,
...
```

**Columns (0-indexed):**
| Index | Field |
|-------|-------|
| 0 | Store |
| 1 | Sales Channel Breakout |
| 2 | Count |
| 3 | Cleanliness Score (%) |
| 4 | Cleanliness n |
| 5 | Portion Size of Food Score (%) |
| 6 | Portion Size of Food n |
| 7 | Order Accuracy Y/N Score (%) |
| 8 | Order Accuracy Y/N n |

---

## Important Parsing Notes

### Per-metric `n` varies
Not all respondents answer all questions. `Portion Size of Food` often has a smaller `n` than `Count`. Each metric's `n` must be stored independently for accurate daily inference.

### Sentinel values
- `**` appears when sample size is too small for reporting. Must map to `null`.

### Aggregate vs channel rows
- Row with **blank** Sales Channel Breakout = store-level aggregate
- Named channel rows = channel-specific breakdown

### Store ID parsing
`04465 - West Lufkin FSU` → `store_id: "04465"`, `store_name: "West Lufkin FSU"`

### Sales channel set (observed)
- Carry Out
- Curbside
- Dine In
- Drive Thru
- Mobile Carry Out
- Mobile Dine In
- Mobile Drive Thru

Not all channels appear in every time bucket. Channels with zero responses are omitted.

### Time bucket → Email subject mapping
| Email Subject Suffix | `time_bucket` in CSV |
|---------------------|----------------------|
| Breakfast | Before 10:30 AM |
| Lunch | 10:30 AM to 2 PM |
| Afternoon | 2 PM to 5 PM |
| Dinner Rush | 5PM to 7 PM |
| Closing | After 7 PM |

---

## All 7 Metrics (Canonical Names)

| Metric | Block | Primary? | Notes |
|--------|-------|----------|-------|
| `overall_satisfaction` | 1 | **Primary** | Top-line KPI |
| `taste_of_food` | 1 | Secondary | |
| `fast_service` | 1 | Secondary | |
| `attentive_friendly` | 1 | Secondary | |
| `cleanliness` | 2 | Secondary | |
| `portion_size` | 2 | Secondary | n often differs from Count |
| `order_accuracy` | 2 | Secondary | Y/N question |

---

## Target Schema: `fact_daily_metric`

Long-form fact table at grain: one row per (business_date, store, time_bucket, sales_channel, metric).

| Column | Type | Description |
|--------|------|-------------|
| `business_date` | DATE | End date from Comparison header |
| `store_id` | STRING | e.g., `04465` |
| `store_name` | STRING | e.g., `West Lufkin FSU` |
| `time_bucket` | STRING | e.g., `Before 10:30 AM` |
| `sales_channel` | STRING | e.g., `Drive Thru` (blank = `_TOTAL`) |
| `metric_name` | STRING | e.g., `overall_satisfaction` |
| `cum_score_pct` | FLOAT | Cumulative % from CSV |
| `cum_n` | INTEGER | Cumulative n from CSV |
| `cum_numerator` | INTEGER | Derived: round(cum_score_pct × cum_n) |
| `daily_score_pct` | FLOAT | Inferred from delta |
| `daily_n` | INTEGER | cum_n(today) − cum_n(yesterday) |
| `daily_numerator` | INTEGER | cum_numerator(today) − cum_numerator(yesterday) |
| `source_file_name` | STRING | Original CSV filename |
| `message_id` | STRING | Gmail message ID |
| `run_id` | STRING | Processing run identifier |
| `loaded_at` | DATETIME | When this row was written |

---

## Daily Inference Math

For each unique key (`store_id`, `time_bucket`, `sales_channel`, `metric_name`):

```
cum_numerator = round(cum_score_pct × cum_n)

daily_n = cum_n(today) − cum_n(yesterday)
daily_numerator = cum_numerator(today) − cum_numerator(yesterday)

if daily_n > 0:
  daily_score_pct = daily_numerator / daily_n
else:
  daily_score_pct = null  (no new responses)
```

**Month boundary**: On day 1, yesterday's values are all zero.

**Late responses**: Reprocess trailing 3 days on every run to capture updates.
