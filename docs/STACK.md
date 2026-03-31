# CEM Automation — Stack

> Updated: 2026-03-31

---

## Primary Stack: Apps Script + Sheets + Slack + Looker Studio

| Layer | Technology | Role |
|-------|-----------|------|
| **Ingestion** | Google Apps Script + GmailApp | Fetch SMG emails, extract CSV attachments |
| **Storage** | Google Sheets | Raw cumulative data, fact tables, config, logs |
| **Compute** | Google Apps Script | Parse CSVs, infer daily deltas, run quality checks |
| **Delivery** | Slack Bot API (via UrlFetchApp) | Daily leadership summaries, failure alerts |
| **Visualization** | Looker Studio | Interactive dashboards, scheduled PDF reports |
| **Scheduling** | Apps Script Time-driven Triggers | Daily pipeline at 2:30 AM with retry logic |

---

## Why This Stack?

| Factor | Rating | Notes |
|--------|--------|-------|
| **Setup cost** | Very low | No servers, no deployment pipeline |
| **Email integration** | Native | GmailApp is built into Apps Script |
| **Collaboration** | Excellent | Sheets is familiar to everyone |
| **Leadership access** | Excellent | Slack + Looker = zero-friction consumption |
| **Cost** | Free | Within Google Workspace quotas |
| **Maintainability** | Good | JavaScript, config-driven, no dependencies |
| **Scalability** | Moderate | Sufficient for ~5 locations; BigQuery for beyond |

---

## Component Details

### Google Apps Script

- **Language**: JavaScript (V8 runtime with modern ES6+ support)
- **Execution limit**: 6 minutes per run (free tier)
- **Daily trigger quota**: 90 minutes/day (free tier)
- **APIs used**: `GmailApp`, `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`
- **Deployment**: Bound to the Google Sheets spreadsheet

### Google Sheets

- **Cell limit**: 10 million cells per spreadsheet
- **Capacity estimate**: ~90K cells/month/location (comfortable for years at 1–5 locations)
- **Archival strategy**: Move completed months to archive sheet or BigQuery

### Slack Bot API

- **Method**: `chat.postMessage` via `UrlFetchApp.fetch()`
- **Message format**: Block Kit (structured blocks with sections, fields, dividers)
- **Authentication**: Bot token stored in `PropertiesService` (not in sheet cells)
- **Channels**: Configurable per location via `config_locations` sheet
- **Admin alerts**: Separate channel for pipeline failures

### Looker Studio

- **Data source**: Google Sheets (direct connector)
- **Pages**: Executive Overview, Wins & Risks, Deep Dive Explorer, Data Quality
- **Filters**: Date, store, time bucket, sales channel
- **Distribution**: Shareable link + optional scheduled email (PDF)
- **Mobile**: Responsive layout for phone viewing

---

## Migration Path: Sheets → BigQuery

When to migrate:
- More than 5 locations
- Need for complex SQL analytics
- Sheets cell limits approached
- Sub-second dashboard load times required

Migration steps:
1. Create BigQuery dataset with same schema as `fact_daily_metric`
2. Apps Script writes to BigQuery via `BigQuery.Jobs.insert()` (Advanced Service)
3. Swap Looker Studio data source from Sheets to BigQuery
4. Keep Sheets as config layer (targets, locations, runtime)
5. Archive historical Sheets data to BigQuery

---

## Quotas & Limits to Monitor

| Resource | Limit | Our Usage | Risk |
|----------|-------|-----------|------|
| Apps Script execution | 6 min/run | ~1–2 min expected | Low |
| Daily trigger quota | 90 min/day | ~5–10 min (3 runs) | Low |
| Gmail read quota | 10K messages/day | 5–15 messages/day | None |
| Sheets cells | 10M per spreadsheet | ~90K/month/location | Low (years of runway) |
| Slack messages | 1 msg/channel/second | 1–3 messages/day | None |
| UrlFetchApp calls | 20K/day | <20/day | None |

---

## Security Considerations

| Item | Approach |
|------|----------|
| Slack bot token | Stored in `PropertiesService.getScriptProperties()`, never in cells |
| Gmail access | Apps Script OAuth; scoped to read-only for CEM emails |
| Sheet access | Shared with leadership via standard Google Sheets permissions |
| Looker Studio | Viewer access via link; no edit permissions for consumers |
| Sensitive data | CEM scores are operational, not PII; minimal exposure risk |
