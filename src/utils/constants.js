// ============================================
// Plan Limits
// ============================================
const PLAN_LIMITS = {
  FREE: {
    creditsPerMonth: 100,
    requestsPerMinute: 5,
    maxKeywordsPerCall: 5,
    maxCompetitors: 2,
    maxMonitoredURLs: 3,
    regions: 1,
    features: ['search', 'track', 'map', 'sitemap', 'suggest']
  },
  STARTER: {
    creditsPerMonth: 2000,
    requestsPerMinute: 20,
    maxKeywordsPerCall: 25,
    maxCompetitors: 5,
    maxMonitoredURLs: 20,
    regions: 3,
    features: [
      'search', 'track', 'crawl', 'analyze', 'blog',
      'map', 'sitemap', 'screenshot', 'news',
      'audit.technical', 'monitor.check', 'monitor.diff',
      'suggest', 'scrape', 'compare', 'brief', 'cluster'
    ]
  },
  GROWTH: {
    creditsPerMonth: 10000,
    requestsPerMinute: 60,
    maxKeywordsPerCall: 100,
    maxCompetitors: 15,
    maxMonitoredURLs: 100,
    regions: 10,
    features: [
      'search', 'track', 'crawl', 'analyze', 'blog',
      'map', 'sitemap', 'screenshot', 'news',
      'audit.technical', 'monitor.check', 'monitor.diff',
      'suggest', 'scrape', 'compare', 'brief', 'cluster',
      'refresh', 'pipeline',
      'audit.batch', 'audit.internal-links',
      'monitor.pricing', 'monitor.decay',
      'rankings.global', 'rankings.serp-features',
      'trending', 'brand.mentions',
      'geo.readability', 'geo.llmstxt'
    ]
  },
  SCALE: {
    creditsPerMonth: 50000,
    requestsPerMinute: 200,
    maxKeywordsPerCall: 500,
    maxCompetitors: 50,
    maxMonitoredURLs: 500,
    regions: Infinity,
    features: [
      '*'  // Scale gets everything except enterprise-only
    ]
  },
  ENTERPRISE: {
    creditsPerMonth: Infinity,
    requestsPerMinute: 1000,
    maxKeywordsPerCall: Infinity,
    maxCompetitors: Infinity,
    maxMonitoredURLs: Infinity,
    regions: Infinity,
    features: ['*']
  }
};

// ============================================
// Credit Costs — per operation
// ============================================
const CREDIT_COSTS = {
  // Keywords
  'keyword.search':       1,   // per keyword
  'keyword.cluster':      5,
  'keyword.suggest':      3,

  // Competitors
  'competitor.crawl':    10,
  'competitor.scrape':    1,
  'competitor.compare':   8,
  'competitor.brand':     3,

  // Content
  'blog.generate':       15,
  'blog.refresh':        10,
  'content.brief':        5,
  'content.trending':     2,

  // Rankings
  'rank.check':           1,   // per keyword
  'rank.global':          3,   // per region
  'rank.serp-features':   3,   // per keyword

  // Intelligence
  'analyze.brief':       20,
  'intelligence.gaps':    1,   // per keyword
  'intelligence.agent':  25,
  'intelligence.batch':  20,   // per agent

  // Domain
  'domain.map':           2,
  'domain.sitemap':       2,
  'domain.structure':     5,

  // Monitoring
  'monitor.watch':        0,   // free to register
  'monitor.check':        2,   // per URL
  'monitor.diff':         2,
  'monitor.pricing':      6,
  'monitor.decay':        2,   // per keyword

  // Audit
  'audit.technical':      8,   // per page
  'audit.batch':          5,   // per page
  'audit.internal-links':15,
  'audit.screenshot':     2,

  // Search
  'search.news':          2,
  'search.github':        2,
  'search.research':      2,

  // GEO / AEO
  'geo.brand-monitor':   30,
  'geo.readability':     10,   // per page
  'geo.llmstxt':         15,
  'geo.optimize':        40,

  // Brand
  'brand.mentions':       5,
  'brand.images':         3,

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
