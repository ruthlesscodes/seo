const { z } = require('zod');
const { prisma } = require('../utils/prisma');

const VALID_EVENTS = ['pipeline.completed', 'monitor.changed', 'ranking.dropped', 'audit.completed'];

const WebhookConfigureBody = z.object({
  url: z.string().url(),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
  secret: z.string().optional()
});

async function webhookRoutes(fastify) {

  // POST /api/webhooks/configure
  // Body: { url: string, events: string[], secret?: string }
  fastify.post('/configure', async (request, reply) => {
    try {
      const body = WebhookConfigureBody.parse(request.body);

      const config = await prisma.webhookConfig.upsert({
        where: {
          orgId_url: { orgId: request.org.id, url: body.url }
        },
        create: {
          orgId: request.org.id,
          url: body.url,
          events: body.events,
          secret: body.secret
        },
        update: {
          events: body.events,
          secret: body.secret ?? undefined,
          isActive: true
        }
      });

      return {
        success: true,
        data: {
          id: config.id,
          url: config.url,
          events: config.events,
          isActive: config.isActive
        }
      };
    } catch (err) {
      request.log.error(err);
      if (err.name === 'ZodError') {
        return reply.code(400).send({
          error: 'validation_error',
          message: 'Valid events: ' + VALID_EVENTS.join(', '),
          details: err.errors
        });
      }
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Something went wrong. Please try again.'
      });
    }
  });
}

module.exports = webhookRoutes;
