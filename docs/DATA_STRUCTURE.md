# CEM Report — Data Structure Reference

This document describes the expected CSV structure for the CEM automation. Update this once you have actual sample reports.

---

## Minimum Required (Basic Daily Breakdown)

For Day of Week and Week of Month breakdowns, we need at least:

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| Report_Date | Date | 2026-03-06 | Date the report covers (or date generated) |
| Cumulative_Count | Integer | 52 | Month-to-date total response count |
| Cumulative_Score | Number | 62 or 0.62 | Month-to-date score (% or decimal) |

**Note**: Column names may vary (e.g., "Count", "Score", "MTD Count"). The parser will need to map these to the standard names.

---

## Extended (Sales Channel & Time Slot)

If your reports include breakdowns by channel and time, we need one of these structures:

### Option A: One Row Per Segment

| Report_Date | Sales_Channel | Time_Slot | Count | Score |
|-------------|---------------|-----------|-------|-------|
| 2026-03-06 | Drive Thru | 10:30 AM to 2 PM | 18 | 65 |
| 2026-03-06 | Dine In | 5 PM to 7 PM | 12 | 58 |
| ... | ... | ... | ... | ... |

### Option B: Wide Format (Multiple Columns)

| Report_Date | Drive_Thru_Count | Drive_Thru_Score | Dine_In_Count | Dine_In_Score | ... |
|-------------|------------------|------------------|---------------|---------------|-----|
| 2026-03-06 | 18 | 65 | 12 | 58 | ... |

Option A is easier to aggregate; Option B requires unpivoting.

---

## Sales Channel Values (Canonical)

- Carry Out
- Curbside
- Dine In
- Drive Thru
- Mobile Carry Out
- Mobile Dine In
- Mobile Drive Thru

---

## Time Slot Values (Canonical)

- Before 10:30 AM
- 10:30 AM to 2 PM
- 2 PM to 5 PM
- 5 PM to 7 PM
- After 7 PM

---

## Sample CSV (Minimum)

```csv
Report_Date,Cumulative_Count,Cumulative_Score
2026-03-01,12,55
2026-03-02,24,52
2026-03-03,36,53
2026-03-04,42,54
2026-03-05,48,56
2026-03-06,52,62
```

---

## Data Collection Checklist

- [ ] Obtain 1–2 weeks of sample CSV reports
- [ ] Document actual column names
- [ ] Confirm whether reports are daily or less frequent
- [ ] Check if Sales Channel / Time Slot columns exist
- [ ] Note date format (YYYY-MM-DD, MM/DD/YYYY, etc.)
- [ ] Note score format (0–100 vs 0–1)
