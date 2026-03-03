// ============================================
// SEO Agent API Server
// Fastify-based REST API supporting:
// - Single-tenant mode (for Plu internal use)
// - Multi-tenant SaaS mode (for external product)
// ============================================

require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const cron = require('node-cron');
const { FullPipeline } = require('./jobs/fullPipeline');
const { FirecrawlService } = require('./services/firecrawl');
const { ClaudeAnalysisService } = require('./services/claude');

const PORT = process.env.PORT || 4200;
const IS_MULTI_TENANT = process.env.MULTI_TENANT === 'true';

// ============================================
// MIDDLEWARE
// ============================================
fastify.register(cors, { origin: true });

// Health check
fastify.get('/health', async () => ({
  status: 'ok',
  mode: IS_MULTI_TENANT ? 'multi-tenant' : 'single-tenant',
  timestamp: new Date().toISOString()
}));

// ============================================
// SINGLE-TENANT ROUTES (For Plu)
// ============================================

// Run the full pipeline manually
fastify.post('/api/pipeline/run', async (request, reply) => {
  const { keywords, competitors } = request.body || {};
  
  const pipeline = new FullPipeline({
    orgDomain: 'getplu.com',
    orgContext: 'Plu is a fintech neobank helping immigrants build credit in 6 months.',
    keywords: keywords || getDefaultPluKeywords(),
    competitors: competitors || getDefaultPluCompetitors()
  });

  // Run async - return immediately with job ID
  const jobId = `job_${Date.now()}`;
  
  // Store result when done (in production, use Redis/DB)
  pipeline.run().then(result => {
    jobResults.set(jobId, result);
  });

  return { jobId, status: 'running', message: 'Pipeline started' };
});

// Quick keyword search
fastify.post('/api/keywords/search', async (request) => {
  const { keywords } = request.body;
  if (!keywords || !Array.isArray(keywords)) {
    return { error: 'keywords array required' };
  }

  const firecrawl = new FirecrawlService();
  const results = await firecrawl.batchSearchKeywords(
    keywords.map(k => typeof k === 'string' ? { keyword: k, segment: 'core' } : k),
    { concurrency: 3 }
  );

  return {
    results,
    creditsUsed: firecrawl.getCreditsUsed(),
    searchedAt: new Date().toISOString()
  };
});

// Crawl a specific competitor
fastify.post('/api/competitors/crawl', async (request) => {
  const { domain, blogPath = '/blog', limit = 20 } = request.body;
  if (!domain) return { error: 'domain required' };

  const firecrawl = new FirecrawlService();
  const result = await firecrawl.crawlCompetitor(domain, blogPath, { limit });

  return result;
});

// Generate a blog post
fastify.post('/api/blog/generate', async (request) => {
  const { title, targetKeyword, segment, outline, wordCountTarget } = request.body;
  if (!title || !targetKeyword) {
    return { error: 'title and targetKeyword required' };
  }

  const claude = new ClaudeAnalysisService();
  const result = await claude.generateBlogPost({
    title, targetKeyword, segment, outline, wordCountTarget,
    orgContext: 'Plu is a fintech neobank helping immigrants build credit in 6 months. Zero FX fees, virtual card qualification system.'
  });

  return result;
});

// Track rankings for keywords
fastify.post('/api/rankings/track', async (request) => {
  const { keywords, domain = 'getplu.com' } = request.body;
  if (!keywords) return { error: 'keywords array required' };

  const firecrawl = new FirecrawlService();
  const results = [];

  for (const kw of keywords) {
    const ranking = await firecrawl.trackRanking(kw, domain);
    results.push(ranking);
    await new Promise(r => setTimeout(r, 1000));
  }

  return { rankings: results, trackedAt: new Date().toISOString() };
});

// Map a domain's URLs
fastify.post('/api/domain/map', async (request) => {
  const { domain, search } = request.body;
  if (!domain) return { error: 'domain required' };

  const firecrawl = new FirecrawlService();
  return await firecrawl.mapDomain(domain, { search });
});

// Cluster keywords with AI
fastify.post('/api/keywords/cluster', async (request) => {
  const { keywords } = request.body;
  if (!keywords) return { error: 'keywords array required' };

  const claude = new ClaudeAnalysisService();
  return await claude.clusterKeywords(
    keywords.map(k => typeof k === 'string' ? { keyword: k, segment: 'core' } : k)
  );
});

// ============================================
// MULTI-TENANT SAAS ROUTES
// (Only active when MULTI_TENANT=true)
// ============================================
if (IS_MULTI_TENANT) {
  // Organization onboarding
  fastify.post('/api/orgs', async (request) => {
    const { name, domain, email } = request.body;
    // In production: create org in DB, setup Stripe customer
    return {
      id: `org_${Date.now()}`,
      name, domain,
      status: 'TRIAL',
      plan: 'STARTER',
      message: 'Organization created. 14-day trial started.'
    };
  });

  // Run pipeline for specific org
  fastify.post('/api/orgs/:orgId/pipeline/run', async (request) => {
    const { orgId } = request.params;
    // In production: fetch org config from DB
    return { jobId: `job_${Date.now()}`, orgId, status: 'queued' };
  });

  // Get org's keyword data
  fastify.get('/api/orgs/:orgId/keywords', async (request) => {
    const { orgId } = request.params;
    return { orgId, keywords: [], message: 'Fetch from DB in production' };
  });

  // Get org's reports
  fastify.get('/api/orgs/:orgId/reports', async (request) => {
    const { orgId } = request.params;
    return { orgId, reports: [], message: 'Fetch from DB in production' };
  });

  // Stripe webhook for billing
  fastify.post('/api/webhooks/stripe', async (request) => {
    // Handle subscription events
    return { received: true };
  });
}

// ============================================
// JOB RESULTS STORE (in-memory for dev)
// Replace with Redis/DB in production
// ============================================
const jobResults = new Map();

fastify.get('/api/pipeline/status/:jobId', async (request) => {
  const { jobId } = request.params;
  const result = jobResults.get(jobId);
  
  if (!result) {
    return { jobId, status: 'running', message: 'Pipeline is still executing' };
  }
  
  return { jobId, status: 'completed', result };
});

// ============================================
// SCHEDULED JOBS
// ============================================

// Weekly full pipeline - every Sunday at 10 PM
cron.schedule('0 22 * * 0', async () => {
  console.log('🔥 Running scheduled weekly SEO pipeline...');
  
  const pipeline = new FullPipeline({
    orgDomain: 'getplu.com',
    orgContext: 'Plu fintech neobank for immigrants.',
    keywords: getDefaultPluKeywords(),
    competitors: getDefaultPluCompetitors()
  });

  const result = await pipeline.run();
  
  // Send Slack notification
  if (process.env.SLACK_WEBHOOK_URL) {
    await sendSlackNotification(result);
  }
  
  console.log('✅ Weekly pipeline complete');
}, { timezone: 'America/New_York' });

// Daily rank tracking - every day at 6 AM
cron.schedule('0 6 * * *', async () => {
  console.log('📈 Running daily rank tracking...');
  
  const firecrawl = new FirecrawlService();
  const priorityKeywords = getDefaultPluKeywords()
    .filter(k => k.priority === 1)
    .map(k => k.keyword);

  for (const kw of priorityKeywords) {
    await firecrawl.trackRanking(kw, 'getplu.com');
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('✅ Daily ranking check complete');
}, { timezone: 'America/New_York' });

// ============================================
// HELPERS
// ============================================
function getDefaultPluKeywords() {
  return [
    { keyword: 'build credit as immigrant', segment: 'core', priority: 1 },
    { keyword: 'credit card for immigrants', segment: 'core', priority: 1 },
    { keyword: 'neobank for immigrants', segment: 'core', priority: 1 },
    { keyword: 'no credit history banking', segment: 'core', priority: 1 },
    { keyword: 'immigrant credit building', segment: 'core', priority: 1 },
    { keyword: 'credit card no SSN', segment: 'core', priority: 1 },
    { keyword: 'OFW remittance fees', segment: 'ofw', priority: 1 },
    { keyword: 'OFW banking abroad', segment: 'ofw', priority: 1 },
    { keyword: 'Filipino credit card abroad', segment: 'ofw', priority: 1 },
    { keyword: 'OFW savings account', segment: 'ofw', priority: 2 },
    { keyword: 'Nigerian diaspora banking', segment: 'nigerian', priority: 1 },
    { keyword: 'Japa banking guide', segment: 'nigerian', priority: 1 },
    { keyword: 'Nigerian immigrant credit UK', segment: 'nigerian', priority: 2 },
    { keyword: 'H1B visa credit card', segment: 'us_immigrant', priority: 1 },
    { keyword: 'ITIN credit card', segment: 'us_immigrant', priority: 1 },
    { keyword: 'build credit with ITIN', segment: 'us_immigrant', priority: 2 },
    { keyword: 'digital nomad credit card', segment: 'niche', priority: 2 },
    { keyword: 'zero forex fee card', segment: 'niche', priority: 2 },
    { keyword: 'international student banking', segment: 'niche', priority: 2 },
    { keyword: 'gamer banking international', segment: 'niche', priority: 2 }
  ];
}

function getDefaultPluCompetitors() {
  return [
    { name: 'Wise', domain: 'wise.com', blogPath: '/blog' },
    { name: 'Remitly', domain: 'remitly.com', blogPath: '/blog' },
    { name: 'Nova Credit', domain: 'novacredit.com', blogPath: '/resources' },
    { name: 'Chime', domain: 'chime.com', blogPath: '/blog' },
    { name: 'Mercury', domain: 'mercury.com', blogPath: '/blog' }
  ];
}

async function sendSlackNotification(result) {
  try {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🔥 *Weekly SEO Report*\n` +
          `📊 Keywords: ${result.summary?.keywordsScraped || 0}\n` +
          `📍 Ranking: ${result.summary?.currentRankings || 0}\n` +
          `🎯 Gaps: ${result.summary?.contentGapsFound || 0}\n` +
          `✍️ Blogs: ${result.summary?.blogsGenerated || 0}\n` +
          `💡 ${result.analysis?.headline || 'See full report'}`
      })
    });
  } catch (e) {
    console.error('Slack notification failed:', e.message);
  }
}

// ============================================
// START SERVER
// ============================================
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n🔥 SEO Agent Server running on port ${PORT}`);
    console.log(`   Mode: ${IS_MULTI_TENANT ? 'Multi-tenant SaaS' : 'Single-tenant (Plu)'}`);
    console.log(`   Endpoints:`);
    console.log(`   POST /api/pipeline/run        - Run full pipeline`);
    console.log(`   POST /api/keywords/search      - Search keywords`);
    console.log(`   POST /api/keywords/cluster      - AI keyword clustering`);
    console.log(`   POST /api/competitors/crawl     - Crawl competitor`);
    console.log(`   POST /api/blog/generate         - Generate blog post`);
    console.log(`   POST /api/rankings/track        - Track rankings`);
    console.log(`   POST /api/domain/map            - Map domain URLs`);
    console.log(`   GET  /api/pipeline/status/:id   - Check job status`);
    if (IS_MULTI_TENANT) {
      console.log(`   POST /api/orgs                  - Create organization`);
      console.log(`   POST /api/orgs/:id/pipeline/run - Run org pipeline`);
    }
    console.log('');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
