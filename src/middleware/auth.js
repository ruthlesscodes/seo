const { PUBLIC_PATHS, PLAN_LIMITS } = require('../utils/constants');
const { prisma } = require('../utils/prisma');

async function authMiddleware(request, reply) {
  if (PUBLIC_PATHS.some(p => request.url.startsWith(p))) return;

  const apiKey = request.headers['x-api-key']
    || (request.headers['authorization']?.startsWith('Bearer ')
      ? request.headers['authorization'].slice(7) : null);

  if (!apiKey) {
    return reply.code(401).send({
      error: 'authentication_required',
      message: 'Provide API key via x-api-key header or Authorization: Bearer <key>',
      docs: 'https://docs.seoagent.dev/auth'
    });
  }

  // Check Redis cache first, then DB
  const cacheKey = `auth:${apiKey}`;
  let org;

  const cached = await request.server.redis.get(cacheKey);
  if (cached) {
    org = JSON.parse(cached);
  } else {
    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: { org: true }
    });

    if (!keyRecord || !keyRecord.isActive) {
      return reply.code(401).send({ error: 'invalid_api_key' });
    }

    if (keyRecord.expiresAt && new Date() > keyRecord.expiresAt) {
      return reply.code(401).send({ error: 'api_key_expired' });
    }

    org = {
      id: keyRecord.org.id,
      name: keyRecord.org.name,
      domain: keyRecord.org.domain,
      plan: keyRecord.org.plan,
      keyId: keyRecord.id
    };

    // Cache for 5 minutes
    await request.server.redis.set(cacheKey, JSON.stringify(org), 'EX', 300);

    // Update lastUsedAt (fire and forget)
    prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() }
    }).catch(() => {});
  }

  request.org = org;
  request.planLimits = PLAN_LIMITS[org.plan] || PLAN_LIMITS.FREE;
}

module.exports = { authMiddleware };
