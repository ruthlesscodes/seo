const { z } = require('zod');
const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const { normalizeDomain } = require('../utils/domain');
const firecrawl = require('../services/firecrawl');
const claude = require('../services/claude');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');

const SerpFeaturesBody = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(200)
});

async function rankingRoutes(fastify) {

  function findDomainPosition(webResults, domain) {
    const domainNorm = normalizeDomain(domain);
    for (let i = 0; i < webResults.length; i++) {
      const r = webResults[i];
      const u = (r.url || '').toLowerCase().replace(/^https?:\/\//, '');
      if (u.includes(domainNorm) || u.startsWith(domainNorm)) {
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
    const body = schemas.RankCheckBody.parse(request.body);

    const cost = body.keywords.length;
    const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'rank.track', cost);
    if (!allowed) return;

    const country = body.country || body.region || 'US';
    const searchOpts = { limit: 10, country };
    if (body.location) searchOpts.location = body.location;

    const settled = await Promise.allSettled(
      body.keywords.map((kw) => firecrawl.search(kw, searchOpts))
    );

    const results = [];
    const dbPromises = [];
    for (let i = 0; i < body.keywords.length; i++) {
      const keyword = body.keywords[i];
      const s = settled[i];
      if (s.status === 'rejected') {
        results.push({ keyword, position: null, url: null });
        continue;
      }
      const webResults = s.value.data?.web || s.value.data?.results || [];
      const { position, url } = findDomainPosition(webResults, body.domain);

      const upsertPromise = prisma.keyword
        .upsert({
          where: { orgId_keyword: { orgId: request.org.id, keyword } },
          create: { orgId: request.org.id, keyword },
          update: { lastPosition: position, lastCheckedAt: new Date() }
        })
        .then((kw) =>
          prisma.rankSnapshot.create({
            data: {
              orgId: request.org.id,
              keywordId: kw.id,
              position,
              url,
              region: country,
              topResults: webResults.slice(0, 5).map((r, idx) => ({
                title: r.title || r.name,
                url: r.url,
                position: r.position ?? idx + 1
              }))
            }
          })
        );
      dbPromises.push(upsertPromise);
      results.push({ keyword, position, url });
    }
    await Promise.all(dbPromises);

    consumeCredits(request, 'rank.track', creditCost);

    return {
      success: true,
      data: results,
      meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
    };
  });

  // POST /api/rankings/global — GROWTH+
  // Body: { keyword: string, domain: string, regions: string[] }
  // Uses: firecrawl.search() per region with location/country params
  fastify.post('/global', async (request, reply) => {
    if (!checkFeature(request, reply, 'rankings.global')) return;

    const body = schemas.RankGlobalBody.parse(request.body);

    const cost = body.regions.length;
    const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'rankings.global', cost);
    if (!allowed) return;

    const kw = await prisma.keyword.upsert({
      where: { orgId_keyword: { orgId: request.org.id, keyword: body.keyword } },
      create: { orgId: request.org.id, keyword: body.keyword },
      update: {}
    });

    const settled = await Promise.allSettled(
      body.regions.map((region) =>
        firecrawl.search(body.keyword, { limit: 10, country: region })
      )
    );

    const positions = {};
    const dbPromises = [];
    for (let i = 0; i < body.regions.length; i++) {
      const region = body.regions[i];
      const s = settled[i];
      if (s.status === 'rejected') {
        positions[region] = null;
        continue;
      }
      const webResults = s.value.data?.web || s.value.data?.results || [];
      const { position, url } = findDomainPosition(webResults, body.domain);
      positions[region] = position;
      dbPromises.push(
        prisma.rankSnapshot.create({
          data: {
            orgId: request.org.id,
            keywordId: kw.id,
            position,
            url,
            region,
            topResults: webResults.slice(0, 5).map((r, idx) => ({
              title: r.title || r.name,
              url: r.url,
              position: r.position ?? idx + 1
            }))
          }
        })
      );
    }
    await Promise.all(dbPromises);

    consumeCredits(request, 'rankings.global', creditCost);

    return {
      success: true,
      data: { keyword: body.keyword, positions },
      meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
    };
  });

  // POST /api/rankings/serp-features — GROWTH+
  // Body: { keywords: string[] }
  // Uses: firecrawl.search(keyword, scrapeOptions) → parse SERP for features
  fastify.post('/serp-features', async (request, reply) => {
    if (!checkFeature(request, reply, 'rankings.serp-features')) return;

    const body = SerpFeaturesBody.parse(request.body);

    const cost = body.keywords.length;
    const { allowed, remaining, cost: creditCost } = await checkCredits(request, reply, 'rankings.serp-features', cost);
    if (!allowed) return;

    const settled = await Promise.allSettled(
      body.keywords.map(async (keyword) => {
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
        return { keyword, analysis };
      })
    );

    const results = [];
    const dbPromises = [];
    for (let i = 0; i < body.keywords.length; i++) {
      const s = settled[i];
      if (s.status === 'rejected') {
        results.push({ keyword: body.keywords[i], serpFeatures: {} });
        continue;
      }
      const { keyword, analysis } = s.value;
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
        dbPromises.push(
          prisma.rankSnapshot.create({
            data: {
              orgId: request.org.id,
              keywordId: kw.id,
              region: 'US',
              serpFeatures
            }
          })
        );
      }
      results.push({ keyword, serpFeatures });
    }
    await Promise.all(dbPromises);

    consumeCredits(request, 'rankings.serp-features', creditCost);

    return {
      success: true,
      data: results,
      meta: { creditsUsed: creditCost, creditsRemaining: remaining, plan: request.org.plan }
    };
  });

  // POST /api/rankings/serp-snapshot — GROWTH+
  // Body: { keyword: string, country?: string }
  // Uses: firecrawl.scrape(google search URL) with screenshot format
  fastify.post('/serp-snapshot', async (request, reply) => {
    if (!checkFeature(request, reply, 'serp-snapshot')) return;

    const body = schemas.RankSerpSnapshotBody.parse(request.body);

    const { allowed, remaining, cost } = await checkCredits(request, reply, 'rankings.serp-snapshot');
    if (!allowed) return;

    const country = body.country || 'US';
    const gl = country.toLowerCase();
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(body.keyword)}&gl=${gl}`;

    const result = await firecrawl.scrape(searchUrl, {
      formats: ['screenshot']
    });

    const screenshot = result.data?.screenshot || result.screenshot;

    consumeCredits(request, 'rankings.serp-snapshot', cost);

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
  });
}

module.exports = rankingRoutes;
