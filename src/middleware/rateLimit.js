const { PUBLIC_PATHS } = require('../utils/constants');

async function rateLimitMiddleware(request, reply) {
  if (PUBLIC_PATHS.some(p => request.url.startsWith(p))) return;
  if (!request.org) return;

  const windowKey = `rl:${request.org.id}:${Math.floor(Date.now() / 60000)}`;
  const current = await request.server.redis.incr(windowKey);

  if (current === 1) {
    await request.server.redis.expire(windowKey, 60);
  }

  const limit = request.planLimits.requestsPerMinute;
  reply.header('X-RateLimit-Limit', limit);
  reply.header('X-RateLimit-Remaining', Math.max(0, limit - current));

  if (current > limit) {
    return reply.code(429).send({
      error: 'rate_limit_exceeded',
      message: `Plan allows ${limit} requests/min. Upgrade at /api/billing/upgrade`,
      retryAfter: 60 - (Date.now() / 1000 % 60) | 0
    });
  }
}

module.exports = { rateLimitMiddleware };
