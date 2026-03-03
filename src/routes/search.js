const { checkCredits, consumeCredits, checkFeature } = require('../utils/credits');
const firecrawl = require('../services/firecrawl');
const schemas = require('../schemas/requests');

async function searchRoutes(fastify) {

  // POST /api/search/news — news source search
  // Body: { query: string, limit?: number, country?: string, tbs?: string }
  // Uses: firecrawl.search with sources: ['news']
  fastify.post('/news', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'news')) return;

      const body = schemas.SearchNewsBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'search.news');
      if (!allowed) return;

      const searchRes = await firecrawl.search(body.query, {
        sources: ['news'],
        limit: body.limit ?? 10,
        country: body.country ?? 'US',
        tbs: body.tbs
      });

      const results = searchRes.data?.news || searchRes.data?.web || searchRes.data?.results || [];

      consumeCredits(request, 'search.news', cost);

      return {
        success: true,
        data: {
          query: body.query,
          results: results.map(r => ({
            title: r.title || r.name,
            url: r.url,
            snippet: r.snippet || r.description,
            date: r.date,
            source: r.source
          }))
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

  // POST /api/search/github — GitHub category search
  // Body: { query: string, limit?: number }
  // Uses: firecrawl.search with categories: [{ type: "github" }]
  fastify.post('/github', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'search.github')) return;

      const body = schemas.SearchGithubBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'search.github');
      if (!allowed) return;

      const searchRes = await firecrawl.search(body.query, {
        categories: [{ type: 'github' }],
        limit: body.limit ?? 10
      });

      const results = searchRes.data?.web || searchRes.data?.results || [];

      consumeCredits(request, 'search.github', cost);

      return {
        success: true,
        data: {
          query: body.query,
          results: results.map(r => ({
            title: r.title || r.name,
            url: r.url,
            description: r.description || r.snippet
          }))
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

  // POST /api/search/research — academic/research category search
  // Body: { query: string, limit?: number }
  // Uses: firecrawl.search with categories: [{ type: "research" }]
  fastify.post('/research', async (request, reply) => {
    try {
      if (!checkFeature(request, reply, 'search.research')) return;

      const body = schemas.SearchResearchBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'search.research');
      if (!allowed) return;

      const searchRes = await firecrawl.search(body.query, {
        categories: [{ type: 'research' }],
        limit: body.limit ?? 10
      });

      const results = searchRes.data?.web || searchRes.data?.results || [];

      consumeCredits(request, 'search.research', cost);

      return {
        success: true,
        data: {
          query: body.query,
          results: results.map(r => ({
            title: r.title || r.name,
            url: r.url,
            description: r.description || r.snippet
          }))
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

module.exports = searchRoutes;
