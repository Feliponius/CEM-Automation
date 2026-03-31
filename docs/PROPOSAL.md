# Eleanor — CEM Daily Insights System

> Updated: 2026-03-31

---

## Executive Summary

Eleanor is an automated customer experience monitoring system that transforms daily SMG cumulative reports into actionable daily insights. It ingests CSV attachments from Gmail, infers per-day performance from cumulative data, delivers Slack summaries to leadership, and powers Looker Studio dashboards for deep-dive analysis.

The system is designed for leadership teams with moderate tech ability and limited time — every output is scannable, color-coded, and tells you what to do, not just what happened.

---

## 1. The Problem

### What we receive
SMG sends 5 emails daily (one per time-of-day bucket) containing CSV attachments with **cumulative month-to-date** CEM scores. Each day's report includes all previous days of the month.

### Why that's hard
- You can't see how yesterday went without comparing two cumulative snapshots
- 7 metrics × 5 time buckets × 7 sales channels = 245 data points per day
- Per-metric sample sizes (`n`) differ — simple percentage deltas are misleading
- Late-arriving responses (2-day SMG window) can change previously reported numbers
- Manual analysis takes 30+ minutes/day and is error-prone

### What we need
A system that runs at 2:30 AM daily and by the time leadership checks Slack at 7 AM, they know:
1. How did we do yesterday? (Overall + by bucket + by channel)
2. How are we trending this month?
3. Where should we focus today?
4. Are there any data quality concerns?

---

## 2. Data Flow

```
SMG (5 emails/day)
    │
    ▼
Gmail Inbox (SMGMailMgr@whysmg.com)
    │
    ▼
Apps Script Pipeline (2:30 AM trigger)
    ├── Extract CSV attachments
    ├── Parse header metadata (date range, time bucket)
    ├── Parse Block 1: Overall Satisfaction, Taste, Fast Service, Attentive/Friendly
    ├── Parse Block 2: Cleanliness, Portion Size, Order Accuracy
    ├── Normalize: store ID split, sentinel handling, canonical names
    ├── Store raw cumulative → raw_cumulative sheet
    ├── Compute daily deltas → fact_daily_metric sheet
    ├── Reprocess trailing 3 days (late responses)
    ├── Run data quality checks
    ├── Build Slack summary
    │
    ▼
┌─────────────────┐    ┌──────────────────────┐
│  Slack Bot       │    │  Looker Studio        │
│  Daily digest    │    │  Interactive dashboard │
│  to leadership   │    │  for drill-down        │
└─────────────────┘    └──────────────────────┘
```

---

## 3. Daily Inference Math

Because reports are cumulative, we derive daily performance using weighted numerator deltas:

```
cum_numerator(day) = round(cum_score_pct(day) × cum_n(day))

daily_n = cum_n(today) − cum_n(yesterday)
daily_numerator = cum_numerator(today) − cum_numerator(yesterday)

daily_score_pct = daily_numerator / daily_n   (when daily_n > 0)
```

This is applied independently per metric (because each metric has its own `n`).

**Why not just subtract percentages?**
If yesterday's cumulative was 72% (n=81) and today is 69% (n=85), subtracting gives -3%, which is meaningless. The correct daily score for the 4 new responses is:
```
cum_numerator(yesterday) = round(0.72 × 81) = 58
cum_numerator(today) = round(0.69 × 85) = 59
daily_numerator = 59 − 58 = 1
daily_n = 85 − 81 = 4
daily_score = 1/4 = 25%
```

---

## 4. Metrics

| Metric | Type | Priority | Notes |
|--------|------|----------|-------|
| Overall Satisfaction | Top-box % | **Primary** | The single number leadership sees first |
| Taste of Food | Top-box % | Secondary | |
| Fast Service | Top-box % | Secondary | |
| Attentive/Friendly | Top-box % | Secondary | |
| Cleanliness | Top-box % | Secondary | |
| Portion Size of Food | Top-box % | Secondary | Often has lower n (not all respondents answer) |
| Order Accuracy Y/N | Yes % | Secondary | Binary question; different interpretation |

---

## 5. Dimensions

| Dimension | Values | Notes |
|-----------|--------|-------|
| Business Date | Daily | Derived from Comparison end date |
| Store | 04465 - West Lufkin FSU (+ future locations) | Parsed from CSV |
| Time Bucket | Before 10:30 AM, 10:30 AM to 2 PM, 2 PM to 5 PM, 5PM to 7 PM, After 7 PM | One CSV per bucket |
| Sales Channel | Carry Out, Curbside, Dine In, Drive Thru, Mobile Carry Out, Mobile Dine In, Mobile Drive Thru | Varies by bucket; not all appear daily |
| Day of Week | Monday–Saturday | Sunday excluded (closed) |
| Week of Month | Week 1–5 | Week 5 = days 29–31 (partial) |

---

## 6. Leadership Delivery Design

### Design principles for the audience

Leadership team members are:
- **Moderate in tech ability**: They use Slack and can click links, but won't filter dashboards unprompted
- **Low in executive function capacity**: They need the system to tell them what matters — not present raw data and expect synthesis

### Slack daily digest rules

1. **Scannable in <10 seconds**: Emoji indicators (🟢🟡🔴), bold primary metric, plain English
2. **Tells you what to do**: "Where to focus" section with specific, actionable callouts
3. **Consistent format**: Same structure every day builds habit and reduces cognitive load
4. **Quiet on good days**: All green and stable → 2-line summary. Detailed breakdown only when there's movement or risk
5. **No jargon**: Spell out "month-to-date" not "MTD" on first use. No "n" or "delta" in leader-facing output
6. **Comparison context**: Every number includes "vs yesterday" or "vs target" — raw numbers alone are meaningless

### Looker Studio dashboard rules

1. **Default view requires zero clicks**: Executive Overview shows yesterday + MTD with no filters needed
2. **Color-coded everything**: Green/yellow/red conditional formatting on all score cells
3. **Drill-down is optional**: Curious leaders can explore; busy ones get what they need from page 1
4. **Mobile-friendly**: Responsive layout — many will check on phones

---

## 7. Threshold System

Targets are stored in `config_targets` sheet with support for:
- **Retroactive changes**: Effective date range allows updating historical targets
- **Granular or broad**: Set targets per metric/store/bucket/channel, or use wildcards (`*`) for blanket targets
- **Three-tier status**: Green (≥ green_min), Yellow (≥ yellow_min), Red (< yellow_min)

Example:
| effective_start | metric | store | target_green_min | target_yellow_min |
|----------------|--------|-------|-----------------|------------------|
| 2026-03-01 | overall_satisfaction | * | 75% | 65% |
| 2026-03-01 | fast_service | * | 65% | 55% |
| 2026-03-15 | overall_satisfaction | 04465 | 78% | 68% |

---

## 8. Multi-Location Readiness

Single location today, but the schema supports N locations from day 1:
- Every row is keyed by `store_id`
- `config_locations` manages the store registry
- Slack channels are per-store (configurable)
- Looker Studio store filter is built-in
- Future: regional rollups, store-vs-store leaderboards

---

## 9. Edge Cases

| Scenario | Handling |
|----------|----------|
| First day of month | Yesterday's cumulative = 0 across all metrics |
| SMG late responses (2-day window) | Reprocess trailing 3 days on every run |
| Missing time bucket email | Process what's available; flag gap in Slack and run_log |
| Sentinel value `**` | Map to null; exclude from aggregation |
| Negative daily_n after reprocessing | Data quality error; flag, don't propagate |
| New sales channel appears | Auto-handled (parser reads whatever channels exist) |
| New store appears in CSV | Auto-insert into config_locations with defaults |
| All metrics green, no movement | Slack quiet mode: 2-line summary |

---

## 10. Success Criteria

### v1 (launch)
- [ ] Daily pipeline runs reliably at 2:30 AM with retry
- [ ] All 7 metrics parsed from both CSV blocks
- [ ] Daily deltas correctly inferred with per-metric n
- [ ] Trailing 3-day reprocessing handles late responses
- [ ] Slack daily digest posted to leadership channel
- [ ] Slack message is scannable, actionable, and color-coded
- [ ] Looker Studio dashboard with Executive Overview page
- [ ] Config sheet for targets (editable, retroactive)
- [ ] Run log with data quality flags
- [ ] Pipeline failure alerts to admin Slack channel

### v1.1 (fast follow)
- [ ] Period-over-period comparisons (vs last week, vs last month)
- [ ] Quiet mode for all-green days
- [ ] Metric glossary / help reference
- [ ] Backup export to Drive

### v2 (expansion)
- [ ] Multi-location with store leaderboards
- [ ] Regional rollups
- [ ] BigQuery migration
- [ ] AI-generated narrative summaries
- [ ] Action tracking ("What did you do about yesterday's score?")
