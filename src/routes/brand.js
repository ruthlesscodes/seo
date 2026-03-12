const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const schemas = require('../schemas/requests');

async function brandRoutes(fastify) {

  // POST /api/brand/mentions — news mention tracking
  // Body: { brand: string, limit?: number, tbs?: string }
  // Uses: firecrawl.search with sources: ['news'] for brand name
  fastify.post('/mentions', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'brand.mentions')) return;

      const body = schemas.BrandMentionsBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'brand.mentions');
      if (!allowed) return;

      const searchRes = await firecrawl.search(body.brand, {
        sources: ['news'],
        limit: body.limit ?? 15,
        tbs: body.tbs ?? 'qdr:m'
      });

      const results = searchRes.data?.news || searchRes.data?.web || searchRes.data?.results || [];

      consumeCredits(request, 'brand.mentions', cost);

      return {
        success: true,
        data: {
          brand: body.brand,
          mentions: results.map(r => ({
            title: r.title || r.name,
            url: r.url,
            snippet: r.snippet || r.description,
            date: r.date
          }))
        },
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });

  // POST /api/brand/images — image search presence
  // Body: { brand: string, limit?: number }
  // Uses: firecrawl.search with sources: ['images']
  fastify.post('/images', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'brand.images')) return;

      const body = schemas.BrandImagesBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'brand.images');
      if (!allowed) return;

      const searchRes = await firecrawl.search(body.brand, {
        sources: ['images'],
        limit: body.limit ?? 20
      });

      const results = searchRes.data?.images || searchRes.data?.web || searchRes.data?.results || [];

      consumeCredits(request, 'brand.images', cost);

      return {
        success: true,
        data: {
          brand: body.brand,
          images: results.map(r => ({
            url: r.url || r.imageUrl,
            thumbnailUrl: r.thumbnailUrl || r.url,
            title: r.title,
            sourceUrl: r.sourceUrl || r.pageUrl
          }))
        },
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
    }
  });
}

module.exports = brandRoutes;
