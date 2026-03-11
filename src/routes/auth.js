const { generateApiKey, hashPassword, verifyPassword } = require('../utils/bootstrap');
const { prisma } = require('../utils/prisma');
const { z } = require('zod');

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

async function authRoutes(fastify) {

  // POST /api/auth/register — create org + get API key
  fastify.post('/register', async (request, reply) => {
    const { name, domain, email, password } = request.body || {};

    if (!name || !domain || !email) {
      return reply.code(400).send({ error: 'name, domain, and email are required' });
    }

    // Check if domain already registered
    const existing = await prisma.organization.findFirst({ where: { domain } });
    if (existing) {
      return reply.code(409).send({ error: 'domain_already_registered' });
    }

    const apiKey = generateApiKey();
    const userData = { email, name, role: 'OWNER' };
    if (password) userData.passwordHash = hashPassword(password);

    const org = await prisma.organization.create({
      data: {
        name,
        domain,
        plan: 'FREE',
        users: { create: userData },
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

  // POST /api/auth/login — email + password → apiKey, org, user
  fastify.post('/login', async (request, reply) => {
    try {
      const body = LoginBody.parse(request.body);
      const user = await prisma.user.findUnique({
        where: { email: body.email.toLowerCase() },
        include: { org: { include: { apiKeys: { where: { isActive: true }, take: 1 } } }
      });

      if (!user || !user.passwordHash || !verifyPassword(body.password, user.passwordHash)) {
        return reply.code(401).send({ error: 'invalid_credentials', message: 'Invalid email or password' });
      }

      const apiKey = user.org?.apiKeys?.[0]?.key;
      if (!apiKey) {
        return reply.code(401).send({ error: 'invalid_credentials', message: 'No API key found for organization' });
      }

      return reply.code(200).send({
        success: true,
        apiKey,
        api_key: apiKey,
        seoApiKey: apiKey,
        orgId: user.org.id,
        org_id: user.org.id,
        seoOrgId: user.org.id,
        plan: user.org.plan,
        domain: user.org.domain,
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        }
      });
    } catch (err) {
      if (err.name === 'ZodError') {
        return reply.code(400).send({ error: 'validation_error', message: 'email and password are required', details: err.errors });
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong' });
    }
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
