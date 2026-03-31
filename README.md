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

## Quick Start

See [PLAN.md](docs/PLAN.md) for implementation phases. Phase 1 = core pipeline (Gmail → parse → store → infer daily).
