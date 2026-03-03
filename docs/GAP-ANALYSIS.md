# SEO Agent API — Full Gap Analysis

## What We Scanned

Comprehensive review of every Firecrawl endpoint, format, and parameter:

- `/v2/scrape` — all 12 output formats (markdown, html, rawHtml, links, screenshot, json, images, summary, changeTracking, attributes, branding, pdf)
- `/v2/search` — sources (web, news, images), categories (github, research), tbs time filters, location/country, scrapeOptions passthrough
- `/v2/crawl` — depth, maxDiscoveryDepth, includes/excludes, changeTracking, webhooks, deduplication
- `/v2/map` — sitemap parameter, search filter, includeSubdomains, location
- `/v2/batch/scrape` — parallel URL processing, maxConcurrency, webhooks
- `/v2/agent` — Spark 1 Mini/Pro models, schema-based extraction, maxCredits, parallel agents
- `/v2/llmstxt` (deprecated but still active) — llms.txt + llms-full.txt generation
- Actions system — wait, click, write, press, scroll, screenshot, scrape, executeJavascript, pdf
- Browser Sandbox — persistent CDP sessions for interactive multi-step workflows
- FireGEO open-source template — brand monitoring in AI responses
- SEO Teams use case page — technical audit, content gap, internal linking
- Change Tracking feature — git-diff mode, JSON structured diff, tags for separate histories

---

## PART 1: Firecrawl Features We Are NOT Using

### 1. Change Tracking (CRITICAL — competitive moat)

**What it does:** Automatically compares a page's current content to its previous version. Returns `changeStatus` (new / unchanged / changed / removed) and supports git-diff mode for line-by-line changes OR JSON mode for structured field changes.

**What we're missing:** Our API has zero change detection. We scrape and forget.

**Why it matters for the SaaS:** This is a killer feature. Customers want alerts when:
- A competitor changes their pricing page
- A ranking competitor updates their blog post (outranking you)
- Your own content gets modified unexpectedly
- A competitor launches a new landing page

**Implementation:**
```
POST /api/monitor/watch    — register URLs to monitor
POST /api/monitor/check    — run change detection now
GET  /api/monitor/changes  — get all detected changes
POST /api/monitor/diff     — get git-diff for a specific URL

// Uses Firecrawl: formats: ["markdown", {"type": "changeTracking", "modes": ["git-diff"]}]
```

**Credit cost:** Same as scrape (1 credit/page). Tags parameter lets us maintain separate tracking histories per customer.

---

### 2. JSON Structured Extraction (CRITICAL — technical SEO)

**What it does:** Pass a JSON schema to the scrape endpoint and Firecrawl uses AI to extract structured data matching that schema from ANY page. Works with prompt-only (no schema) or strict schema (Pydantic/Zod).

**What we're missing:** We only get markdown. We're not extracting structured SEO signals.

**Why it matters:** Technical SEO audits need structured extraction of:
- Meta title, description, robots, canonical, hreflang
- H1/H2/H3 hierarchy
- Schema.org/JSON-LD markup
- Open Graph tags
- Internal vs external link counts
- Image alt text presence/absence

**Implementation:**
```
POST /api/audit/page — scrape with SEO schema, return structured data
POST /api/audit/site — batch scrape all pages with SEO schema
POST /api/audit/schema-markup — extract and validate structured data

// Firecrawl: formats: [{type: "json", schema: SEOAuditSchema}]
// Cost: 5 credits per page (1 base + 4 for JSON mode)
```

---

### 3. Batch Scrape (EFFICIENCY)

**What it does:** `/v2/batch/scrape` accepts an array of URLs, processes them in parallel with configurable concurrency, supports webhooks for completion notification.

**What we're missing:** We scrape URLs sequentially in loops. Slow and wasteful.

**Why it matters:** When a customer says "audit all 200 pages on my site," we should batch them, not loop.

**Implementation:**
```
POST /api/audit/batch — submit array of URLs for parallel processing
// Uses Firecrawl: POST /v2/batch/scrape with maxConcurrency
// Webhook callback when complete
```

---

### 4. Search Sources: News + Images

**What it does:** The search endpoint accepts `sources: ["web", "news", "images"]`. News returns recent articles with dates. Images returns image results with dimensions.

**What we're missing:** We only search `web`. We're blind to news mentions and image rankings.

**Why it matters:**
- **News monitoring:** "Is anyone writing about us? About our competitors?" — PR/brand monitoring
- **Image search:** Image SEO is underserved. Track image rankings for product/brand keywords.

**Implementation:**
```
POST /api/brand/mentions — search sources: ["news"] for brand/competitor names
POST /api/brand/images  — search sources: ["images"] for visual brand presence
POST /api/search/news   — generic news search with time filters
```

---

### 5. Search Categories: GitHub + Research

**What it does:** Filter search results by category: `github` (repos, code, issues), `research` (academic papers from arXiv, PubMed, etc.).

**What we're missing:** No category filtering.

**Why it matters:** Niche but powerful for specific segments. A developer tools company wants to track GitHub mentions. A health brand wants to track research citations.

**Implementation:**
```
POST /api/search/github   — categories: ["github"]
POST /api/search/research — categories: ["research"]
```

---

### 6. Search Time Filters (tbs)

**What it does:** `tbs` parameter filters results by recency: `qdr:h` (hour), `qdr:d` (day), `qdr:w` (week), `qdr:m` (month), `qdr:y` (year). Also supports custom date ranges: `cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY`.

**What we're missing:** Our searches return all-time results. No freshness filtering.

**Why it matters:** "What content was published about [topic] in the last week?" is a core content strategy question. Trending content analysis requires time filtering.

**Implementation:**
```
POST /api/keywords/search — add tbs parameter passthrough
POST /api/content/trending — search with tbs: "qdr:w" to find fresh content
```

---

### 7. Location + Language Geo-Targeting

**What it does:** `location` (city, state, country) and `country` (ISO code) parameters on search, scrape, map, and crawl endpoints. Firecrawl uses appropriate proxies and emulates locale settings.

**What we're missing:** All our searches are US-default. No multi-region support.

**Why it matters:** "Where do I rank in the Philippines vs Nigeria vs UK?" — this is literally our Plu use case AND a premium SaaS feature. Multi-region rank tracking commands premium pricing.

**Implementation:**
```
POST /api/rankings/check — add location + country parameters
POST /api/rankings/global — check one keyword across multiple regions
// Premium: GROWTH plan and above
```

---

### 8. Screenshots

**What it does:** `formats: ["screenshot"]` returns a base64 PNG of the page. Options for fullPage, quality, viewport size.

**What we're missing:** No visual capture.

**Why it matters:**
- Visual proof of ranking position ("here's what the SERP looks like for your keyword")
- Before/after screenshots for content changes
- Competitor page snapshots for reporting
- Visual SEO audit evidence

**Implementation:**
```
POST /api/audit/screenshot — capture page screenshot
POST /api/rankings/serp-screenshot — screenshot the SERP for a keyword
```

---

### 9. Branding Format

**What it does:** `formats: ["branding"]` extracts comprehensive brand identity: color scheme, logo URL, primary/secondary/accent colors, typography (fonts, sizes), spacing system.

**What we're missing:** No brand intelligence extraction.

**Why it matters:** Competitor brand analysis. "What colors/fonts is [competitor] using?" Useful for design-oriented customers and agencies doing brand audits.

**Implementation:**
```
POST /api/competitors/brand — extract brand identity from competitor
// Lower priority — niche but differentiating
```

---

### 10. Agent / Spark Models (HIGH VALUE)

**What it does:** `/v2/agent` endpoint with natural language prompts. No URLs required — describe what you want, agent searches, navigates, and extracts. Spark 1 Mini (60% cheaper, default) and Spark 1 Pro (maximum accuracy). Supports parallel agents for batch research.

**What we're missing:** Our "research" endpoint calls the older deep-research API.

**Why it matters:** This is Firecrawl's most powerful feature. Use cases:
- "Find the top 10 fintech blogs writing about immigrant banking and get their domain authority signals"
- "Compare enterprise pricing across Wise, Remitly, Mercury, and Chime"
- "Find all YC W25 fintech companies and their founding teams"

**Implementation:**
```
POST /api/intelligence/research — already exists, upgrade to use /v2/agent
POST /api/intelligence/agent    — expose agent directly with prompt + optional schema
POST /api/intelligence/batch-research — parallel agents for multi-target research
```

---

### 11. Actions (Page Interaction)

**What it does:** Before scraping, interact with the page: click buttons, fill forms, scroll, wait for elements, execute JavaScript. Actions run sequentially.

**What we're missing:** No page interaction. Can't scrape content behind "load more" buttons, tabs, accordions, or login walls.

**Why it matters:** Many competitor pricing pages use tabs/accordions. Blog archives use "load more" pagination. Some SERP features require scrolling.

**Implementation:**
```
POST /api/competitors/scrape-interactive — scrape with actions
// Premium feature: SCALE plan and above
```

---

### 12. Summary Format

**What it does:** `formats: ["summary"]` returns an AI-generated summary of the page content.

**What we're missing:** We scrape full content and then separately call Claude to analyze it. Redundant.

**Why it matters:** Firecrawl's summary is included in the scrape response — no separate Claude call needed for quick overviews. Saves API costs.

**Implementation:** Add as option to existing scrape/crawl endpoints.

---

### 13. llms.txt Generation

**What it does:** Generate `llms.txt` and `llms-full.txt` files for any website. Maps the domain, scrapes pages, generates AI summaries, outputs structured text optimized for LLM consumption.

**What we're missing:** We have zero AEO/GEO tooling.

**Why it matters:** This is the entire GEO category. See Part 3 below.

**Implementation:**
```
POST /api/geo/generate-llmstxt — generate llms.txt for a domain
```

---

## PART 2: SEO/SERP Features We Haven't Built

### 14. Technical SEO Audit

**What the market expects:** Ahrefs/Screaming Frog provide page-by-page technical audits.

**What we should build:**
```
POST /api/audit/technical — Full technical SEO audit for a URL or domain

Returns per page:
- Missing/duplicate meta titles and descriptions
- Missing H1 or multiple H1s
- Broken links (status codes)
- Missing canonical tags
- Missing/incorrect hreflang tags
- Missing alt text on images
- Page speed indicators (word count, image count)
- Missing robots meta or noindex issues
- Redirect chains
- Mixed content (HTTP resources on HTTPS pages)
- Missing Open Graph tags
- Missing Schema.org structured data

Uses: Firecrawl crawl with JSON extraction + Claude analysis
Credits: 25 per audit (10-page crawl + analysis)
```

---

### 15. Internal Link Analysis

**What the market expects:** Visualize internal link structure. Find orphaned pages, identify link equity distribution.

**What we should build:**
```
POST /api/audit/internal-links — Map internal link graph

Returns:
- Pages with no incoming internal links (orphaned)
- Pages with most outgoing links (hub pages)
- Average internal links per page
- Link depth (clicks from homepage)
- Suggested internal linking opportunities
- Anchor text distribution

Uses: Firecrawl crawl with formats: ["links"] + Claude analysis
Credits: 15 per analysis
```

---

### 16. SERP Feature Tracking

**What the market expects:** Track whether you appear in featured snippets, People Also Ask, AI Overviews, knowledge panels, image packs, video results.

**What we should build:**
```
POST /api/rankings/serp-features — Track SERP features for keywords

Returns per keyword:
- Has featured snippet? Who owns it?
- Has AI Overview? Are you cited?
- Has People Also Ask? What questions?
- Has image pack? Video results?
- Has local pack?
- SERP volatility score

Uses: Firecrawl search with scrapeOptions for full SERP analysis
Credits: 3 per keyword (search + AI analysis)
```

---

### 17. Content Decay Detection

**What the market expects:** Automated alerts when content starts losing rankings.

**What we should build:**
```
POST /api/monitor/decay — Set up decay monitoring

Workflow:
1. Store baseline rankings for all tracked keywords
2. On each check, compare to baseline
3. If position drops ≥3 spots, flag for review
4. AI analysis of why (competitor content newer? Missing sections?)
5. Auto-generate refresh recommendations

Uses: Rank tracking + Change tracking + Claude analysis
Credits: 2 per keyword per check cycle
```

---

### 18. Sitemap Generation + Site Structure

**What the market expects:** Generate XML sitemaps. Visualize site hierarchy.

**What we should build:**
```
POST /api/domain/sitemap — Generate XML sitemap from map data
POST /api/domain/structure — Visualize site hierarchy

Uses: Firecrawl /map endpoint (1 credit per call regardless of URL count)
Extremely cheap operation — great free-tier feature
```

---

### 19. Competitor Pricing/Feature Monitor

**What the market expects:** Track when competitors change pricing, features, or messaging.

**What we should build:**
```
POST /api/monitor/pricing — Track competitor pricing pages
POST /api/monitor/features — Track competitor feature pages

Uses: Firecrawl change tracking with JSON schema extraction
Schema: { pricing_tiers: [], features: [], free_trial: bool, ... }
Credits: 6 per check (scrape + JSON extraction)

Alerts via webhook when changes detected
```

---

## PART 3: GEO/AEO — The Missing Category (HUGE Opportunity)

GEO (Generative Engine Optimization) and AEO (Answer Engine Optimization) are the same thing: optimizing content so AI platforms (ChatGPT, Claude, Perplexity, Google AI Overviews) cite your brand in their responses.

This is a **massive emerging market**. Firecrawl built an entire open-source SaaS starter (FireGEO) for this. AI search traffic grew 9.7x in the past year per Ahrefs. AI Overviews appear in 13%+ of Google searches. The GEO tooling market is wide open.

### 20. AI Brand Monitoring

```
POST /api/geo/brand-monitor — Check if AI platforms mention your brand

How it works:
1. Query ChatGPT, Claude, Perplexity, Google AI Overviews with
   brand-relevant questions
2. Check if your brand is cited in responses
3. Check if competitors are cited instead
4. Track citation frequency over time
5. Analyze sentiment of AI mentions

Example queries for Plu:
- "What's the best credit card for immigrants?"
- "How can I build credit as an OFW?"
- "Best neobank for Nigerian diaspora?"

Uses: Firecrawl agent to query AI platforms + Claude analysis
Credits: 30 per monitoring run (5 queries across platforms)
```

### 21. AI Readability Audit

```
POST /api/geo/readability — Score how well your content is structured for AI

Checks:
- Atomic pages (single clear intent per page)
- FAQ sections with explicit Q&A format
- Structured data (Schema.org) presence
- Content chunking quality
- Semantic clarity and entity associations
- Internal linking for topic authority signals
- Heading hierarchy quality
- Citation-worthy statistics and data points

Score: 0-100 AI Readability Score
Recommendations: Specific improvements per page

Uses: Firecrawl scrape + Claude analysis with custom scoring rubric
Credits: 10 per page audit
```

### 22. llms.txt Generator

```
POST /api/geo/llmstxt — Generate llms.txt for your site

How it works:
1. Map all URLs on the domain (Firecrawl /map)
2. Scrape key pages (Firecrawl batch scrape)
3. Generate AI summaries per page
4. Output llms.txt (summary index) + llms-full.txt (full content)

Output: Downloadable llms.txt files to host at yourdomain.com/llms.txt

Uses: Firecrawl map + batch scrape + Claude for summaries
Credits: 15 per generation (map + 10 page scrapes + summaries)
```

### 23. AI Citation Optimization

```
POST /api/geo/optimize — Get recommendations to increase AI citations

Analyzes:
- What questions trigger AI responses in your niche
- Which brands AI platforms currently cite
- What content format AI prefers (lists, tables, Q&A, statistics)
- What authority signals matter (backlinks, schema, freshness)
- Specific content changes to increase citation probability

Uses: Agent research + competitive analysis + Claude strategy
Credits: 40 per optimization report
```

---

## PART 4: Updated API Endpoint Map

### Current Endpoints (v2, already built)
```
Auth:
  POST /api/auth/register
  GET  /api/auth/usage

Keywords:
  POST /api/keywords/search          ← needs: tbs, location, country
  POST /api/keywords/cluster
  POST /api/keywords/suggest

Competitors:
  POST /api/competitors/crawl
  POST /api/competitors/scrape
  POST /api/competitors/compare

Content:
  POST /api/content/generate
  POST /api/content/brief
  POST /api/content/refresh

Rankings:
  POST /api/rankings/check           ← needs: location, country

Intelligence:
  POST /api/intelligence/analyze
  POST /api/intelligence/gaps
  POST /api/intelligence/research    ← upgrade to /v2/agent

Domain:
  POST /api/domain/map

Pipeline:
  POST /api/pipeline/run
  GET  /api/pipeline/:jobId

Webhooks:
  POST /api/webhooks/configure
```

### NEW Endpoints to Build (Priority Order)

```
HIGH PRIORITY — Immediate Revenue Impact:

  # Change Monitoring (killer feature)
  POST /api/monitor/watch           — register URLs to track
  POST /api/monitor/check           — run change detection
  GET  /api/monitor/changes         — list all detected changes
  POST /api/monitor/diff            — get git-diff for URL
  POST /api/monitor/pricing         — track competitor pricing

  # Technical SEO Audit
  POST /api/audit/technical         — full page/site audit
  POST /api/audit/batch             — batch audit via /v2/batch/scrape
  POST /api/audit/internal-links    — internal link graph analysis

  # Multi-Region Rankings
  POST /api/rankings/global         — check keyword across regions
  POST /api/rankings/serp-features  — track SERP features

  # Enhanced Search
  POST /api/search/news             — news source search
  POST /api/content/trending        — find fresh content (tbs: qdr:w)

MEDIUM PRIORITY — Differentiation:

  # GEO/AEO (emerging market)
  POST /api/geo/brand-monitor       — AI platform citation tracking
  POST /api/geo/readability         — AI readability score
  POST /api/geo/llmstxt             — generate llms.txt
  POST /api/geo/optimize            — AI citation recommendations

  # Enhanced Intelligence
  POST /api/intelligence/agent      — expose Firecrawl agent directly
  POST /api/intelligence/batch      — parallel agent research

  # Content Decay
  POST /api/monitor/decay           — automated ranking drop alerts

LOWER PRIORITY — Nice to Have:

  # Visual
  POST /api/audit/screenshot        — page screenshots
  POST /api/rankings/serp-snapshot  — SERP screenshots

  # Brand
  POST /api/competitors/brand       — brand identity extraction
  POST /api/brand/mentions          — news mention tracking
  POST /api/brand/images            — image search presence

  # Site Structure
  POST /api/domain/sitemap          — generate XML sitemap
  POST /api/domain/structure        — site hierarchy visualization

  # Advanced
  POST /api/competitors/scrape-interactive — scrape with actions
  POST /api/search/github           — GitHub category search
  POST /api/search/research         — academic category search
```

---

## PART 5: Updated Credit Costs

```javascript
const CREDIT_COSTS = {
  // Existing
  'keyword.search': 1,
  'keyword.search.batch': 1,    // per keyword
  'keyword.cluster': 5,
  'competitor.crawl': 10,
  'competitor.scrape': 1,
  'domain.map': 2,
  'rank.track': 1,
  'rank.track.batch': 1,        // per keyword
  'blog.generate': 15,
  'blog.refresh': 10,
  'analyze.brief': 20,
  'pipeline.full': 50,
  'agent.research': 25,

  // NEW — Monitoring
  'monitor.watch': 0,           // free to register
  'monitor.check': 2,           // per URL (scrape + changeTracking)
  'monitor.diff': 2,
  'monitor.pricing': 6,         // scrape + JSON extraction

  // NEW — Technical Audit
  'audit.technical': 8,         // per page (scrape JSON + analysis)
  'audit.batch': 5,             // per page in batch
  'audit.internal-links': 15,   // crawl + analysis
  'audit.screenshot': 2,

  // NEW — SERP
  'rankings.global': 3,         // per region checked
  'rankings.serp-features': 3,  // per keyword
  'rankings.serp-snapshot': 2,

  // NEW — Search
  'search.news': 2,
  'search.trending': 2,
  'search.github': 2,
  'search.research': 2,

  // NEW — GEO/AEO
  'geo.brand-monitor': 30,      // 5 AI platform queries + analysis
  'geo.readability': 10,        // per page
  'geo.llmstxt': 15,            // map + batch scrape + summaries
  'geo.optimize': 40,           // deep research + analysis

  // NEW — Intelligence
  'intelligence.agent': 25,
  'intelligence.batch': 20,     // per agent in batch

  // NEW — Brand
  'competitors.brand': 3,       // branding format scrape
  'brand.mentions': 5,          // news search + analysis
  'brand.images': 3,

  // NEW — Site Structure
  'domain.sitemap': 2,          // map + formatting
  'domain.structure': 5,

  // NEW — Content Decay
  'monitor.decay': 2,           // per keyword per check
};
```

---

## PART 6: Updated Plan Tiers

```javascript
const PLAN_LIMITS = {
  FREE: {
    price: 0,
    creditsPerMonth: 100,
    requestsPerMinute: 5,
    maxKeywordsPerCall: 5,
    maxCompetitors: 2,
    maxMonitoredURLs: 3,
    regions: 1,
    features: ['search', 'track', 'map', 'sitemap']
  },
  STARTER: {
    price: 49,
    creditsPerMonth: 2000,
    requestsPerMinute: 20,
    maxKeywordsPerCall: 25,
    maxCompetitors: 5,
    maxMonitoredURLs: 20,
    regions: 3,
    features: [
      'search', 'track', 'crawl', 'analyze', 'blog',
      'map', 'sitemap', 'screenshot', 'news',
      'audit.technical', 'monitor.check', 'monitor.diff'
    ]
  },
  GROWTH: {
    price: 149,
    creditsPerMonth: 10000,
    requestsPerMinute: 60,
    maxKeywordsPerCall: 100,
    maxCompetitors: 15,
    maxMonitoredURLs: 100,
    regions: 10,
    features: [
      // All STARTER features plus:
      'cluster', 'refresh', 'pipeline',
      'audit.batch', 'audit.internal-links',
      'monitor.pricing', 'monitor.decay',
      'rankings.global', 'rankings.serp-features',
      'trending', 'brand.mentions',
      'geo.readability', 'geo.llmstxt'
    ]
  },
  SCALE: {
    price: 499,
    creditsPerMonth: 50000,
    requestsPerMinute: 200,
    maxKeywordsPerCall: 500,
    maxCompetitors: 50,
    maxMonitoredURLs: 500,
    regions: 'unlimited',
    features: [
      // All GROWTH features plus:
      'agent', 'intelligence.agent', 'intelligence.batch',
      'webhooks', 'actions',
      'geo.brand-monitor', 'geo.optimize',
      'competitors.brand', 'brand.images',
      'domain.structure',
      'serp-snapshot'
    ]
  },
  ENTERPRISE: {
    price: 'custom',
    creditsPerMonth: Infinity,
    requestsPerMinute: 1000,
    maxKeywordsPerCall: Infinity,
    maxCompetitors: Infinity,
    maxMonitoredURLs: Infinity,
    regions: 'unlimited',
    features: ['*']
  }
};
```

---

## PART 7: Revenue Impact Analysis

### Current Product (v2)
- 19 endpoints
- Basic SEO: search, track, analyze, generate
- No monitoring, no audit, no GEO

### Complete Product (v3)
- 45+ endpoints
- Full SEO: search, track, analyze, generate, audit, monitor
- Full GEO/AEO: brand monitoring, readability, llms.txt, optimization
- Full competitive intelligence: change tracking, pricing, brand

### Pricing Power Comparison

| Feature Category | Competitors Charging | Our Position |
|---|---|---|
| Basic keyword tracking | Ahrefs: $99/mo, SEMrush: $130/mo | $49/mo (Starter) |
| Technical SEO audit | Screaming Frog: $239/yr, Sitebulb: $35/mo | Included in Growth ($149) |
| Content generation | SurferSEO: $89/mo, Clearscope: $170/mo | Included in Starter ($49) |
| Change monitoring | Visualping: $30/mo, ChangeTower: $89/mo | Included in Starter ($49) |
| Multi-region tracking | Ahrefs: $199/mo+, AccuRanker: $129/mo | Included in Growth ($149) |
| GEO/AEO monitoring | Otterly: $49/mo, Brand24: $99/mo | Included in Growth ($149) |
| AI agent research | Firecrawl direct: usage-based | Included in Scale ($499) |

**Key insight:** By bundling SEO + AEO + monitoring + content generation, we undercut the combined cost of 3-5 separate tools while providing a unified API. A Growth customer ($149/mo) replaces $500-800/mo in separate subscriptions.

### Revised Revenue Projections with GEO/AEO

| Year | Customers | ARPU | ARR | Valuation (15-20x) |
|---|---|---|---|---|
| Y1 | 500 | $140/mo | $840K | $12-17M |
| Y2 | 3,000 | $175/mo | $6.3M | $95-126M |
| Y3 | 15,000 | $210/mo | $37.8M | $567M-$756M |
| Y4 | 50,000 | $250/mo | $150M | **$2.25B-$3B** |

ARPU increases because GEO features command premium pricing and customers consolidate tools.

---

## PART 8: Implementation Priority (30-60-90 Day)

### Week 1-2: Quick Wins (parameter additions)
- Add `tbs`, `location`, `country` to existing `/api/keywords/search`
- Add `location`, `country` to existing `/api/rankings/check`
- Add `sources: ["news"]` option to create `/api/search/news`
- Upgrade `/api/intelligence/research` to use `/v2/agent` with Spark models

### Week 3-4: Change Monitoring
- Build `/api/monitor/watch`, `/check`, `/changes`, `/diff`
- Use Firecrawl changeTracking format
- Webhook delivery for change alerts

### Month 2: Technical SEO + GEO Foundation
- Build `/api/audit/technical` using JSON structured extraction
- Build `/api/audit/internal-links` using crawl + links format
- Build `/api/geo/readability` scoring system
- Build `/api/geo/llmstxt` generator
- Build `/api/rankings/global` multi-region tracking

### Month 3: Full GEO + Premium Features
- Build `/api/geo/brand-monitor` AI citation tracking
- Build `/api/geo/optimize` recommendation engine
- Build `/api/monitor/pricing` competitor pricing tracker
- Build `/api/rankings/serp-features` tracking
- Build `/api/intelligence/agent` direct agent exposure
- Build `/api/domain/sitemap` XML generation

---

## Summary of What We Missed

| # | Feature | Category | Priority | Revenue Impact |
|---|---|---|---|---|
| 1 | Change Tracking | Monitoring | CRITICAL | High — retention driver |
| 2 | JSON Structured Extraction | Technical SEO | CRITICAL | High — audit capability |
| 3 | Batch Scrape | Efficiency | HIGH | Medium — cost reduction |
| 4 | News Search Source | Brand/PR | HIGH | Medium — new use case |
| 5 | Image Search Source | Visual SEO | MEDIUM | Low — niche |
| 6 | GitHub/Research Categories | Niche Search | LOW | Low — niche |
| 7 | Time Filters (tbs) | Content Strategy | HIGH | Medium — freshness |
| 8 | Location/Language | Multi-Region | CRITICAL | High — premium pricing |
| 9 | Screenshots | Visual/Reports | MEDIUM | Medium — reporting |
| 10 | Branding Format | Competitive Intel | LOW | Low — niche |
| 11 | Agent/Spark Models | Deep Research | HIGH | High — premium feature |
| 12 | Actions (Page Interaction) | Advanced Scraping | MEDIUM | Medium — edge cases |
| 13 | Summary Format | Efficiency | LOW | Low — cost saving |
| 14 | llms.txt Generation | GEO/AEO | HIGH | High — emerging market |
| 15 | Technical SEO Audit | Core SEO | CRITICAL | High — table stakes |
| 16 | Internal Link Analysis | Core SEO | HIGH | Medium — differentiation |
| 17 | SERP Feature Tracking | Core SEO | HIGH | High — market demand |
| 18 | Content Decay Detection | Monitoring | HIGH | High — retention |
| 19 | Sitemap Generation | Site Tools | MEDIUM | Low — free tier hook |
| 20 | AI Brand Monitoring | GEO/AEO | HIGH | High — emerging market |
| 21 | AI Readability Audit | GEO/AEO | HIGH | High — unique offering |
| 22 | AI Citation Optimization | GEO/AEO | MEDIUM | High — premium |
| 23 | Competitor Pricing Monitor | Competitive Intel | HIGH | High — agency demand |

**Bottom line:** We built ~40% of what a competitive SEO intelligence API needs. The biggest gaps are monitoring (change tracking), technical auditing (structured extraction), multi-region support (geo-targeting), and the entire GEO/AEO category which is a blue ocean opportunity.
