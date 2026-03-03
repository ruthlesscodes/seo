const { z } = require('zod');
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');

const DomainSitemapBody = z.object({
  url: z.string().url()
});

const DomainStructureBody = z.object({
  url: z.string().url()
});

async function domainRoutes(fastify) {

  // POST /api/domain/map
  // Body: { url: string, search?: string, limit?: number }
  // Uses: firecrawl.map(url)
  fastify.post('/map', async (request, reply) => {
    try {
      const body = schemas.DomainMapBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'domain.map');
      if (!allowed) return;

      const result = await firecrawl.map(body.url, {
        search: body.search,
        limit: body.limit
      });

      const urls = result.data?.links || result.links || result.data?.urls || [];

      consumeCredits(request, 'domain.map', cost);

      return {
        success: true,
        data: { urls, count: urls.length },
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

  // POST /api/domain/sitemap — GROWTH+
  // Body: { url: string }
  // Uses: firecrawl.map(url) → format as XML sitemap
  fastify.post('/sitemap', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'sitemap')) return;

      const body = DomainSitemapBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'domain.sitemap');
      if (!allowed) return;

      const mapUrl = body.url.startsWith('http') ? body.url : `https://${body.url}`;
      const result = await firecrawl.map(mapUrl, { sitemap: 'include', limit: 10000 });
      const urls = result.data?.links || result.links || result.data?.urls || [];

      const urlEntries = urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;

      consumeCredits(request, 'domain.sitemap', cost);

      return {
        success: true,
        data: { xml, urlCount: urls.length },
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

  // POST /api/domain/structure — SCALE+
  // Body: { url: string }
  // Uses: firecrawl.map(url) → build hierarchy tree + claude analysis
  fastify.post('/structure', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'domain.structure')) return;

      const body = DomainStructureBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'domain.structure');
      if (!allowed) return;

      const mapUrl = body.url.startsWith('http') ? body.url : `https://${body.url}`;
      const result = await firecrawl.map(mapUrl);
      const urls = result.data?.links || result.links || result.data?.urls || [];

      const tree = {};
      for (const urlStr of urls) {
        try {
          const u = new URL(urlStr);
          const path = u.pathname || '/';
          const segments = path.split('/').filter(Boolean);
          let node = tree;
          for (const seg of segments) {
            if (!node[seg]) node[seg] = { _urls: [] };
            node = node[seg];
          }
          node._urls.push(urlStr);
        } catch (_) {}
      }

      const analysis = await claude.analyzeJSON(
        'You are a site structure analyst. Analyze this URL hierarchy tree for SEO quality: depth, orphan risks, hub pages, redirect chains. Return JSON: { score: 0-100, issues: [], recommendations: [], summary: string }',
        JSON.stringify({ baseUrl: body.url, tree, urlCount: urls.length })
      );

      consumeCredits(request, 'domain.structure', cost);

      return {
        success: true,
        data: { tree, urlCount: urls.length, analysis },
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

module.exports = domainRoutes;
