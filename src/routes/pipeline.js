const { checkCredits, consumeCredits } = require('../utils/credits');
const { prisma } = require('../utils/prisma');
const schemas = require('../schemas/requests');

async function pipelineRoutes(fastify) {

  // POST /api/pipeline/run — full async pipeline
  // Body: { domain: string, keywords: string[], competitors?: string[], region?: string }
  // Creates ScrapeRun record. BullMQ worker would process (not implemented here per CURSOR - worker in src/jobs/)
  fastify.post('/run', async (request, reply) => {
    try {
      const body = schemas.PipelineRunBody.parse(request.body);

      const { allowed, remaining, cost } = await checkCredits(request, reply, 'pipeline.full');
      if (!allowed) return;

      const scrapeRun = await prisma.scrapeRun.create({
        data: {
          orgId: request.org.id,
          jobType: 'pipeline',
          status: 'PENDING',
          config: {
            domain: body.domain,
            keywords: body.keywords,
            competitors: body.competitors || [],
            region: body.region,
            orgId: request.org.id
          }
        }
      });

      consumeCredits(request, 'pipeline.full', cost);

      return {
        success: true,
        data: {
          jobId: scrapeRun.id,
          status: 'PENDING',
          message: 'Pipeline queued. Poll GET /api/pipeline/:jobId for status.'
        },
        meta: { creditsUsed: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      request.log.error(err);
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', details: err.errors });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });

  // GET /api/pipeline/:jobId — check status
  fastify.get('/:jobId', async (request, reply) => {
    try {
      const { jobId } = request.params;

      const scrapeRun = await prisma.scrapeRun.findFirst({
        where: { id: jobId, orgId: request.org.id }
      });

      if (!scrapeRun) {
        return reply.code(404).send({ error: 'not_found', message: 'Job not found' });
      }

      return {
        success: true,
        data: {
          jobId: scrapeRun.id,
          status: scrapeRun.status,
          result: scrapeRun.result,
          error: scrapeRun.error,
          startedAt: scrapeRun.startedAt,
          completedAt: scrapeRun.completedAt
        }
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });
}

module.exports = pipelineRoutes;
