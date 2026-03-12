const { Queue } = require('bullmq');
const { checkCredits } = require('../utils/credits');
const { prisma } = require('../utils/prisma');
const { redisBullmq } = require('../utils/redis');
const schemas = require('../schemas/requests');

let _pipelineQueue;
function getPipelineQueue() {
  if (!_pipelineQueue) _pipelineQueue = new Queue('pipeline', { connection: redisBullmq });
  return _pipelineQueue;
}

async function pipelineRoutes(fastify) {

  // POST /api/pipeline/run — full async pipeline
  // Body: { domain: string, keywords: string[], competitors?: string[], region?: string }
  // Creates ScrapeRun + BullMQ job; worker processes search → crawl → analyze → generate
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

      await getPipelineQueue().add('pipeline', { scrapeRunId: scrapeRun.id });

      return {
        success: true,
        data: {
          jobId: scrapeRun.id,
          status: 'PENDING',
          message: 'Pipeline queued. Credits are charged when the job completes. Poll GET /api/pipeline/:jobId for status.'
        },
        meta: { creditsReserved: cost, creditsRemaining: remaining, plan: request.org.plan }
      };
    } catch (err) {
      throw err;
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
      throw err;
    }
  });
}

module.exports = pipelineRoutes;
