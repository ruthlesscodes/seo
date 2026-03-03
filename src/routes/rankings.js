const { z } = require('zod');
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');

const SerpFeaturesBody = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(500)
});

async function rankingRoutes(fastify) {

  function findDomainPosition(webResults, domain) {
    const domainLower = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    for (let i = 0; i < webResults.length; i++) {
      const r = webResults[i];
      const resultUrl = (r.url || '').toLowerCase();
      if (resultUrl.includes(domainLower) || resultUrl.replace(/^https?:\/\//, '').startsWith(domainLower)) {
        return { position: r.position ?? i + 1, url: r.url };
      }
    }
    return { position: null, url: null };
  }

  // POST /api/rankings/check
  // Body: { keywords: string[], domain: string, region?: string }
  // Uses: firecrawl.search() per keyword, find domain position
  // Stores: RankSnapshot per keyword
  fastify.post('/check', async (request, reply) => {
    try {
      const body = schemas.RankCheckBody.parse(request.body);

      const cost = body.keywords.length;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'rank.check', cost);
      if (!allowed) return;

      const results = [];
      const domainLower = body.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

      for (const keyword of body.keywords) {
        const searchRes = await firecrawl.search(keyword, { limit: 10, country: body.region });
        const webResults = searchRes.data?.web || searchRes.data?.results || [];
        const { position, url } = findDomainPosition(webResults, body.domain);

        const kw = await prisma.keyword.upsert({
          where: { orgId_keyword: { orgId: request.org.id, keyword } },
          create: { orgId: request.org.id, keyword },
          update: { lastPosition: position, lastCheckedAt: new Date() }
        });

        await prisma.rankSnapshot.create({
          data: {
            orgId: request.org.id,
            keywordId: kw.id,
            position,
            url,
            region: body.region,
            topResults: webResults.slice(0, 5).map((r, i) => ({
              title: r.title || r.name,
              url: r.url,
              position: r.position ?? i + 1
            }))
          }
        });

        results.push({ keyword, position, url });
      }

      consumeCredits(request, 'rank.check', creditCost);

      return {
        success: true,
        data: results,
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

  // POST /api/rankings/global — GROWTH+
  // Body: { keyword: string, domain: string, regions: string[] }
  // Uses: firecrawl.search() per region with location/country params
  fastify.post('/global', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'rankings.global')) return;

      const body = schemas.RankGlobalBody.parse(request.body);

      const cost = body.regions.length;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'rank.global', cost);
      if (!allowed) return;

      const positions = {};
      const kw = await prisma.keyword.upsert({
        where: { orgId_keyword: { orgId: request.org.id, keyword: body.keyword } },
        create: { orgId: request.org.id, keyword: body.keyword },
        update: {}
      });

      for (const region of body.regions) {
        const searchRes = await firecrawl.search(body.keyword, { limit: 10, country: region });
        const webResults = searchRes.data?.web || searchRes.data?.results || [];
        const { position, url } = findDomainPosition(webResults, body.domain);
        positions[region] = position;

        await prisma.rankSnapshot.create({
          data: {
            orgId: request.org.id,
            keywordId: kw.id,
            position,
            url,
            region,
            topResults: webResults.slice(0, 5).map((r, i) => ({
              title: r.title || r.name,
              url: r.url,
              position: r.position ?? i + 1
            }))
          }
        });
      }

      consumeCredits(request, 'rank.global', creditCost);

      return {
        success: true,
        data: { keyword: body.keyword, positions },
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

  // POST /api/rankings/serp-features — GROWTH+
  // Body: { keywords: string[] }
  // Uses: firecrawl.search(keyword, scrapeOptions) → parse SERP for features
  fastify.post('/serp-features', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'rankings.serp-features')) return;

      const body = SerpFeaturesBody.parse(request.body);

      const cost = body.keywords.length;
      const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'rank.serp-features', cost);
      if (!allowed) return;

      const results = [];
      for (const keyword of body.keywords) {
        const searchRes = await firecrawl.search(keyword, {
          limit: 1,
          scrapeOptions: { formats: ['markdown', 'html'] }
        });
        const html = searchRes.data?.web?.[0]?.html
          || searchRes.data?.results?.[0]?.html
          || JSON.stringify(searchRes);
        const analysis = await claude.analyzeJSON(
          'Analyze this SERP HTML and identify: featured snippet, AI overview, PAA (People Also Ask), image pack, video results, local pack, knowledge panel. Return JSON: { featuredSnippet: boolean, aiOverview: boolean, paa: boolean, imagePack: boolean, videoResults: boolean, localPack: boolean, knowledgePanel: boolean }',
          html
        );

        const serpFeatures = {
          featuredSnippet: !!analysis.featuredSnippet,
          aiOverview: !!analysis.aiOverview,
          paa: !!analysis.paa,
          imagePack: !!analysis.imagePack,
          videoResults: !!analysis.videoResults,
          localPack: !!analysis.localPack,
          knowledgePanel: !!analysis.knowledgePanel
        };

        const kw = await prisma.keyword.findFirst({
          where: { orgId: request.org.id, keyword }
        });
        if (kw) {
          await prisma.rankSnapshot.create({
            data: {
              orgId: request.org.id,
              keywordId: kw.id,
              region: 'US',
              serpFeatures
            }
          });
        }

        results.push({ keyword, serpFeatures });
      }

      consumeCredits(request, 'rank.serp-features', creditCost);

      return {
        success: true,
        data: results,
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

  // POST /api/rankings/serp-snapshot — GROWTH+
  // Body: { keyword: string, country?: string }
  // Uses: firecrawl.scrape(google search URL) with screenshot format
  fastify.post('/serp-snapshot', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'rankings.serp-snapshot')) return;

      const body = schemas.RankSerpSnapshotBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'rank.serp-snapshot');
      if (!allowed) return;

      const country = body.country || 'US';
      const gl = country.toLowerCase();
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(body.keyword)}&gl=${gl}`;

      const result = await firecrawl.scrape(searchUrl, {
        formats: ['screenshot']
      });

      const screenshot = result.data?.screenshot || result.screenshot;

      consumeCredits(request, 'rank.serp-snapshot', cost);

      return {
        success: true,
        data: {
          keyword: body.keyword,
          country,
          screenshot,
          base64: !!screenshot
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
}

module.exports = rankingRoutes;
