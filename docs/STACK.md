# CEM Automation — Stack Proposal

## Recommended Stack: Google Sheets + Apps Script + Gmail

This stack aligns with your suggestion and fits the use case well: low setup cost, no separate hosting, and direct integration with email.

---

## Why This Stack?

| Factor | Sheets / Apps Script / Gmail |
|--------|------------------------------|
| **Familiarity** | Most teams already use Google Workspace |
| **Email integration** | Gmail API built into Apps Script |
| **No hosting** | Runs in Google's cloud |
| **Collaboration** | Share sheets with stakeholders |
| **Charts** | Native Sheets charts for dashboards |
| **Cost** | Free for typical usage |
| **Learning curve** | Moderate; JavaScript-based |

---

## Component Roles

### 1. Google Sheets

- **Raw_Data**: Append-only log of each report
- **Daily_Data**: Derived daily scores and counts
- **By_DayOfWeek**, **By_WeekOfMonth**: Aggregated views
- **By_SalesChannel**, **By_TimeSlot**: When data available
- **Config**: Settings, last run, column mappings
- **Charts**: Embedded visualizations

### 2. Google Apps Script

- **Language**: JavaScript (ES5-ish, some ES6 support)
- **Triggers**: Time-driven (daily) or manual
- **APIs**: SpreadsheetApp, GmailApp, UrlFetchApp (if needed)
- **Deployment**: Bound to the spreadsheet; no separate deploy step

### 3. Gmail

- **Source**: Inbox where CEM reports arrive
- **Filter**: Search by sender, subject, attachment type
- **Processing**: Apps Script reads attachment, parses CSV, writes to Sheets

---

## Alternative Stacks (For Reference)

| Stack | Pros | Cons |
|-------|------|------|
| **Python + local CSV** | Full control, pandas for analysis | Manual email handling, no built-in UI |
| **Python + Google Sheets API** | Programmatic access | More setup, separate hosting |
| **Node.js + Airtable** | Nice UI | Extra cost, different workflow |
| **Power BI / Looker Studio** | Strong viz | Better for reporting than ingestion/ETL |

For **ingestion + derivation + simple dashboards**, Sheets + Apps Script + Gmail is the most straightforward.

---

## Setup Steps (High Level)

1. Create a new Google Sheet (e.g., "CEM Score Automation")
2. Extensions → Apps Script
3. Create `Code.gs`, `Parser.gs`, `Compute.gs`, `Gmail.gs`, `Config.gs`
4. Add time-driven trigger: daily at chosen time
5. Add custom menu: "CEM" → "Process Report" (manual fallback)
6. Authorize Gmail and Sheets access on first run
7. Configure Gmail search query (sender, subject) in Config.gs

---

## Gmail Search Query (Example)

```
from:reports@yourcemprovider.com subject:"Daily CEM" filename:csv newer_than:3d
```

Adjust `from`, `subject`, and `filename` to match your actual CEM report emails.

---

## Limitations to Be Aware Of

- **Apps Script quotas**: 6 min/execution, 20 min/day for triggers (free). Usually sufficient for daily processing.
- **Sheet size**: 10M cells per spreadsheet. Raw_Data will grow; consider archiving old months.
- **CSV parsing**: Built-in `Utilities.parseCsv()` works for simple CSVs; complex formats may need custom parsing.

---

## Summary

**Recommended**: Google Sheets + Apps Script + Gmail for end-to-end automation with minimal infrastructure. Proceed with Phase 1 once sample CSV structure is confirmed.
