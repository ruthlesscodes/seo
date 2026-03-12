const { z } = require('zod');
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const { normalizeDomain } = require('../utils/domain');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');
const { validateUrlForScraping } = require('../utils/urlValidation');

const CompetitorBrandBody = z.object({ url: z.string().url() });

async function competitorRoutes(fastify) {

  // POST /api/competitors/crawl
  // Body: { domain: string, maxPages?: number, includePaths?: string[] }
  // Uses: firecrawl.crawl(domain) → async, store ScrapeRun, poll until done, upsert Competitor
  fastify.post('/crawl', async (request, reply) => {
    try {
      const body = schemas.CompetitorCrawlBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'competitor.crawl');
      if (!allowed) return;

      const { url: crawlUrl } = validateUrlForScraping(body.domain);
      const crawlRes = await firecrawl.crawl(crawlUrl, {
        limit: body.maxPages,
        formats: ['markdown', 'links'],
        includePaths: body.includePaths
      });

      const crawlId = crawlRes.id || crawlRes.data?.id;
      if (!crawlId) {
        return reply.code(502).send({
          error: 'upstream_error',
          message: 'Firecrawl crawl did not return job ID'
        });
      }

      const scrapeRun = await prisma.scrapeRun.create({
        data: {
          orgId: request.org.id,
          jobType: 'crawl',
          status: 'PENDING',
          config: { crawlId, domain: body.domain }
        }
      });

      let status = crawlRes;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        status = await firecrawl.getCrawlStatus(crawlId);
        const s = status.status || status.data?.status;
        if (s === 'completed') break;
        if (s === 'failed') {
          await prisma.scrapeRun.update({
            where: { id: scrapeRun.id },
            data: { status: 'FAILED', error: status.error || 'Crawl failed', completedAt: new Date() }
          });
          return reply.code(502).send({ error: 'crawl_failed', message: status.error || 'Crawl failed' });
        }
      }

      const completed = status.status === 'completed' || status.data?.status === 'completed';
      const pageCount = status.data?.total || status.total || 0;

      await prisma.scrapeRun.update({
        where: { id: scrapeRun.id },
        data: {
          status: completed ? 'COMPLETED' : 'FAILED',
          result: { crawlId, data: status.data },
          completedAt: new Date()
        }
      });

      if (completed) {
        await prisma.competitor.upsert({
          where: { orgId_domain: { orgId: request.org.id, domain: body.domain } },
          create: {
            orgId: request.org.id,
            domain: body.domain,
            lastCrawledAt: new Date(),
            pageCount
          },
          update: { lastCrawledAt: new Date(), pageCount }
        });
      }

      consumeCredits(request, 'competitor.crawl', cost);

      return {
        success: true,
        data: {
          crawlId,
          status: completed ? 'completed' : status.status || 'timeout',
          pageCount,
          jobId: scrapeRun.id
        },
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/competitors/scrape
  // Body: { url: string, formats?: string[] }
  // Uses: firecrawl.scrape(url)
  fastify.post('/scrape', async (request, reply) => {
    try {
      const body = schemas.CompetitorScrapeBody.parse(request.body);
      const { url } = validateUrlForScraping(body.url);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'competitor.scrape');
      if (!allowed) return;

      const result = await firecrawl.scrape(url, { formats: body.formats });

      consumeCredits(request, 'competitor.scrape', cost);

      return {
        success: true,
        data: result.data || result,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      if (err.message === 'url_not_allowed' || err.message === 'invalid_url' || err.message === 'url_required') {
        const e = new Error('URL not allowed or invalid.');
        e.status = 400;
        throw e;
      }
      throw err;
    }
  });

  // POST /api/competitors/compare
  // Body: { keyword: string, domain: string, competitorDomain: string }
  // Uses: firecrawl.search(keyword) → scrape ranking pages → claude.analyzeJSON(GAP_ANALYSIS)
  fastify.post('/compare', async (request, reply) => {
    try {
      const body = schemas.CompetitorCompareBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'competitor.compare');
      if (!allowed) return;

      const searchRes = await firecrawl.search(body.keyword, {
        limit: 10,
        scrapeOptions: { formats: ['markdown'] }
      });
      const webResults = searchRes.data?.web || searchRes.data?.results || [];

      const domainNorm = normalizeDomain(body.domain);
      const compNorm = normalizeDomain(body.competitorDomain);

      let domainUrl = null;
      let compUrl = null;
      for (const r of webResults) {
        const u = (r.url || '').toLowerCase();
        if (!domainUrl && (u.includes(domainNorm) || u.startsWith(domainNorm))) {
          domainUrl = r.url;
        }
        if (!compUrl && (u.includes(compNorm) || u.startsWith(compNorm))) {
          compUrl = r.url;
        }
        if (domainUrl && compUrl) break;
      }

      const contentParts = [];
      if (domainUrl) {
        const scrapeRes = await firecrawl.scrape(domainUrl, { formats: ['markdown'] });
        contentParts.push(`Client (${body.domain}):\n${scrapeRes.data?.markdown || JSON.stringify(scrapeRes)}`);
      }
      if (compUrl) {
        const scrapeRes = await firecrawl.scrape(compUrl, { formats: ['markdown'] });
        contentParts.push(`Competitor (${body.competitorDomain}):\n${scrapeRes.data?.markdown || JSON.stringify(scrapeRes)}`);
      }

      const analysis = await claude.analyzeJSON(
        claude.PROMPTS.GAP_ANALYSIS,
        JSON.stringify({
          keyword: body.keyword,
          domain: body.domain,
          competitorDomain: body.competitorDomain,
          searchResults: webResults.slice(0, 10),
          clientContent: domainUrl ? 'scraped' : 'not found',
          competitorContent: compUrl ? 'scraped' : 'not found',
          content: contentParts.join('\n\n---\n\n')
        })
      );

      consumeCredits(request, 'competitor.compare', cost);

      return {
        success: true,
        data: analysis,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/competitors/scrape-interactive — GROWTH+
  // Body: { url: string, actions?: [], waitFor?: string }
  // Uses: firecrawl.scrape with actions and waitFor for page interaction
  fastify.post('/scrape-interactive', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'actions')) return;

      const body = schemas.CompetitorScrapeInteractiveBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'competitor.scrape-interactive');
      if (!allowed) return;

      const opts = { formats: ['markdown'] };
      if (body.actions && body.actions.length > 0) {
        opts.actions = body.actions.map(a => {
          const action = { type: a.type };
          if (a.selector) action.selector = a.selector;
          if (a.text) action.text = a.text;
          return action;
        });
      }
      if (body.waitFor) opts.waitFor = body.waitFor;

      const result = await firecrawl.scrape(body.url, opts);

      consumeCredits(request, 'competitor.scrape-interactive', cost);

      return {
        success: true,
        data: result.data || result,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/competitors/brand — SCALE+ only
  // Body: { url: string }
  // Uses: firecrawl.scrape(url, { formats: ["branding"] })
  fastify.post('/brand', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'competitors.brand')) return;

      const body = CompetitorBrandBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'competitors.brand');
      if (!allowed) return;

      const result = await firecrawl.scrape(body.url, { formats: ['branding'] });

      consumeCredits(request, 'competitors.brand', cost);

      return {
        success: true,
        data: result.data || result,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });
}

module.exports = competitorRoutes;
