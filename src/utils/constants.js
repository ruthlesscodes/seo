/**
 * Constants — Plan Limits + Credit Costs
 *
 * Plan features are CUMULATIVE. Each plan inherits lower-tier features.
 * Added: audit.lighthouse, audit.agent, gsc.connect.
 */

const FREE_FEATURES = ['search', 'track', 'map', 'sitemap'];

const STARTER_FEATURES = [
  ...FREE_FEATURES,
  'crawl', 'analyze', 'blog',
  'screenshot', 'news',
  'audit.technical', 'audit.lighthouse',
  'monitor.check', 'monitor.diff',
];

const GROWTH_FEATURES = [
  ...STARTER_FEATURES,
  'cluster', 'refresh', 'pipeline',
  'audit.batch', 'audit.internal-links',
  'monitor.pricing', 'monitor.decay',
  'rankings.global', 'rankings.serp-features',
  'trending', 'brand.mentions',
  'geo.readability', 'geo.llmstxt',
];

const SCALE_FEATURES = [
  ...GROWTH_FEATURES,
  'agent', 'audit.agent',
  'intelligence.agent', 'intelligence.batch',
  'webhooks', 'actions',
  'geo.brand-monitor', 'geo.optimize',
  'competitors.brand', 'brand.images',
  'domain.structure',
  'serp-snapshot',
];

const PLAN_LIMITS = {
  FREE: {
    price: 0,
    creditsPerMonth: 100,
    requestsPerMinute: 5,
    maxKeywordsPerCall: 5,
    maxCompetitors: 2,
    maxMonitoredURLs: 3,
    regions: 1,
    features: FREE_FEATURES,
  },
  STARTER: {
    price: 48,
    creditsPerMonth: 2000,
    requestsPerMinute: 20,
    maxKeywordsPerCall: 25,
    maxCompetitors: 5,
    maxMonitoredURLs: 20,
    regions: 3,
    features: STARTER_FEATURES,
  },
  GROWTH: {
    price: 143,
    creditsPerMonth: 10000,
    requestsPerMinute: 60,
    maxKeywordsPerCall: 100,
    maxCompetitors: 15,
    maxMonitoredURLs: 100,
    regions: 10,
    features: GROWTH_FEATURES,
  },
  SCALE: {
    price: 449,
    creditsPerMonth: 50000,
    requestsPerMinute: 200,
    maxKeywordsPerCall: 500,
    maxCompetitors: 50,
    maxMonitoredURLs: 500,
    regions: 'unlimited',
    features: SCALE_FEATURES,
  },
  ENTERPRISE: {
    price: 'custom',
    creditsPerMonth: Infinity,
    requestsPerMinute: 1000,
    maxKeywordsPerCall: Infinity,
    maxCompetitors: Infinity,
    maxMonitoredURLs: Infinity,
    regions: 'unlimited',
    features: ['*'],
  },
};

const CREDIT_COSTS = {
  'keyword.search': 1,
  'keyword.search.batch': 1,
  'keyword.cluster': 5,
  'keyword.suggest': 3,
  'competitor.crawl': 10,
  'competitor.scrape': 1,
  'competitor.compare': 8,
  'competitor.scrape-interactive': 3,
  'competitors.brand': 3,
  'blog.generate': 15,
  'blog.refresh': 10,
  'content.brief': 5,
  'rank.track': 1,
  'rank.track.batch': 1,
  'rankings.global': 3,
  'rankings.serp-features': 3,
  'rankings.serp-snapshot': 2,
  'analyze.brief': 20,
  'intelligence.gaps': 1,
  'agent.research': 25,
  'intelligence.agent': 25,
  'intelligence.batch': 20,
  'domain.map': 2,
  'domain.sitemap': 2,
  'domain.structure': 5,
  'monitor.watch': 0,
  'monitor.check': 2,
  'monitor.diff': 2,
  'monitor.pricing': 6,
  'monitor.decay': 2,
  'audit.technical': 8,
  'audit.batch': 5,
  'audit.internal-links': 15,
  'audit.screenshot': 2,
  'audit.lighthouse': 3,
  'audit.agent': 50,
  'search.news': 2,
  'search.trending': 2,
  'search.github': 2,
  'search.research': 2,
  'geo.brand-monitor': 30,
  'geo.readability': 10,
  'geo.llmstxt': 15,
  'geo.optimize': 40,
  'brand.mentions': 5,
  'brand.images': 3,
  'pipeline.full': 50,
};

const PUBLIC_PATHS = [
  '/',
  '/health',
  '/docs',
  '/api/auth/register',
  '/api/auth/login',
  '/api/billing/webhook',
  '/api/auth/gsc/callback',
];

module.exports = { PLAN_LIMITS, CREDIT_COSTS, PUBLIC_PATHS };
