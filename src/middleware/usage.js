const { PUBLIC_PATHS } = require('../utils/constants');
const { prisma } = require('../utils/prisma');

async function usageMiddleware(request, reply) {
  if (PUBLIC_PATHS.some(p => request.url.startsWith(p))) return;
  if (!request.org) return;
  if (!request.creditsUsed) return; // routes set this when they consume credits

  // Fire-and-forget log
  prisma.usageLog.create({
    data: {
      orgId: request.org.id,
      operation: request.operationName || 'unknown',
      credits: request.creditsUsed,
      endpoint: request.url,
      metadata: { method: request.method, statusCode: reply.statusCode }
    }
  }).catch(err => request.log.error('Usage log failed:', err.message));
}

module.exports = { usageMiddleware };
