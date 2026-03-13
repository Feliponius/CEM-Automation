# CEM Score Automation — Proposal

## Executive Summary

This proposal outlines an automated system to process daily CEM (Customer Experience Management) CSV reports, derive daily scores from cumulative data, and produce breakdowns by Day of Week, Week of Month, Sales Channel, and Time Slot.

---

## 1. The Cumulative Data Challenge

### Current State

Each daily report is **month-to-date cumulative**:

| Report Date | Cumulative Count | Cumulative Score |
|-------------|------------------|------------------|
| March 3     | 36               | 53%              |
| March 6     | 52               | 62%              |
| March 10    | 78               | 58%              |

The cumulative score is a **weighted average** of all responses so far in the month, not a simple average of daily scores.

### Math for Daily Deltas

To get **daily** count and score:

1. **Daily Count** = Today's cumulative count − Yesterday's cumulative count  
   - Example: March 6 daily count = 52 − 36 = **16**

2. **Daily Score** (weighted average interpretation):  
   - Cumulative score = (Sum of all responses × their scores) / Total count  
   - We cannot perfectly reverse this without raw response-level data.  
   - **Approximation**: Treat cumulative score as the month-to-date average. Daily contribution can be estimated using:
     - **Option A**: Store cumulative (count, score) each day and compute deltas; use cumulative score as the "effective" score for that period.
     - **Option B**: If we only have (count, score) per day, we can **back-calculate** daily weighted contribution:
       - `New_Cumulative_Score = (Old_Count × Old_Score + Daily_Count × Daily_Score) / New_Count`
       - Solving for `Daily_Score`:  
         `Daily_Score = (New_Count × New_Score − Old_Count × Old_Score) / Daily_Count`

**Formula for Daily Score (derived):**

```
Daily_Score = (Cumulative_Count_today × Cumulative_Score_today − Cumulative_Count_yesterday × Cumulative_Score_yesterday) / Daily_Count
```

Example:  
- March 3: 36 × 0.53 = 19.08  
- March 6: 52 × 0.62 = 32.24  
- Daily (Mar 4–6): Count = 16, Score = (32.24 − 19.08) / 16 = **82.25%**

*(Note: This assumes the report covers multiple days if we only get reports every few days. If reports are truly daily, we get one day at a time.)*

---

## 2. Breakdown Dimensions

### 2.1 Score by Day of Week (Mon–Sat)

- **Input**: Daily (date, count, score) after delta calculation
- **Output**: For each weekday Mon–Sat, compute:
  - Total count
  - Weighted average score
  - Number of days in sample
- **Exclusion**: Sunday (per requirement)

### 2.2 Score by Week of Month

- **Week 1**: Days 1–7  
- **Week 2**: Days 8–14  
- **Week 3**: Days 15–21  
- **Week 4**: Days 22–28  
- **Week 5**: Days 29–31 (partial week, "fuzzy" end-of-month)

Alternative: Use calendar weeks (e.g., first full Mon–Sat of month) if that aligns better with operations.

### 2.3 Score by Sales Channel

**Channels:** Carry Out, Curbside, Dine In, Drive Thru, Mobile Carry Out, Mobile Dine In, Mobile Drive Thru

- **Requirement**: CSV (or source data) must include a Sales Channel column
- **Output**: Per channel: count, weighted score, % of total
- **Status**: Pending confirmation of CSV structure

### 2.4 Score by Time Slot

**Slots:** Before 10:30 AM, 10:30 AM to 2 PM, 2 PM to 5 PM, 5 PM to 7 PM, After 7 PM

- **Requirement**: CSV must include timestamp or time-slot column
- **Output**: Per slot: count, weighted score, % of total
- **Status**: Pending confirmation of CSV structure

---

## 3. Data Flow (Proposed)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  CEM Report     │     │  Gmail / Inbox   │     │  Apps Script    │
│  (CSV attached) │────▶│  (daily email)   │────▶│  Trigger        │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Dashboards &    │◀────│  Google Sheets   │◀────│  Parse CSV      │
│  Charts         │     │  (raw + derived)  │     │  Compute deltas │
└─────────────────┘     └──────────────────┘     │  Build views    │
                                                  └─────────────────┘
```

1. **Ingest**: Gmail receives daily CEM email with CSV attachment
2. **Extract**: Apps Script fetches attachment, parses CSV
3. **Store**: Append raw row to "Raw Data" sheet (date, cumulative count, cumulative score, + any channel/time columns)
4. **Compute**: Script derives daily (date, count, score) and writes to "Daily Data" sheet
5. **Aggregate**: Script builds "Day of Week", "Week of Month", "Sales Channel", "Time Slot" summary sheets
6. **Visualize**: Charts in Sheets or optional Data Studio / Looker Studio

---

## 4. CSV Structure Assumptions

### Minimum (for basic daily breakdown)

| Column        | Example   | Notes                          |
|---------------|-----------|--------------------------------|
| Report_Date   | 2026-03-06| Date of report                 |
| Cumulative_Count | 52     | Month-to-date response count   |
| Cumulative_Score | 62%    | Month-to-date score (as % or 0–1) |

### Extended (for channel & time breakdown)

| Column        | Example        | Notes                    |
|---------------|----------------|--------------------------|
| Sales_Channel | Drive Thru     | One of the 7 channels    |
| Time_Slot     | 10:30 AM to 2 PM| One of the 5 slots      |
| Count         | 12             | Count for that segment   |
| Score         | 65%            | Score for that segment   |

*If the CSV is one row per day (single cumulative totals), we need to confirm whether channel/time breakdowns exist in the source system or require a different report format.*

---

## 5. Edge Cases

- **Missing days**: If a report is skipped, we cannot compute that day's delta. Options: leave blank, interpolate, or flag.
- **Month boundary**: First day of month has no "yesterday"; use 0 for previous cumulative.
- **Week 5**: Short month (28–31 days); Week 5 may have 1–3 days. Document as "partial week."
- **Multiple reports per day**: Define rule (e.g., use latest, or sum).

---

## 6. Success Criteria

- [ ] Daily scores and counts correctly derived from cumulative data
- [ ] Day-of-week breakdown (Mon–Sat) with weighted averages
- [ ] Week-of-month breakdown (1–5) with handling for partial Week 5
- [ ] Sales channel breakdown (when data available)
- [ ] Time slot breakdown (when data available)
- [ ] Automated ingestion from Gmail (or manual upload fallback)
- [ ] Clear documentation for future maintainers

---

## 7. Next Steps

1. **Confirm CSV structure** — Obtain sample CSVs (basic + extended if possible)
2. **Confirm report frequency** — Daily? Same time each day?
3. **Choose stack** — See [STACK.md](STACK.md) for Sheets/Apps Script/Gmail recommendation
4. **Implement Phase 1** — Raw ingest + daily delta + Day of Week + Week of Month
5. **Implement Phase 2** — Channel and Time Slot (when data format is confirmed)
