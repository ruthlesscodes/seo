// ============================================
// Plan Limits
// ============================================
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
    price: 48,
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
    price: 143,
    creditsPerMonth: 10000,
    requestsPerMinute: 60,
    maxKeywordsPerCall: 100,
    maxCompetitors: 15,
    maxMonitoredURLs: 100,
    regions: 10,
    features: [
      'cluster', 'refresh', 'pipeline',
      'audit.batch', 'audit.internal-links',
      'monitor.pricing', 'monitor.decay',
      'rankings.global', 'rankings.serp-features',
      'trending', 'brand.mentions',
      'geo.readability', 'geo.llmstxt'
    ]
  },
  SCALE: {
    price: 449,
    creditsPerMonth: 50000,
    requestsPerMinute: 200,
    maxKeywordsPerCall: 500,
    maxCompetitors: 50,
    maxMonitoredURLs: 500,
    regions: 'unlimited',
    features: [
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

// ============================================
// Credit Costs — per operation
// ============================================
const CREDIT_COSTS = {
  // Keywords
  'keyword.search':       1,
  'keyword.search.batch': 1,   // per keyword
  'keyword.cluster':      5,
  'keyword.suggest':      3,

  // Competitors
  'competitor.crawl':    10,
  'competitor.scrape':    1,
  'competitor.compare':   8,
  'competitor.scrape-interactive': 3,
  'competitors.brand':    3,   // branding format scrape

  // Content
  'blog.generate':       15,
  'blog.refresh':        10,
  'content.brief':        5,

  // Rankings
  'rank.track':           1,   // per keyword
  'rank.track.batch':     1,   // per keyword
  'rankings.global':      3,   // per region checked
  'rankings.serp-features': 3, // per keyword
  'rankings.serp-snapshot': 2,

  // Intelligence
  'analyze.brief':       20,
  'intelligence.gaps':    1,
  'agent.research':      25,
  'intelligence.agent':  25,   // alias
  'intelligence.batch':  20,   // per agent in batch

  // Domain
  'domain.map':           2,
  'domain.sitemap':       2,   // map + formatting
  'domain.structure':     5,

  // Monitoring
  'monitor.watch':        0,   // free to register
  'monitor.check':        2,   // per URL (scrape + changeTracking)
  'monitor.diff':         2,
  'monitor.pricing':      6,   // scrape + JSON extraction
  'monitor.decay':        2,   // per keyword per check

  // Audit
  'audit.technical':      8,   // per page (scrape JSON + analysis)
  'audit.batch':          5,   // per page in batch
  'audit.internal-links': 15,  // crawl + analysis
  'audit.screenshot':     2,

  // Search
  'search.news':          2,
  'search.trending':      2,
  'search.github':        2,
  'search.research':      2,

  // GEO / AEO
  'geo.brand-monitor':   30,   // 5 AI platform queries + analysis
  'geo.readability':     10,   // per page
  'geo.llmstxt':         15,   // map + batch scrape + summaries
  'geo.optimize':        40,   // deep research + analysis

  // Brand
  'brand.mentions':      5,    // news search + analysis
  'brand.images':        3,

  // Pipeline
  'pipeline.full':       50
};

// ============================================
// Public routes (skip auth)
// ============================================
const PUBLIC_PATHS = [
  '/health',
  '/docs',
  '/api/auth/register',
  '/api/auth/login',
  '/api/billing/webhook'
];

module.exports = { PLAN_LIMITS, CREDIT_COSTS, PUBLIC_PATHS };
