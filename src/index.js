require('dotenv').config();
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { authMiddleware } = require('./middleware/auth');
const { rateLimitMiddleware } = require('./middleware/rateLimit');
const { usageMiddleware } = require('./middleware/usage');
const { prisma } = require('./utils/prisma');
const { redis } = require('./utils/redis');
const { registerPluOrg } = require('./utils/bootstrap');
const { startScheduler } = require('./jobs/scheduler');
const { worker } = require('./jobs/pipelineWorker');

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
  }
});

const PORT = process.env.PORT || 4200;

// ============================================
// PLUGINS
// ============================================
fastify.register(cors, { origin: true });

// ============================================
// DECORATORS — make prisma + redis available to all routes
// ============================================
fastify.decorate('prisma', prisma);
fastify.decorate('redis', redis);

// ============================================
// GLOBAL HOOKS
// ============================================
fastify.addHook('onRequest', authMiddleware);
fastify.addHook('onRequest', rateLimitMiddleware);
fastify.addHook('onResponse', usageMiddleware);

// ============================================
// ROUTES — each file exports a fastify plugin
// ============================================
fastify.register(require('./routes/health'),       { prefix: '/' });
fastify.register(require('./routes/auth'),          { prefix: '/api/auth' });
fastify.register(require('./routes/keywords'),      { prefix: '/api/keywords' });
fastify.register(require('./routes/competitors'),   { prefix: '/api/competitors' });
fastify.register(require('./routes/content'),       { prefix: '/api/content' });
fastify.register(require('./routes/rankings'),      { prefix: '/api/rankings' });
fastify.register(require('./routes/intelligence'),  { prefix: '/api/intelligence' });
fastify.register(require('./routes/domain'),        { prefix: '/api/domain' });
fastify.register(require('./routes/monitor'),       { prefix: '/api/monitor' });
fastify.register(require('./routes/audit'),         { prefix: '/api/audit' });
fastify.register(require('./routes/geo'),           { prefix: '/api/geo' });
fastify.register(require('./routes/pipeline'),      { prefix: '/api/pipeline' });
fastify.register(require('./routes/webhooks'),      { prefix: '/api/webhooks' });
fastify.register(require('./routes/billing'),       { prefix: '/api/billing' });

// ============================================
// START
// ============================================
const start = async () => {
  try {
    // Ensure DB connection
    await prisma.$connect();
    console.log('✅ Database connected');

    // Ensure Redis connection
    await redis.ping();
    console.log('✅ Redis connected');

    // Register Plu as internal Enterprise org
    const pluApiKey = await registerPluOrg(prisma);
    console.log(`\n🔑 Plu API key: ${pluApiKey}\n`);

    startScheduler(fastify.log);
    console.log('✅ Scheduler + pipeline worker started');

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🔥 SEO Agent API v2 — port ${PORT}`);
    console.log(`   GET  /health — status`);
    console.log(`   GET  /docs   — API reference`);
    console.log(`   POST /api/auth/register — get started\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  await worker.close();
  await fastify.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
