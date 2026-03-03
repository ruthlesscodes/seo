const { z } = require('zod');
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');
const fcSchemas = require('../schemas/firecrawl');

const AuditScreenshotBody = z.object({
  url: z.string().url(),
  fullPage: z.boolean().optional()
});

async function auditRoutes(fastify) {

  // POST /api/audit/technical
  // Body: { url?: string, domain?: string, maxPages?: number }
  // Uses: firecrawl.scrape (single) or map+batchScrape (domain) → claude(TECHNICAL_AUDIT)
  // Stores: AuditRun + AuditPage
  fastify.post('/technical', async (request, reply) => {
    try {
      const body = schemas.AuditTechnicalBody.parse(request.body);

      const domain = body.domain || (body.url ? new URL(body.url).hostname : null);
      const maxPages = body.maxPages || 10;

      let urls = [];
      if (body.url) {
        urls = [body.url];
      } else if (body.domain) {
        const mapUrl = body.domain.startsWith('http') ? body.domain : `https://${body.domain}`;
        const mapRes = await firecrawl.map(mapUrl, { limit: maxPages });
        urls = mapRes.data?.links || mapRes.links || mapRes.data?.urls || [];
      }

      const costPerPage = 8;
      const cost = urls.length * costPerPage;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'audit.technical', urls.length);
      if (!allowed) return;

      const auditRun = await prisma.auditRun.create({
        data: {
          orgId: request.org.id,
          domain: domain || 'unknown',
          status: 'RUNNING',
          totalPages: urls.length
        }
      });

      const pages = [];
      let issuesFound = 0;

      for (const url of urls.slice(0, Math.ceil(100 / costPerPage))) {
        try {
          const scrapeRes = await firecrawl.scrape(url, {
            formats: ['markdown', 'links'],
            jsonSchema: fcSchemas.SEO_AUDIT_SCHEMA
          });
          const extracted = scrapeRes.data?.json || scrapeRes.json || {};
          const analysis = await claude.analyzeJSON(
            claude.PROMPTS.TECHNICAL_AUDIT,
            JSON.stringify(extracted)
          );

          const summary = analysis.summary || {};
          issuesFound += (summary.critical || 0) + (summary.warnings || 0) + (summary.info || 0);

          await prisma.auditPage.create({
            data: {
              auditRunId: auditRun.id,
              url,
              metaTitle: extracted.meta_title,
              metaDescription: extracted.meta_description,
              h1: extracted.h1?.[0],
              h1Count: extracted.h1?.length,
              wordCount: extracted.word_count,
              internalLinks: extracted.internal_links,
              externalLinks: extracted.external_links,
              images: extracted.images_total,
              imagesNoAlt: extracted.images_missing_alt,
              hasSchemaOrg: extracted.has_schema_org,
              schemaTypes: extracted.schema_types,
              issues: analysis.issues
            }
          });

          pages.push({ url, score: analysis.score, issues: analysis.issues });
        } catch (e) {
          request.log.warn({ url, err: e }, 'Audit page failed');
        }
      }

      const avgScore = pages.length ? Math.round(pages.reduce((s, p) => s + (p.score || 0), 0) / pages.length) : 0;

      await prisma.auditRun.update({
        where: { id: auditRun.id },
        data: {
          status: 'COMPLETED',
          issuesFound,
          summary: { critical: 0, warnings: 0, info: 0 },
          completedAt: new Date()
        }
      });

      consumeCredits(request, 'audit.technical', creditCost);

      return {
        success: true,
        data: {
          auditRunId: auditRun.id,
          domain,
          score: avgScore,
          pages,
          issuesFound
        },
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
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

  // POST /api/audit/batch — GROWTH+
  // Body: { urls: string[] }
  fastify.post('/batch', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'audit.batch')) return;

      const body = schemas.AuditBatchBody.parse(request.body);

      const cost = body.urls.length * 5;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'audit.batch', body.urls.length);
      if (!allowed) return;

      const batchRes = await firecrawl.batchScrape(body.urls, {
        jsonSchema: fcSchemas.SEO_AUDIT_SCHEMA
      });

      const batchId = batchRes.id || batchRes.data?.id;

      consumeCredits(request, 'audit.batch', creditCost);

      return {
        success: true,
        data: { batchId, status: 'pending', urls: body.urls.length },
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
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

  // POST /api/audit/internal-links — GROWTH+
  // Body: { domain: string, maxPages?: number }
  fastify.post('/internal-links', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'audit.internal-links')) return;

      const body = schemas.AuditInternalLinksBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'audit.internal-links');
      if (!allowed) return;

      const crawlUrl = body.domain.startsWith('http') ? body.domain : `https://${body.domain}`;
      const crawlRes = await firecrawl.crawl(crawlUrl, {
        limit: body.maxPages,
        formats: ['links']
      });

      const crawlId = crawlRes.id || crawlRes.data?.id;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const status = await firecrawl.getCrawlStatus(crawlId);
        if (status.status === 'completed' || status.data?.status === 'completed') {
          const pages = status.data?.data || status.data?.completed || [];
          const linkGraph = {};
          const inLinks = {};
          for (const p of pages) {
            const pageUrl = p.url || p.metadata?.url;
            const links = p.links || p.data?.links || [];
            if (!linkGraph[pageUrl]) linkGraph[pageUrl] = [];
            for (const l of links) {
              const href = typeof l === 'string' ? l : (l.href || l.url);
              if (href && href.startsWith('http') && new URL(href).hostname === body.domain) {
                linkGraph[pageUrl].push(href);
                inLinks[href] = (inLinks[href] || 0) + 1;
              }
            }
          }
          const orphaned = Object.keys(linkGraph).filter(u => !inLinks[u] || inLinks[u] === 0);
          const hubPages = Object.entries(linkGraph)
            .map(([u, links]) => ({ url: u, outCount: links.length }))
            .sort((a, b) => b.outCount - a.outCount)
            .slice(0, 10);

          const analysis = await claude.analyzeJSON(
            'Analyze this internal link graph. Return JSON: { orphaned: number, hubPages: number, recommendations: string[], summary: string }',
            JSON.stringify({ linkGraph: Object.keys(linkGraph).length, orphaned: orphaned.length, hubPages })
          );

          consumeCredits(request, 'audit.internal-links', cost);

          return {
            success: true,
            data: {
              totalPages: pages.length,
              orphaned: orphaned.slice(0, 20),
              hubPages,
              analysis
            },
            meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
          };
        }
      }

      consumeCredits(request, 'audit.internal-links', cost);
      return reply.code(504).send({ error: 'timeout', message: 'Crawl did not complete in time' });
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

  // POST /api/audit/screenshot
  // Body: { url: string }
  fastify.post('/screenshot', async (request, reply) => {
    try {
      const body = AuditScreenshotBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'audit.screenshot');
      if (!allowed) return;

      const result = await firecrawl.scrape(body.url, { formats: ['screenshot'] });

      consumeCredits(request, 'audit.screenshot', cost);

      const screenshot = result.data?.screenshot || result.screenshot;

      return {
        success: true,
        data: { screenshot, base64: !!screenshot },
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

module.exports = auditRoutes;
