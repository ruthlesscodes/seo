async function healthRoutes(fastify) {
  // /health is registered in index.js first (no auth, no DB) for healthcheck; do not duplicate here
  fastify.get('/docs', async () => ({
    name: 'SEO Agent API',
    version: '2.0.0',
    description: 'API-first SEO intelligence platform. Firecrawl gives raw web data. We give SEO intelligence.',
    auth: 'x-api-key header or Authorization: Bearer <key>',
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Create org + get API key',
        'GET  /api/auth/usage':    'Check credit usage'
      },
      keywords: {
        'POST /api/keywords/search':  '1 credit/keyword — SERP search with position tracking',
        'POST /api/keywords/cluster': '5 credits — AI intent clustering',
        'POST /api/keywords/suggest': '3 credits — Topic → keyword ideas'
      },
      competitors: {
        'POST /api/competitors/crawl':   '10 credits — Deep-crawl competitor site',
        'POST /api/competitors/scrape':  '1 credit — Scrape single URL',
        'POST /api/competitors/scrape-interactive': '3 credits — Scrape with actions (GROWTH+)',
        'POST /api/competitors/compare': '8 credits — Compare content for keyword',
        'POST /api/competitors/brand':   '3 credits — Extract brand identity (SCALE+)'
      },
      content: {
        'POST /api/content/generate': '15 credits — Generate SEO blog post',
        'POST /api/content/brief':    '5 credits — Generate content brief',
        'POST /api/content/refresh':  '10 credits — Analyze + recommend updates',
        'POST /api/content/trending': '2 credits — Find fresh content (GROWTH+)'
      },
      rankings: {
        'POST /api/rankings/check':         '1 credit/keyword — Check rankings now',
        'POST /api/rankings/global':        '3 credits/region — Multi-region check (GROWTH+)',
        'POST /api/rankings/serp-features': '3 credits/keyword — Track SERP features (GROWTH+)',
        'POST /api/rankings/serp-snapshot': '5 credits — SERP screenshot (GROWTH+)'
      },
      search: {
        'POST /api/search/news':     '2 credits — News source search (STARTER+)',
        'POST /api/search/github':   '2 credits — GitHub category search (GROWTH+)',
        'POST /api/search/research': '2 credits — Academic/research search (GROWTH+)'
      },
      brand: {
        'POST /api/brand/mentions': '5 credits — News mention tracking (GROWTH+)',
        'POST /api/brand/images':   '3 credits — Image search presence (GROWTH+)'
      },
      intelligence: {
        'POST /api/intelligence/analyze':  '20 credits — Full strategic brief',
        'POST /api/intelligence/gaps':     '1 credit/keyword — Content gap analysis',
        'POST /api/intelligence/agent':    '25 credits — AI agent research (SCALE+)',
        'POST /api/intelligence/research': '25 credits — Deep research via Spark models',
        'POST /api/intelligence/batch':    '20 credits/agent — Parallel agent research (GROWTH+)'
      },
      domain: {
        'POST /api/domain/map':       '2 credits — Discover all URLs',
        'POST /api/domain/sitemap':   '2 credits — Generate XML sitemap (GROWTH+)',
        'POST /api/domain/structure': '5 credits — Site hierarchy analysis (SCALE+)'
      },
      monitor: {
        'POST /api/monitor/watch':   '0 credits — Register URL to monitor',
        'POST /api/monitor/check':   '2 credits/URL — Run change detection',
        'GET  /api/monitor/changes': 'List detected changes',
        'POST /api/monitor/diff':    '2 credits — Get git-diff for URL',
        'POST /api/monitor/pricing': '6 credits — Track competitor pricing (GROWTH+)',
        'POST /api/monitor/decay':   '2 credits/keyword — Ranking decay alerts (GROWTH+)'
      },
      audit: {
        'POST /api/audit/technical':      '8 credits/page — Full technical SEO audit',
        'POST /api/audit/batch':          '5 credits/page — Batch audit (GROWTH+)',
        'POST /api/audit/internal-links': '15 credits — Internal link graph (GROWTH+)',
        'POST /api/audit/screenshot':     '2 credits — Page screenshot'
      },
      geo: {
        'POST /api/geo/brand-monitor': '30 credits — AI citation tracking (SCALE+)',
        'POST /api/geo/readability':   '10 credits/page — AI readability score (GROWTH+)',
        'POST /api/geo/llmstxt':       '15 credits — Generate llms.txt (GROWTH+)',
        'POST /api/geo/optimize':      '40 credits — Citation optimization (SCALE+)'
      },
      pipeline: {
        'POST /api/pipeline/run':      '50 credits — Full async pipeline',
        'GET  /api/pipeline/:jobId':   'Check pipeline status'
      },
      webhooks: {
        'POST /api/webhooks/configure': 'Set webhook URL + events'
      },
      billing: {
        'GET  /api/billing/plans':     'List available plans',
        'POST /api/billing/upgrade':   'Upgrade plan via Stripe',
        'POST /api/billing/webhook':   'Stripe webhook handler'
      }
    }
  }));
}

module.exports = healthRoutes;
