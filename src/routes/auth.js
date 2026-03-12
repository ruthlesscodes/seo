const { generateApiKey, hashPassword, verifyPassword } = require('../utils/bootstrap');
const { prisma } = require('../utils/prisma');
const { z } = require('zod');

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

const REGISTER_RATE_LIMIT = 5;   // per window
const REGISTER_RATE_WINDOW = 3600; // 1 hour in seconds

async function authRoutes(fastify) {

  // POST /api/auth/register — create org + get API key (rate limited by IP)
  fastify.post('/register', async (request, reply) => {
    const ip = request.ip || request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const windowKey = `rl:register:${ip}:${Math.floor(Date.now() / 3600000)}`;
    try {
      const current = await request.server.redis.incr(windowKey);
      if (current === 1) await request.server.redis.expire(windowKey, REGISTER_RATE_WINDOW);
      if (current > REGISTER_RATE_LIMIT) {
        return reply.code(429).send({
          error: 'rate_limit_exceeded',
          message: 'Too many registration attempts. Try again later.'
        });
      }
    } catch (_) {
      // Redis down: allow request but log
      request.log.warn('Register rate limit check failed (Redis?)');
    }

    const { name, domain, email, password } = request.body || {};

    if (!name || !domain || !email) {
      return reply.code(400).send({ error: 'name, domain, and email are required' });
    }
    if (!password || String(password).length < 8) {
      return reply.code(400).send({
        error: 'password_required',
        message: 'Password is required (min 8 characters) to enable login.'
      });
    }

    const emailNormalized = email.toLowerCase().trim();
    const domainNormalized = domain.toLowerCase().trim();

    const existing = await prisma.organization.findFirst({ where: { domain: domainNormalized } });
    if (existing) {
      return reply.code(409).send({ error: 'domain_already_registered' });
    }

    const apiKey = generateApiKey();
    const userData = {
      email: emailNormalized,
      name: (name || '').trim(),
      role: 'OWNER',
      passwordHash: await hashPassword(password)
    };

    const org = await prisma.organization.create({
      data: {
        name: (name || '').trim(),
        domain: domainNormalized,
        plan: 'FREE',
        users: { create: userData },
        apiKeys: { create: { key: apiKey, name: 'Default' } }
      }
    });

    return {
      success: true,
      organization: { id: org.id, name: org.name, domain: org.domain, plan: 'FREE' },
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
        include: { org: { include: { apiKeys: { where: { isActive: true }, take: 1 } } } }
      });

      if (!user || !user.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
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
