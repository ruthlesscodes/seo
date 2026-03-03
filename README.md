 # SEO Agent API

> **API-first SEO intelligence platform.**
> Firecrawl gives you raw web data. We give you SEO intelligence.

## What This Is

A usage-based API that wraps Firecrawl (web scraping) + Claude (AI analysis) into ready-to-use SEO intelligence endpoints. One API call replaces hours of manual SEO work.

**3 product layers:**
1. **This API** — the intelligence engine (you are here)
2. **SaaS Dashboard** — customer-facing UI (next)
3. **n8n Workflows** — automation layer for Plu's internal SEO (next)

## Stack

- **Runtime:** Node.js 20+ / Fastify
- **Database:** PostgreSQL (Prisma ORM)
- **Cache/Queue:** Redis (ioredis + BullMQ)
- **Scraping:** Firecrawl v2 API
- **AI:** Anthropic Claude (claude-sonnet-4-20250514)
- **Billing:** Stripe
- **Deploy:** Railway

## Quick Start

```bash
# 1. Start local services
docker-compose up -d

# 2. Configure
cp .env.example .env
# Fill in: FIRECRAWL_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL, REDIS_URL

# 3. Install + setup DB
npm install
npx prisma generate
npx prisma db push

# 4. Run
npm run dev

# 5. Test
curl http://localhost:4200/health
curl http://localhost:4200/docs
```

## Endpoint Categories

| Category | Endpoints | Description |
|---|---|---|
| **Keywords** | search, cluster, suggest | SERP search, intent clustering, keyword ideas |
| **Rankings** | check, global, serp-features | Position tracking, multi-region, SERP features |
| **Competitors** | crawl, scrape, compare, brand | Competitive intelligence |
| **Content** | generate, brief, refresh, trending | AI content creation + optimization |
| **Monitor** | watch, check, changes, diff, pricing, decay | Change detection + alerts |
| **Audit** | technical, batch, internal-links, screenshot | Technical SEO auditing |
| **GEO/AEO** | brand-monitor, readability, llmstxt, optimize | AI search optimization |
| **Intelligence** | analyze, gaps, agent, research | Strategic analysis |
| **Domain** | map, sitemap, structure | Site structure tools |
| **Pipeline** | run, status | Full async orchestration |

## Plans

| Plan | Credits/mo | Price | Key Features |
|---|---|---|---|
| FREE | 100 | $0 | Search, track, map |
| STARTER | 2,000 | $49 | + Crawl, blog, audit, monitor |
| GROWTH | 10,000 | $149 | + Multi-region, GEO, batch, decay |
| SCALE | 50,000 | $499 | + Agent, brand monitor, actions |
| ENTERPRISE | ∞ | Custom | Everything |

## Key Files

- `CURSOR.md` — **Complete build instructions** (read this first)
- `docs/GAP-ANALYSIS.md` — Feature analysis vs Firecrawl capabilities
- `src/services/firecrawl.js` — All Firecrawl v2 endpoints wrapped
- `src/services/claude.js` — All AI analysis prompts
- `src/utils/constants.js` — Plan limits + credit costs
- `src/schemas/requests.js` — Zod validation schemas
- `src/schemas/firecrawl.js` — JSON extraction schemas for SEO

## Architecture

```
Client → API Key Auth → Rate Limiter → Route Handler → Usage Logger
                                            │
                                   ┌────────┴────────┐
                                   │                  │
                            Firecrawl v2          Claude AI
                            (6 endpoints)        (8 prompt types)
                                   │                  │
                                   └────────┬─────────┘
                                            │
                                      PostgreSQL
                                    (14 models via Prisma)
```
