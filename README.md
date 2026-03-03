# 🔥 SEO Agent Service

AI-powered SEO keyword scraping, competitor analysis, content generation, and rank tracking — built with Firecrawl + Claude + Node.js.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 3. Set up database
npx prisma db push

# 4. Run the server
npm run dev

# 5. Or run the full pipeline directly
npm run full-pipeline
```

## Project Structure

```
seo-agent/
├── src/
│   ├── index.js                 # Fastify API server
│   ├── services/
│   │   ├── firecrawl.js         # Firecrawl scraping engine
│   │   └── claude.js            # Claude AI analysis engine
│   └── jobs/
│       └── fullPipeline.js      # Complete weekly pipeline
├── workflows/
│   └── weekly-keyword-scraper.json  # n8n workflow (import into n8n)
├── prisma/
│   └── schema.prisma            # Database schema (multi-tenant ready)
├── docs/
│   └── STARTUP-BLUEPRINT.md     # Full startup strategy document
├── .env.example                 # Environment variables template
├── Dockerfile                   # Railway deployment
└── package.json
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pipeline/run` | Run full weekly pipeline |
| GET | `/api/pipeline/status/:id` | Check pipeline job status |
| POST | `/api/keywords/search` | Search keywords via Firecrawl |
| POST | `/api/keywords/cluster` | AI-cluster keywords by intent |
| POST | `/api/competitors/crawl` | Crawl competitor blog |
| POST | `/api/blog/generate` | Generate SEO blog post |
| POST | `/api/rankings/track` | Track keyword rankings |
| POST | `/api/domain/map` | Map all URLs on a domain |

## n8n Workflow

Import `workflows/weekly-keyword-scraper.json` into your n8n instance. You'll need to:
1. Set up Firecrawl API credential (Header Auth)
2. Set up Anthropic API credential (Header Auth)
3. Connect Google Sheets and Slack nodes
4. Update the config in "Load Config & Keywords" node

## Deployment (Railway)

```bash
# Push to a new GitHub repo
git init && git add . && git commit -m "initial"
git remote add origin YOUR_REPO_URL
git push -u origin main

# In Railway:
# 1. New Project → Deploy from GitHub
# 2. Add PostgreSQL + Redis services
# 3. Set environment variables from .env.example
# 4. Deploy
```

## Two Modes

- **Single-tenant** (default): For Plu's internal SEO. Set `MULTI_TENANT=false`
- **Multi-tenant SaaS**: For external product. Set `MULTI_TENANT=true`

## Cost Estimate

Weekly pipeline run: ~410 Firecrawl credits + ~$5 Claude API = **under $25/week**
