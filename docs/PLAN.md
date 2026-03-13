# CEM Automation — Implementation Plan

## Overview

This plan breaks the project into phases, from scaffolding to full automation with all breakdowns.

---

## Phase 0: Scaffolding & Documentation ✅

- [x] Create README.md
- [x] Create PROPOSAL.md (approach, math, data flow)
- [x] Create PLAN.md (this document)
- [x] Create STACK.md (stack recommendation)
- [ ] Obtain sample CSV(s) from actual reports
- [ ] Document actual CSV column names and structure

---

## Phase 1: Core Data Pipeline

**Goal**: Ingest cumulative data and derive daily scores.

### 1.1 Google Sheets Structure

| Sheet Name    | Purpose                                      |
|---------------|----------------------------------------------|
| Raw_Data      | Append-only: each row = one report (date, cumulative count, cumulative score) |
| Daily_Data    | Derived: date, daily_count, daily_score       |
| Config        | Report date range, last processed date       |

### 1.2 Apps Script — Core Functions

1. **`parseCsvFromAttachment(csvBlob)`**  
   - Parse CSV to array of objects  
   - Normalize column names (handle variations)

2. **`appendRawData(row)`**  
   - Append to Raw_Data sheet  
   - Avoid duplicates (check date)

3. **`computeDailyDeltas()`**  
   - Read Raw_Data sorted by date  
   - For each date: daily_count = today_cumulative − yesterday_cumulative  
   - daily_score = (today_cumulative × today_score − yesterday_cumulative × yesterday_score) / daily_count  
   - Write to Daily_Data

4. **`runDailyPipeline()`**  
   - Main entry: fetch latest CSV (from Gmail or manual), parse, append raw, compute deltas

### 1.3 Triggers

- **Time-driven**: Daily trigger (e.g., 8 AM) to check Gmail for CEM report and process
- **Manual**: Menu item "Process CEM Report" for manual CSV paste/upload

---

## Phase 2: Day of Week & Week of Month Breakdowns

**Goal**: Aggregate Daily_Data by weekday and week-of-month.

### 2.1 New Sheets

| Sheet Name       | Purpose                                              |
|------------------|------------------------------------------------------|
| By_DayOfWeek     | Mon–Sat: count, weighted score, sample size          |
| By_WeekOfMonth   | Week 1–5: count, weighted score, days in week        |

### 2.2 Apps Script Functions

1. **`aggregateByDayOfWeek()`**  
   - Filter Daily_Data: exclude Sunday  
   - Group by weekday (Mon=1 … Sat=6)  
   - Weighted average: sum(count × score) / sum(count)

2. **`aggregateByWeekOfMonth()`**  
   - Map each date to week number: ceil(day_of_month / 7)  
   - Week 5 = days 29–31  
   - Same weighted average logic

3. **`refreshAllBreakdowns()`**  
   - Call computeDailyDeltas, then aggregateByDayOfWeek, aggregateByWeekOfMonth  
   - Update By_DayOfWeek and By_WeekOfMonth sheets

---

## Phase 3: Sales Channel & Time Slot (When Data Available)

**Goal**: Add breakdowns when CSV includes channel and time columns.

### 3.1 Data Structure Assumption

Either:
- **Option A**: One row per (date, channel, time_slot) with count and score
- **Option B**: Multiple columns in a single row (e.g., Drive_Thru_Count, Drive_Thru_Score, etc.)

### 3.2 New Sheets

| Sheet Name        | Purpose                                    |
|-------------------|--------------------------------------------|
| By_SalesChannel   | Per channel: count, score, % of total      |
| By_TimeSlot       | Per slot: count, score, % of total         |

### 3.3 Apps Script Functions

1. **`parseExtendedCsv(csvBlob)`**  
   - Detect channel/time columns  
   - Normalize to standard names

2. **`aggregateBySalesChannel()`**  
   - Group by Sales_Channel  
   - Sum count, weighted average score

3. **`aggregateByTimeSlot()`**  
   - Group by Time_Slot  
   - Sum count, weighted average score

### 3.4 Conditional Logic

- If CSV has channel/time columns → run extended aggregation  
- If not → skip and log "Extended breakdowns require channel/time data"

---

## Phase 4: Gmail Integration

**Goal**: Automatically fetch CEM report from Gmail.

### 4.1 Gmail Search

- **Query**: `from:cem-report@example.com subject:"CEM Daily Report" has:attachment newer_than:2d`  
  *(Adjust sender and subject based on actual email)*

- **Attachment**: Find CSV attachment (e.g., `.csv` or specific filename pattern)

### 4.2 Apps Script

1. **`fetchLatestCemReport()`**  
   - Search Gmail with query  
   - Get most recent message  
   - Extract CSV attachment  
   - Return Blob

2. **`processInboxReport()`**  
   - Call fetchLatestCemReport  
   - If found: parseCsvFromAttachment → appendRawData → computeDailyDeltas → refreshAllBreakdowns  
   - Mark email as read (optional)  
   - Log success/failure

### 4.3 Permissions

- Apps Script will need `GmailApp` scope  
- User must authorize on first run

---

## Phase 5: Charts & Dashboards

**Goal**: Visual summaries in Sheets.

- **Chart 1**: Day of Week — bar chart (Mon–Sat vs. score)
- **Chart 2**: Week of Month — bar chart (Week 1–5 vs. score)
- **Chart 3**: Daily trend — line chart (date vs. daily score)
- **Chart 4 & 5**: Sales Channel and Time Slot (when data available) — pie or bar charts

---

## File Structure (Apps Script)

```
CEM-Automation/
├── Code.gs           # Main entry, triggers, menu
├── Parser.gs         # CSV parsing, column normalization
├── Compute.gs        # Delta calculation, aggregations
├── Gmail.gs          # Gmail fetch logic
└── Config.gs         # Sheet names, column mappings, constants
```

---

## Timeline (Estimated)

| Phase | Effort   | Dependencies              |
|-------|----------|---------------------------|
| 0     | Done     | —                         |
| 1     | 2–4 hrs  | Sample CSV                |
| 2     | 1–2 hrs  | Phase 1 complete          |
| 3     | 2–3 hrs  | CSV structure confirmed   |
| 4     | 1–2 hrs  | Gmail sender/subject      |
| 5     | 1 hr     | Phase 2+ complete         |

---

## Risks & Mitigations

| Risk                    | Mitigation                                      |
|-------------------------|-------------------------------------------------|
| CSV format changes      | Config-driven column mapping; document schema   |
| Missing reports         | Log gaps; optional interpolation or flag        |
| Gmail quota limits      | Batch processing; avoid excessive API calls     |
| Week 5 ambiguity        | Document "partial week" in UI and docs          |
