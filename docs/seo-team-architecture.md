# SEO Agent Team — Architecture

## Old: DeerFlow (Parallel Scanners)

```
                    ┌─────────────┐
                    │  Lead Agent  │
                    └──────┬──────┘
                           │ fires all at once
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴──────┐
    │Lighthouse  │   │Technical  │   │Competitor   │  ... (all parallel)
    │Agent       │   │Agent      │   │Agent        │
    └─────┬─────┘   └─────┬─────┘   └─────┬──────┘
          │                │                │
          └────────────────┼────────────────┘
                           │ collect results
                    ┌──────┴──────┐
                    │Recommendation│
                    │Agent (Claude)│
                    └─────────────┘

Problem: Nobody talks to anybody. It's just parallel API calls
with an agent wrapper. Recommendation agent gets raw data dumps.
```

## New: SEO Team (Phased Multi-Agent)

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1 — Independent Scans (Parallel)                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Technical    │  │  Keyword     │  │  Competitor   │         │
│  │  Agent        │  │  Agent       │  │  Agent        │         │
│  │              │  │              │  │              │          │
│  │ • Crawl site  │  │ • Search     │  │ • Map sites   │         │
│  │ • Find thin   │  │   rankings   │  │ • Scrape top  │         │
│  │   pages       │  │ • Find gaps  │  │   pages       │         │
│  │ • Check meta  │  │ • Score      │  │ • Word counts │         │
│  │ • Audit links │  │   opportunity│  │ • Content     │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                   │
│  ┌──────┴───────┐                                               │
│  │ Rank Tracker  │  (also parallel)                             │
│  │ Agent         │                                              │
│  │ • GSC data    │                                              │
│  │ • Rank drops  │                                              │
│  │ • Snapshots   │                                              │
│  └──────┬───────┘                                               │
└─────────┼───────────────────┼──────────────────┼────────────────┘
          │                   │                  │
          ▼                   ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2 — Content Strategy (Sequential, reads ALL of Phase 1)  │
│                                                                 │
│  ┌──────────────────────────────────────────────────┐           │
│  │  Content Manager Agent                            │           │
│  │                                                   │           │
│  │  Inputs:                                          │           │
│  │  • Thin pages from Technical ──────────┐          │           │
│  │  • Gap keywords from Keyword ──────────┤ builds   │           │
│  │  • Competitor content structure ───────┤ briefs   │           │
│  │  • Ranking drops from RankTracker ─────┘          │           │
│  │                                                   │           │
│  │  Outputs: Prioritized content briefs              │           │
│  │  (type: refresh | new | expand)                   │           │
│  │  + competitor URLs to scrape per brief            │           │
│  └──────────────────────┬───────────────────────────┘           │
└─────────────────────────┼───────────────────────────────────────┘
                          │ briefs
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3 — Content Creation (Sequential, reads Phase 2)         │
│                                                                 │
│  ┌──────────────────────────────────────────────────┐           │
│  │  Content Writer Agent                             │           │
│  │                                                   │           │
│  │  For each brief:                                  │           │
│  │  1. Scrape competitor URLs from brief ◄── Firecrawl          │
│  │  2. Analyze what makes them rank                  │           │
│  │  3. Write content that outperforms     ◄── Claude │           │
│  │  4. Match target word count                       │           │
│  │                                                   │           │
│  │  Output: Content drafts (refresh / new)           │           │
│  └──────────────────────┬───────────────────────────┘           │
└─────────────────────────┼───────────────────────────────────────┘
                          │ drafts + target keywords
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4 — Link Building (Sequential, reads Phase 1 + 3)       │
│                                                                 │
│  ┌──────────────────────────────────────────────────┐           │
│  │  Link Builder Agent                               │           │
│  │                                                   │           │
│  │  Inputs:                                          │           │
│  │  • Competitor domains from Phase 1                │           │
│  │  • New content keywords from Phase 3              │           │
│  │                                                   │           │
│  │  Process:                                         │           │
│  │  1. Search for resource pages per keyword         │           │
│  │  2. Filter out competitor domains                 │           │
│  │  3. Claude prioritizes prospects                  │           │
│  │  4. Generates outreach angles                     │           │
│  │                                                   │           │
│  │  Output: Prioritized link prospects + templates   │           │
│  └──────────────────────┬───────────────────────────┘           │
└─────────────────────────┼───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 5 — Synthesis (reads ALL phases)                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────┐           │
│  │  Team Lead Agent                                  │           │
│  │                                                   │           │
│  │  Sees: Technical + Keywords + Competitors +       │           │
│  │        RankTracker + ContentManager +              │           │
│  │        ContentWriter + LinkBuilder                │           │
│  │                                                   │           │
│  │  Produces:                                        │           │
│  │  • Overall health score (0-100)                   │           │
│  │  • Executive summary                              │           │
│  │  • Ranked priority actions                        │           │
│  │  • Week-by-week execution plan                    │           │
│  │  • KPI targets with timeframes                    │           │
│  │  • Estimated traffic impact                       │           │
│  └──────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow — The Key Chain

```
Technical finds thin pages
        ↓
ContentManager includes those exact URLs in briefs
        ↓
ContentWriter scrapes the competitor versions of those pages
        ↓
ContentWriter writes content that outperforms competitors
        ↓
LinkBuilder searches for link prospects using the new content keywords
        ↓
TeamLead scores everything → one ranked action plan
```

## Agent Tools

| Agent | Firecrawl | Claude | Prisma |
|-------|-----------|--------|--------|
| Technical | `crawl()` | `analyzeJSON(TECHNICAL_AUDIT)` | - |
| Keyword | `search()` | - | - |
| Competitor | `map()`, `scrape()` | - | - |
| RankTracker | - | - | `rankSnapshot`, `orgGSCToken` |
| ContentManager | - | `analyzeJSON()` (custom) | - |
| ContentWriter | `scrape()` (competitor URLs) | `analyze(CONTENT_GENERATE)` | - |
| LinkBuilder | `search()` | `analyzeJSON()` (custom) | - |
| TeamLead | - | `analyzeJSON()` (custom) | `auditRun.create()` |

## Usage

```js
// Replace in scheduler.js (already done):
// OLD: const { runDailyAuditsForAllOrgs } = require('../services/deerflow');
// NEW: const { runDailyTeamAudits } = require('../services/seoTeam');

// On-demand for a single org:
const { runTeamAudit } = require('./services/seoTeam');
const result = await runTeamAudit(orgId);
```
