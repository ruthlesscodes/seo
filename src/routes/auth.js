const { generateApiKey } = require('../utils/bootstrap');
const { prisma } = require('../utils/prisma');

async function authRoutes(fastify) {

  // POST /api/auth/register — create org + get API key
  fastify.post('/register', async (request, reply) => {
    const { name, domain, email } = request.body || {};

    if (!name || !domain || !email) {
      return reply.code(400).send({ error: 'name, domain, and email are required' });
    }

    // Check if domain already registered
    const existing = await prisma.organization.findFirst({ where: { domain } });
    if (existing) {
      return reply.code(409).send({ error: 'domain_already_registered' });
    }

    const apiKey = generateApiKey();

    const org = await prisma.organization.create({
      data: {
        name,
        domain,
        plan: 'FREE',
        users: { create: { email, name, role: 'OWNER' } },
        apiKeys: { create: { key: apiKey, name: 'Default' } }
      }
    });

    return {
      success: true,
      organization: { id: org.id, name, domain, plan: 'FREE' },
      apiKey,
      message: 'Store this API key securely. It cannot be retrieved again.'
    };
  });

  // GET /api/auth/usage — check credit usage
  fastify.get('/usage', async (request, reply) => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const used = await prisma.usageLog.aggregate({
      where: { orgId: request.org.id, createdAt: { gte: startOfMonth } },
      _sum: { credits: true }
    });

    const { PLAN_LIMITS } = require('../utils/constants');
    const limit = PLAN_LIMITS[request.org.plan]?.creditsPerMonth || 100;
    const totalUsed = used._sum.credits || 0;

    // Breakdown by operation
    const breakdown = await prisma.usageLog.groupBy({
      by: ['operation'],
      where: { orgId: request.org.id, createdAt: { gte: startOfMonth } },
      _sum: { credits: true },
      _count: true
    });

    return {
      plan: request.org.plan,
      period: { start: startOfMonth, end: new Date() },
      credits: { used: totalUsed, limit, remaining: Math.max(0, limit - totalUsed) },
      breakdown: breakdown.map(b => ({
        operation: b.operation,
        calls: b._count,
        credits: b._sum.credits
      }))
    };
  });
}

module.exports = authRoutes;
