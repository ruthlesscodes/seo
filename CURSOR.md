# CURSOR.md — Build Instructions for SEO Agent API

> **Read this file completely before implementing anything.**
> Every route stub returns 501. Your job is to implement the handler bodies.
> The middleware, services, schemas, and database are already wired up.

---

## 1. Architecture Overview

```
Request → Auth Middleware → Rate Limit Middleware → Route Handler → Usage Middleware (logs credits)
                                                       ↓
                                          ┌────────────┴────────────┐
                                          │                         │
                                   Firecrawl Service          Claude Service
                                   (web data layer)          (AI analysis layer)
                                          │                         │
                                          └────────────┬────────────┘
                                                       ↓
                                                  PostgreSQL
                                                  (via Prisma)
```

### Key files you'll be editing:
- `src/routes/*.js` — implement handler bodies (all currently return 501)
- `src/services/firecrawl.js` — already complete, just call the functions
- `src/services/claude.js` — already complete, just call analyze/analyzeJSON with PROMPTS

### Key files you should NOT edit:
- `src/middleware/*` — auth, rate limit, usage tracking already work
- `src/utils/constants.js` — plan limits and credit costs are set
- `prisma/schema.prisma` — all models are defined

---

## 2. Pattern for EVERY Route Handler

Every route follows this exact pattern:

```javascript
fastify.post('/endpoint', async (request, reply) => {
  // 1. Validate input with Zod
  const body = SomeSchema.parse(request.body);

  // 2. Check feature gate
  if (!checkFeature(request, reply, 'feature.name')) return;

  // 3. Check credits BEFORE doing work
  const { allowed, cost } = await checkCredits(request, reply, 'operation.name', multiplier);
  if (!allowed) return;

  // 4. Do the work (Firecrawl + Claude)
  const firecrawlData = await firecrawl.search(body.keyword, { ... });
  const analysis = await claude.analyzeJSON(PROMPTS.SOMETHING, JSON.stringify(firecrawlData));

  // 5. Store results in DB (if applicable)
  await prisma.someModel.create({ data: { orgId: request.org.id, ... } });

  // 6. Record credit consumption
  consumeCredits(request, 'operation.name', cost);

  // 7. Return response with meta
  return {
    success: true,
    data: analysis,
    meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
  };
});
```

### Import block for every route file:
```javascript
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');
const fcSchemas = require('../schemas/firecrawl');
```

---

## 3. Firecrawl API Quick Reference

These functions are in `src/services/firecrawl.js` and ready to use:

| Function | Firecrawl Endpoint | What it does | Key params |
|---|---|---|---|
| `firecrawl.search(query, opts)` | POST /v2/search | Web search + optional scrape | sources, tbs, location, country, scrapeOptions |
| `firecrawl.scrape(url, opts)` | POST /v2/scrape | Single URL → markdown/json/screenshot/etc | formats, jsonSchema, changeTrackingModes, actions, location |
| `firecrawl.crawl(url, opts)` | POST /v2/crawl | Recursive site crawl (async) | limit, maxDepth, includePaths, formats, changeTracking |
| `firecrawl.getCrawlStatus(id)` | GET /v2/crawl/:id | Poll crawl job | — |
| `firecrawl.map(url, opts)` | POST /v2/map | Fast URL discovery (1 credit!) | search, sitemap, limit |
| `firecrawl.batchScrape(urls, opts)` | POST /v2/batch/scrape | Parallel URL scraping | formats, maxConcurrency, webhook, jsonSchema |
| `firecrawl.getBatchStatus(id)` | GET /v2/batch/scrape/:id | Poll batch job | — |
| `firecrawl.agent(prompt, opts)` | POST /v2/agent | AI autonomous research | urls, schema, model (spark-1-mini/pro), maxCredits |
| `firecrawl.getAgentStatus(id)` | GET /v2/agent/:id | Poll agent job | — |

### Firecrawl formats cheat sheet:
- `"markdown"` — clean content (default)
- `"html"` — raw HTML
- `"links"` — all links on page
- `"screenshot"` — PNG capture (base64)
- `"summary"` — AI-generated summary
- `"images"` — all image URLs
- `"branding"` — colors, fonts, logo, typography
- `{ type: "json", schema: {...} }` — structured extraction (+4 credits)
- `{ type: "json", prompt: "..." }` — prompt-guided extraction (+4 credits)
- `{ type: "changeTracking", modes: ["git-diff"] }` — content diff
- `{ type: "changeTracking", modes: ["json"], schema: {...} }` — structured diff

### Search sources:
- `sources: ["web"]` — standard web results (default)
- `sources: ["news"]` — news articles with dates
- `sources: ["images"]` — image results with dimensions
- `sources: ["web", "news"]` — both (limit applies per source)

### Search time filters (tbs):
- `tbs: "qdr:h"` — last hour
- `tbs: "qdr:d"` — last day
- `tbs: "qdr:w"` — last week
- `tbs: "qdr:m"` — last month
- `tbs: "qdr:y"` — last year

### Location/geo:
- `country: "PH"` — ISO code for proxy + locale
- `location: "Manila,Philippines"` — city-level targeting

---

## 4. Keyword Routes Implementation

### 4.1 POST /api/keywords/search

```
Input:  { keywords: ["ofw credit card", "build credit immigrant"], domain: "getplu.com", country: "PH" }
Output: [{ keyword, position, url, topResults: [{title, url, position}], opportunityScore }]
```

Implementation:
1. Validate with `KeywordSearchBody.parse(request.body)`
2. Check plan `maxKeywordsPerCall` limit
3. Check credits: `keyword.search` × number of keywords
4. For each keyword, call `firecrawl.search(keyword, { limit: 10, country, location, tbs })`
5. Find `domain` in results → that's the position. If not found, position = null
6. Calculate opportunityScore: keywords where position is null or >10 = high opportunity
7. Upsert `Keyword` record per keyword (orgId + keyword unique)
8. Upsert `RankSnapshot` per keyword
9. Return results array

### 4.2 POST /api/keywords/cluster

1. Validate with `KeywordClusterBody`
2. Check credits: `keyword.cluster` (flat 5)
3. Call `claude.analyzeJSON(PROMPTS.KEYWORD_CLUSTER, JSON.stringify({ keywords: body.keywords }))`
4. Update Keyword records with intent if they exist
5. Return clusters

### 4.3 POST /api/keywords/suggest

1. Validate with `KeywordSuggestBody`
2. Check credits: `keyword.suggest` (flat 3)
3. Call `firecrawl.search(body.topic, { limit: 10, scrapeOptions: { formats: ["markdown"] } })`
4. Pass search results to Claude: "Based on these top results for [topic], suggest [count] related keywords with difficulty and intent"
5. Return suggestions

---

## 5. Competitor Routes

### 5.1 POST /api/competitors/crawl

1. Validate with `CompetitorCrawlBody`
2. Check credits: `competitor.crawl` (10)
3. Call `firecrawl.crawl(body.domain, { limit: body.maxPages, formats: ["markdown", "links"] })`
4. Firecrawl crawl is async — returns a crawl ID
5. Store as `ScrapeRun` with jobType "crawl"
6. Poll `firecrawl.getCrawlStatus(crawlId)` until complete (or return job ID for async)
7. When done, upsert `Competitor` record
8. Return crawl results or job ID

### 5.2 POST /api/competitors/scrape

1. Validate, check credits: `competitor.scrape` (1)
2. Call `firecrawl.scrape(body.url, { formats: body.formats })`
3. Return scraped data

### 5.3 POST /api/competitors/compare

1. Validate, check credits: `competitor.compare` (8)
2. Call `firecrawl.search(body.keyword, { limit: 10, scrapeOptions: { formats: ["markdown"] } })`
3. Find both domains in results
4. Scrape the ranking pages for both
5. Pass to Claude `PROMPTS.GAP_ANALYSIS`
6. Return comparison

### 5.4 POST /api/competitors/brand (SCALE+)

1. Check feature: `checkFeature(request, reply, 'competitors.brand')`
2. Check credits: `competitor.brand` (3)
3. Call `firecrawl.scrape(body.url, { formats: ["branding"] })`
4. Return branding data (colors, fonts, logo, typography)

---

## 6. Content Routes

### 6.1 POST /api/content/generate

1. Validate with `ContentGenerateBody`
2. Check credits: `blog.generate` (15)
3. Research phase: `firecrawl.search(body.keyword, { limit: 5, scrapeOptions: { formats: ["markdown"] } })`
4. Generate: `claude.analyze(PROMPTS.CONTENT_GENERATE, "Keyword: [keyword]\nSegment: [segment]\nCompetitor content:\n[scraped content summaries]")`
5. Store as `BlogDraft` with status DRAFT
6. Return blog post + metadata

### 6.2 POST /api/content/brief

1. Check credits: `content.brief` (5)
2. Search top results for keyword, scrape top 3
3. `claude.analyzeJSON(PROMPTS.CONTENT_BRIEF, ...)`
4. Return structured brief

### 6.3 POST /api/content/refresh

1. Check credits: `blog.refresh` (10)
2. Scrape the existing URL: `firecrawl.scrape(body.url)`
3. Search current SERP: `firecrawl.search(body.keyword, { limit: 5 })`
4. `claude.analyzeJSON(PROMPTS.CONTENT_REFRESH, ...)` comparing existing vs SERP
5. Return recommendations

### 6.4 POST /api/content/trending (GROWTH+)

1. Check feature: `trending`
2. Check credits: `content.trending` (2)
3. Map timeRange to tbs: day→qdr:d, week→qdr:w, month→qdr:m
4. `firecrawl.search(body.topic, { sources: ["web", "news"], tbs, limit: 10 })`
5. Return results with dates and freshness indicators

---

## 7. Rankings Routes

### 7.1 POST /api/rankings/check

1. Validate with `RankCheckBody`
2. Check credits: `rank.check` × keywords.length
3. For each keyword: `firecrawl.search(keyword, { limit: 10, country: body.region })`
4. Find domain in results → position
5. Upsert `RankSnapshot` with region
6. Return positions

### 7.2 POST /api/rankings/global (GROWTH+)

1. Check feature: `rankings.global`
2. Check credits: `rank.global` × regions.length
3. For each region: `firecrawl.search(keyword, { limit: 10, country: region })`
4. Store `RankSnapshot` per region
5. Return: `{ keyword, positions: { US: 3, PH: 1, NG: 7, ... } }`

### 7.3 POST /api/rankings/serp-features (GROWTH+)

1. Check feature: `rankings.serp-features`
2. Check credits: `rank.serp-features` × keywords.length
3. `firecrawl.search(keyword, { limit: 1, scrapeOptions: { formats: ["markdown", "html"] } })`
4. Pass HTML to Claude: "Analyze this SERP HTML and identify: featured snippet, AI overview, PAA, image pack, video results, local pack, knowledge panel"
5. Store features in `RankSnapshot.serpFeatures` JSON field
6. Return features per keyword

---

## 8. Intelligence Routes

### 8.1 POST /api/intelligence/analyze

Full strategic brief. This is the premium endpoint.

1. Check credits: `analyze.brief` (20)
2. Search all keywords: `firecrawl.search()` per keyword
3. If competitors provided, crawl their blog: `firecrawl.map(competitor)`
4. Pass everything to `claude.analyzeJSON(PROMPTS.STRATEGIC_BRIEF, ...)`
5. Return strategic brief with content calendar

### 8.2 POST /api/intelligence/gaps

1. Check credits: `intelligence.gaps` × keywords.length
2. For each keyword, search and find both domain and competitorDomain
3. Pass to `claude.analyzeJSON(PROMPTS.GAP_ANALYSIS, ...)`
4. Return gaps with opportunity scores

### 8.3 POST /api/intelligence/agent (SCALE+)

Direct Firecrawl agent exposure.

1. Check feature + credits: `intelligence.agent` (25)
2. `firecrawl.agent(body.prompt, { urls: body.urls, schema: body.schema, model: body.model })`
3. Agent is async — returns job ID
4. Poll `firecrawl.getAgentStatus(id)` or return job ID
5. Return agent results

### 8.4 POST /api/intelligence/research

1. Check credits: `intelligence.agent` (25)
2. `firecrawl.agent(body.topic, { model: "spark-1-pro" })` for deeper research
3. Return synthesized research

---

## 9. Domain Routes

### 9.1 POST /api/domain/map

1. Check credits: `domain.map` (2)
2. `firecrawl.map(body.url, { search: body.search, limit: body.limit })`
3. Map costs only 1 Firecrawl credit regardless of URL count!
4. Return URL list

### 9.2 POST /api/domain/sitemap (GROWTH+)

1. Check feature + credits: `domain.sitemap` (2)
2. `firecrawl.map(body.url, { sitemap: "include", limit: 10000 })`
3. Format URLs as XML sitemap string
4. Return `{ xml: "<?xml version...>", urlCount: N }`

### 9.3 POST /api/domain/structure (SCALE+)

1. Check feature + credits: `domain.structure` (5)
2. `firecrawl.map(body.url)` to get all URLs
3. Parse URLs into hierarchy tree (split by path segments)
4. `claude.analyzeJSON()` to analyze structure quality
5. Return tree + analysis

---

## 10. Monitor Routes (CRITICAL — new feature)

### 10.1 POST /api/monitor/watch

1. Check plan `maxMonitoredURLs` limit
2. Credits: `monitor.watch` (0 — free to register)
3. Create `MonitoredUrl` record (upsert on orgId + url)
4. Return the monitored URL record

### 10.2 POST /api/monitor/check

This is the change detection engine. Uses Firecrawl's changeTracking format.

1. Check credits: `monitor.check` × number of URLs to check
2. If body.urls provided, check those. Otherwise, get all active MonitoredUrls for org
3. For each URL:
   ```javascript
   const result = await firecrawl.scrape(url, {
     formats: ['markdown'],
     changeTrackingModes: ['git-diff'],
     changeTrackingTag: `org_${request.org.id}`  // separate tracking per org
   });
   ```
4. Check `result.data.changeTracking.changeStatus`
5. If "changed" or "new", create `ChangeEvent` record with:
   - changeStatus from Firecrawl
   - diff from changeTracking.diff
6. Update `MonitoredUrl.lastCheckedAt` and `lastChangeAt` if changed
7. Return list of changes

### 10.3 GET /api/monitor/changes

1. Query `ChangeEvent` records for org
2. Filter by query params: since, url, changeType
3. Include MonitoredUrl relation for label
4. Return paginated list

### 10.4 POST /api/monitor/diff

1. Check credits: `monitor.diff` (2)
2. Call `firecrawl.scrape(body.url, { formats: ['markdown'], changeTrackingModes: ['git-diff'] })`
3. Return the diff directly

### 10.5 POST /api/monitor/pricing (GROWTH+)

1. Check feature + credits: `monitor.pricing` (6)
2. Call with both JSON extraction AND change tracking:
   ```javascript
   await firecrawl.scrape(url, {
     formats: ['markdown'],
     jsonSchema: body.schema || PRICING_MONITOR_SCHEMA,
     changeTrackingModes: ['json'],
     changeTrackingSchema: body.schema || PRICING_MONITOR_SCHEMA
   });
   ```
3. Returns structured pricing data + what changed since last scrape
4. Store as ChangeEvent with changeType "pricing"

### 10.6 POST /api/monitor/decay (GROWTH+)

1. Check feature + credits: `monitor.decay` × keywords.length
2. Get most recent `RankSnapshot` per keyword for this org
3. Get snapshot from 7 days ago (or earliest available)
4. Compare: if position dropped ≥3 spots, flag
5. Return: `{ decaying: [{ keyword, previousPosition, currentPosition, drop, url }] }`

---

## 11. Audit Routes (CRITICAL — new feature)

### 11.1 POST /api/audit/technical

Single page or full domain audit using Firecrawl JSON extraction.

For single URL:
1. Check credits: `audit.technical` (8)
2. Scrape with SEO schema:
   ```javascript
   const result = await firecrawl.scrape(body.url, {
     formats: ['markdown', 'links'],
     jsonSchema: SEO_AUDIT_SCHEMA
   });
   ```
3. Pass extracted JSON to `claude.analyzeJSON(PROMPTS.TECHNICAL_AUDIT, ...)`
4. Store `AuditRun` + `AuditPage`
5. Return audit results

For domain (multiple pages):
1. Map domain first: `firecrawl.map(body.domain, { limit: body.maxPages })`
2. Batch scrape: `firecrawl.batchScrape(urls, { jsonSchema: SEO_AUDIT_SCHEMA })`
3. Analyze each page + aggregate
4. Store all as `AuditRun` with multiple `AuditPage` records

### 11.2 POST /api/audit/batch (GROWTH+)

1. Check feature + credits: `audit.batch` × urls.length
2. `firecrawl.batchScrape(body.urls, { jsonSchema: SEO_AUDIT_SCHEMA })`
3. Batch scrape is async — returns batch ID
4. Poll or return job ID

### 11.3 POST /api/audit/internal-links (GROWTH+)

1. Check feature + credits: `audit.internal-links` (15)
2. `firecrawl.crawl(body.domain, { limit: body.maxPages, formats: ["links"] })`
3. Build link graph from crawl results
4. Find orphaned pages (no incoming internal links)
5. Find hub pages (most outgoing links)
6. Pass to Claude for analysis
7. Return graph summary + recommendations

### 11.4 POST /api/audit/screenshot

1. Check credits: `audit.screenshot` (2)
2. `firecrawl.scrape(body.url, { formats: ["screenshot"] })`
3. Return base64 PNG

---

## 12. GEO/AEO Routes (CRITICAL — new category)

### 12.1 POST /api/geo/brand-monitor (SCALE+)

1. Check feature + credits: `geo.brand-monitor` (30)
2. Generate queries if not provided: "best [product category]", "top [brand type] for [audience]"
3. Use Firecrawl agent to check AI platforms:
   ```javascript
   await firecrawl.agent(
     `Search for "${query}" on Perplexity, Google AI Overviews, and ChatGPT. Check if "${brand}" is mentioned in the response. Also note which competitor brands are cited.`,
     { model: 'spark-1-mini', maxCredits: 50 }
   );
   ```
4. Pass results to Claude for citation analysis
5. Store as `GeoReport(BRAND_MONITOR)`
6. Return citation report

### 12.2 POST /api/geo/readability (GROWTH+)

1. Check feature + credits: `geo.readability` × pages
2. Scrape the URL(s)
3. Pass content to `claude.analyzeJSON(PROMPTS.GEO_READABILITY, ...)`
4. Score breakdown: atomic clarity, FAQ structure, schema markup, semantic clarity, etc.
5. Store as `GeoReport(READABILITY)`
6. Return score + recommendations

### 12.3 POST /api/geo/llmstxt (GROWTH+)

1. Check feature + credits: `geo.llmstxt` (15)
2. Map domain: `firecrawl.map(body.domain, { limit: body.maxUrls })`
3. Batch scrape key pages: `firecrawl.batchScrape(topUrls, { formats: ["markdown", "summary"] })`
4. Format as llms.txt:
   ```
   # [domain] llms.txt

   > [site description]

   ## Pages

   - [Page Title](url): [summary]
   - [Page Title](url): [summary]
   ...
   ```
5. Also generate llms-full.txt with full markdown content
6. Store as `GeoReport(LLMSTXT)` with both files in data JSON
7. Return both files

### 12.4 POST /api/geo/optimize (SCALE+)

1. Check feature + credits: `geo.optimize` (40)
2. Scrape domain's key pages
3. Agent research: what do AI platforms cite for these keywords?
4. Pass to `claude.analyzeJSON(PROMPTS.GEO_CITATION, ...)`
5. Store as `GeoReport(CITATION_OPTIMIZATION)`
6. Return strategy

---

## 13. Pipeline Routes

### 13.1 POST /api/pipeline/run

Full async pipeline orchestration via BullMQ.

1. Check credits: `pipeline.full` (50)
2. Create `ScrapeRun` record with status PENDING
3. Add BullMQ job with config: `{ domain, keywords, competitors, region, orgId }`
4. Return job ID immediately

The BullMQ worker (create in `src/jobs/pipelineWorker.js`) should:
1. Update ScrapeRun status to RUNNING
2. Step 1: `firecrawl.search()` for each keyword → store RankSnapshots
3. Step 2: `firecrawl.crawl()` competitors → store CompetitorInsights
4. Step 3: `claude.analyzeJSON(STRATEGIC_BRIEF)` → store analysis
5. Step 4: `claude.analyze(CONTENT_GENERATE)` for top opportunity → store BlogDraft
6. Update ScrapeRun status to COMPLETED with result
7. Deliver webhook if configured

### 13.2 GET /api/pipeline/:jobId

1. Lookup `ScrapeRun` by ID
2. Return status + result if completed

---

## 14. Webhook Routes

### 14.1 POST /api/webhooks/configure

1. Validate body: { url, events, secret }
2. Valid events: "pipeline.completed", "monitor.changed", "ranking.dropped", "audit.completed"
3. Upsert `WebhookConfig` (orgId + url unique)
4. Return config

### Webhook delivery utility (create `src/utils/webhookDelivery.js`):
```javascript
async function deliverWebhook(orgId, event, payload) {
  const configs = await prisma.webhookConfig.findMany({
    where: { orgId, isActive: true }
  });
  for (const config of configs) {
    const events = config.events; // JSON array
    if (!events.includes(event)) continue;
    // POST to config.url with payload, HMAC signature in x-webhook-signature header
    // Store WebhookDelivery record
    // Retry up to 3 times with exponential backoff
  }
}
```

---

## 15. Billing Routes

### 15.1 POST /api/billing/upgrade

1. Get Stripe price ID for requested plan
2. Create Stripe Checkout session
3. Return checkout URL

### 15.2 POST /api/billing/webhook (PUBLIC)

1. Verify Stripe webhook signature
2. Handle events:
   - `checkout.session.completed` → update org plan + stripeCustomerId
   - `customer.subscription.updated` → update org plan
   - `customer.subscription.deleted` → downgrade to FREE
3. Invalidate Redis auth cache for affected org

---

## 16. Error Handling

Wrap all route handlers in try/catch. Return consistent error format:

```javascript
try {
  // ... handler logic
} catch (err) {
  request.log.error(err);

  if (err.status) {
    // Firecrawl error
    return reply.code(err.status).send({
      error: 'upstream_error',
      message: err.message,
      details: err.details
    });
  }

  return reply.code(500).send({
    error: 'internal_error',
    message: 'Something went wrong. Please try again.'
  });
}
```

---

## 17. Testing Strategy

Create tests in `tests/` directory:

1. `tests/auth.test.js` — register, get usage
2. `tests/keywords.test.js` — search, cluster, suggest
3. `tests/credits.test.js` — credit deduction, limit enforcement
4. `tests/monitor.test.js` — watch, check, changes

Use `jest` with the API running locally against Docker Compose postgres + redis.

---

## 18. Implementation Priority

Build in this order (each builds on the previous):

1. **Auth** — register + usage (already mostly done)
2. **Keywords** — search, cluster, suggest (core value)
3. **Rankings** — check, global (builds on keyword search)
4. **Competitors** — scrape, crawl, compare
5. **Content** — generate, brief, refresh
6. **Domain** — map, sitemap
7. **Monitor** — watch, check, changes, diff (new feature, high value)
8. **Audit** — technical, batch, internal-links (new feature, high value)
9. **Intelligence** — analyze, gaps, agent, research
10. **GEO** — readability, llmstxt, brand-monitor, optimize (new category)
11. **Pipeline** — run, status (orchestration)
12. **Webhooks** — configure + delivery
13. **Billing** — Stripe integration

---

## 19. Deployment Checklist

1. `docker-compose up -d` — start postgres + redis locally
2. `cp .env.example .env` — fill in API keys
3. `npm install`
4. `npx prisma generate && npx prisma db push`
5. `npm run dev` — start with nodemon
6. Test: `curl http://localhost:4200/health`
7. Register: `curl -X POST http://localhost:4200/api/auth/register -H "Content-Type: application/json" -d '{"name":"Test","domain":"test.com","email":"test@test.com"}'`
8. Use the returned API key in `x-api-key` header for all subsequent requests

### Railway deployment:
1. Push to GitHub
2. Connect repo in Railway
3. Add PostgreSQL + Redis services
4. Set environment variables
5. Deploy — railway.json handles the start command
