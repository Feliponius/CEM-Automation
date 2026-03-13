# CEM Automation

Responsible for taking CEM (Customer Experience Management) daily reports and creating a clear view of each day's scores with meaningful breakdowns.

## The Problem

Daily CEM reports arrive in CSV format with **cumulative** data—each day's report contains that day's scores + all previous days of the month. This makes manual analysis difficult:

- **March 3rd report**: Count: 36, Score: 53%
- **March 6th report**: Count: 52, Score: 62%

To understand individual day performance, we need to derive daily deltas from the cumulative totals.

## Goals

1. **Breakdown cumulative data** into daily scores and counts
2. **Analyze by Day of Week** (Mon–Sat, excluding Sunday)
3. **Analyze by Week of Month** (1st, 2nd, 3rd, 4th, 5th)
4. **Breakdown by Sales Channel** (when data available)
5. **Breakdown by Time Slot** (when data available)

## Documentation

| Document | Description |
|----------|-------------|
| [PROPOSAL.md](docs/PROPOSAL.md) | Full proposal with approach, math, and data flow |
| [PLAN.md](docs/PLAN.md) | Implementation plan and phases |
| [STACK.md](docs/STACK.md) | Stack recommendation (Sheets / Apps Script / Gmail) |
| [DATA_STRUCTURE.md](docs/DATA_STRUCTURE.md) | Expected CSV structure and sample format |

## Quick Start

Once data collection is confirmed, see [PLAN.md](docs/PLAN.md) for implementation steps.

## Sales Channel & Time Slot Reference

**Sales Channels:** Carry Out, Curbside, Dine In, Drive Thru, Mobile Carry Out, Mobile Dine In, Mobile Drive Thru

**Time Slots:** Before 10:30 AM, 10:30 AM to 2 PM, 2 PM to 5 PM, 5 PM to 7 PM, After 7 PM
