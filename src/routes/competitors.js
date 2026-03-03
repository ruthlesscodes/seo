const { z } = require('zod');
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');

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

      const crawlUrl = body.domain.startsWith('http') ? body.domain : `https://${body.domain}`;
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
      request.log.error(err);
      if (err.status) {
        return reply.code(err.status).send({
          error: 'upstream_error',
          message: err.message,
          details: err.details
        });
      }
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });

  // POST /api/competitors/scrape
  // Body: { url: string, formats?: string[] }
  // Uses: firecrawl.scrape(url)
  fastify.post('/scrape', async (request, reply) => {
    try {
      const body = schemas.CompetitorScrapeBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'competitor.scrape');
      if (!allowed) return;

      const result = await firecrawl.scrape(body.url, { formats: body.formats });

      consumeCredits(request, 'competitor.scrape', cost);

      return {
        success: true,
        data: result.data || result,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      request.log.error(err);
      if (err.status) {
        return reply.code(err.status).send({
          error: 'upstream_error',
          message: err.message,
          details: err.details
        });
      }
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
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

      const domainLower = body.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const compLower = body.competitorDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

      let domainUrl = null;
      let compUrl = null;
      for (const r of webResults) {
        const u = (r.url || '').toLowerCase();
        if (!domainUrl && (u.includes(domainLower) || u.replace(/^https?:\/\//, '').startsWith(domainLower))) {
          domainUrl = r.url;
        }
        if (!compUrl && (u.includes(compLower) || u.replace(/^https?:\/\//, '').startsWith(compLower))) {
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
      request.log.error(err);
      if (err.status) {
        return reply.code(err.status).send({
          error: 'upstream_error',
          message: err.message,
          details: err.details
        });
      }
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });

  // POST /api/competitors/brand — SCALE+ only
  // Body: { url: string }
  // Uses: firecrawl.scrape(url, { formats: ["branding"] })
  fastify.post('/brand', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'competitors.brand')) return;

      const body = CompetitorBrandBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'competitor.brand');
      if (!allowed) return;

      const result = await firecrawl.scrape(body.url, { formats: ['branding'] });

      consumeCredits(request, 'competitor.brand', cost);

      return {
        success: true,
        data: result.data || result,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      request.log.error(err);
      if (err.status) {
        return reply.code(err.status).send({
          error: 'upstream_error',
          message: err.message,
          details: err.details
        });
      }
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });
}

module.exports = competitorRoutes;
