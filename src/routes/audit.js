/**
 * Audit Routes — bug fixes + Lighthouse + DeerFlow agent audit endpoint
 */

const { z } = require('zod');
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const { deliverWebhook } = require('../utils/webhookDelivery');
const schemas = require('../schemas/requests');
const fcSchemas = require('../schemas/firecrawl');
const { validateUrlForScraping } = require('../utils/urlValidation');

const AuditScreenshotBody = z.object({
  url: z.string().url(),
  fullPage: z.boolean().optional(),
});

const AuditLighthouseBody = z.object({
  url: z.string().url(),
  mobile: z.boolean().optional().default(true),
});

const AuditAgentBody = z.object({
  domain: z.string().min(3),
});

async function auditRoutes(fastify) {

  // GET /api/audit/runs/:id — fetch audit run with pages and flattened issues
  fastify.get('/runs/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const auditRun = await prisma.auditRun.findFirst({
        where: { id, orgId: request.org.id },
        include: { auditPages: true },
      });
      if (!auditRun) {
        return reply.code(404).send({ error: 'not_found', message: 'Audit run not found' });
      }
      const pages = auditRun.auditPages.map((p) => ({
        url: p.url,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        h1: p.h1,
        wordCount: p.wordCount,
        issues: Array.isArray(p.issues) ? p.issues : [],
      }));
      const issues = pages.flatMap((p) =>
        (Array.isArray(p.issues) ? p.issues : []).map((i) => ({ ...i, pageUrl: p.url }))
      );
      return {
        success: true,
        data: {
          id: auditRun.id,
          domain: auditRun.domain,
          status: auditRun.status,
          totalPages: auditRun.totalPages,
          issuesFound: auditRun.issuesFound,
          summary: auditRun.summary || { critical: 0, warnings: 0, info: 0 },
          startedAt: auditRun.startedAt,
          completedAt: auditRun.completedAt,
          pages,
          issues,
        },
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/audit/technical
  fastify.post('/technical', async (request, reply) => {
    try {
      const body = schemas.AuditTechnicalBody.parse(request.body);
      let mapUrl;
      if (body.url) {
        ({ url: mapUrl } = validateUrlForScraping(body.url));
      } else if (body.domain) {
        ({ url: mapUrl } = validateUrlForScraping(body.domain));
      } else {
        return reply.code(400).send({ error: 'validation_error', message: 'url or domain required' });
      }
      const domain = new URL(mapUrl).hostname;
      const maxPages = body.maxPages || 10;

      let urls = [];
      if (body.url) {
        urls = [mapUrl];
      } else {
        const mapRes = await firecrawl.map(mapUrl, { limit: maxPages });
        urls = mapRes.data?.links || mapRes.links || mapRes.data?.urls || [];
      }

      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'audit.technical', urls.length);
      if (!allowed) return;

      const auditRun = await prisma.auditRun.create({
        data: {
          orgId: request.org.id,
          domain: domain || 'unknown',
          status: 'RUNNING',
          totalPages: urls.length,
        },
      });

      const urlsToAudit = urls.slice(0, Math.ceil(100 / 8));
      const settled = await Promise.allSettled(
        urlsToAudit.map(async (url) => {
          const scrapeRes = await firecrawl.scrape(url, {
            formats: ['markdown', 'links'],
            jsonSchema: fcSchemas.SEO_AUDIT_SCHEMA,
          });
          const extracted = scrapeRes.data?.json || scrapeRes.json || {};
          const analysis = await claude.analyzeJSON(claude.PROMPTS.TECHNICAL_AUDIT, JSON.stringify(extracted));
          return { url, extracted, analysis };
        })
      );

      const pages = [];
      const summaryCounts = { critical: 0, warnings: 0, info: 0 };
      const createPromises = [];
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        const url = urlsToAudit[i];
        if (s.status === 'rejected') {
          request.log.warn({ url, err: s.reason }, 'Audit page failed');
          continue;
        }
        const { extracted, analysis } = s.value;
        const summary = analysis.summary || {};
        summaryCounts.critical += summary.critical || 0;
        summaryCounts.warnings += summary.warnings || 0;
        summaryCounts.info += summary.info || 0;

        createPromises.push(
          prisma.auditPage.create({
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
              issues: analysis.issues,
            },
          })
        );
        pages.push({ url, score: analysis.score, issues: analysis.issues, summary: analysis.summary });
      }
      await Promise.all(createPromises);

      const avgScore = pages.length ? Math.round(pages.reduce((s, p) => s + (p.score || 0), 0) / pages.length) : 0;
      const issuesFound = summaryCounts.critical + summaryCounts.warnings + summaryCounts.info;

      await prisma.auditRun.update({
        where: { id: auditRun.id },
        data: {
          status: 'COMPLETED',
          issuesFound,
          summary: summaryCounts,
          completedAt: new Date(),
        },
      });

      consumeCredits(request, 'audit.technical', creditCost);

      deliverWebhook(request.org.id, 'audit.completed', {
        auditRunId: auditRun.id,
        domain,
        score: avgScore,
        issuesFound,
        summary: summaryCounts,
      }).catch((e) => request.log.warn({ err: e }, 'Webhook delivery failed'));

      return {
        success: true,
        data: {
          auditRunId: auditRun.id,
          domain,
          score: avgScore,
          pages,
          issuesFound,
          summary: summaryCounts,
        },
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan },
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

  // POST /api/audit/batch
  fastify.post('/batch', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'audit.batch')) return;
      const body = schemas.AuditBatchBody.parse(request.body);
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'audit.batch', body.urls.length);
      if (!allowed) return;

      const batchRes = await firecrawl.batchScrape(body.urls, { jsonSchema: fcSchemas.SEO_AUDIT_SCHEMA });
      const batchId = batchRes.id || batchRes.data?.id;

      consumeCredits(request, 'audit.batch', creditCost);

      return {
        success: true,
        data: { batchId, status: 'pending', urls: body.urls.length },
        meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan },
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/audit/internal-links — no credits on 504
  fastify.post('/internal-links', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'audit.internal-links')) return;
      const body = schemas.AuditInternalLinksBody.parse(request.body);
      const { allowed, remaining, cost } = await checkCredits(request, reply, 'audit.internal-links');
      if (!allowed) return;

      const crawlUrl = body.domain.startsWith('http') ? body.domain : `https://${body.domain}`;
      const crawlRes = await firecrawl.crawl(crawlUrl, { limit: body.maxPages, formats: ['links'] });
      const crawlId = crawlRes.id || crawlRes.data?.id;

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000));
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

          const orphaned = Object.keys(linkGraph).filter((u) => !inLinks[u] || inLinks[u] === 0);
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
            data: { totalPages: pages.length, orphaned: orphaned.slice(0, 20), hubPages, analysis },
            meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan },
          };
        }
      }

      return reply.code(504).send({ error: 'timeout', message: 'Crawl did not complete in time. You were not charged.' });
    } catch (err) {
      throw err;
    }
  });

  // POST /api/audit/screenshot
  fastify.post('/screenshot', async (request, reply) => {
    try {
      const body = AuditScreenshotBody.parse(request.body);
      const { url } = validateUrlForScraping(body.url);
      const { allowed, remaining, cost } = await checkCredits(request, reply, 'audit.screenshot');
      if (!allowed) return;

      const result = await firecrawl.scrape(url, { formats: ['screenshot'] });
      consumeCredits(request, 'audit.screenshot', cost);
      const screenshot = result.data?.screenshot || result.screenshot;

      return {
        success: true,
        data: { screenshot, base64: !!screenshot },
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan },
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

  // POST /api/audit/lighthouse — PageSpeed Insights CWV
  fastify.post('/lighthouse', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'audit.lighthouse')) return;

      const body = AuditLighthouseBody.parse(request.body);
      const { allowed, remaining, cost } = await checkCredits(request, reply, 'audit.lighthouse');
      if (!allowed) return;

      const { runLighthouseAudit } = require('../services/lighthouse');
      const result = await runLighthouseAudit(body.url, { mobile: body.mobile });

      if (!result.success) {
        return reply.code(502).send({ error: 'lighthouse_failed', message: result.error });
      }

      consumeCredits(request, 'audit.lighthouse', cost);

      await prisma.lighthouseReport?.create?.({
        data: {
          orgId: request.org.id,
          url: body.url,
          performanceScore: result.scores.performance,
          seoScore: result.scores.seo,
          accessibilityScore: result.scores.accessibility,
          bestPracticesScore: result.scores.bestPractices,
          lcpMs: result.cwv.lcp ? Math.round(result.cwv.lcp) : null,
          clsScore: result.cwv.cls,
          fcpMs: result.cwv.fcp ? Math.round(result.cwv.fcp) : null,
          ttfbMs: result.cwv.ttfb ? Math.round(result.cwv.ttfb) : null,
          rawData: result,
        },
      }).catch(() => {});

      return {
        success: true,
        data: result,
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan },
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/audit/agent — DeerFlow multi-agent audit (SCALE+)
  fastify.post('/agent', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'audit.agent')) return;

      const body = AuditAgentBody.parse(request.body);
      const { allowed, remaining, cost } = await checkCredits(request, reply, 'audit.agent');
      if (!allowed) return;

      consumeCredits(request, 'audit.agent', cost);

      const { runOrgAudit } = require('../services/deerflow');
      runOrgAudit(request.org.id).catch((err) =>
        request.log.error({ err: err.message }, 'Agent audit failed in background')
      );

      return {
        success: true,
        data: {
          status: 'queued',
          domain: body.domain,
          message: 'Multi-agent audit started. You will receive a webhook when complete.',
          agents: ['lighthouse', 'technical-seo', 'search-console', 'competitors', 'ai-recommendations'],
        },
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan },
      };
    } catch (err) {
      throw err;
    }
  });

  // GET /api/audit/history
  fastify.get('/history', async (request, reply) => {
    try {
      const limit = Math.min(parseInt(request.query.limit || '10', 10), 50);

      const runs = await prisma.auditRun.findMany({
        where: { orgId: request.org.id },
        orderBy: { startedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          domain: true,
          status: true,
          issuesFound: true,
          summary: true,
          totalPages: true,
          startedAt: true,
          completedAt: true,
        },
      });

      return { success: true, data: runs };
    } catch (err) {
      throw err;
    }
  });
}

module.exports = auditRoutes;
