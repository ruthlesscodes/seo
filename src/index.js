require('dotenv').config();

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { authMiddleware } = require('./middleware/auth');
const { rateLimitMiddleware } = require('./middleware/rateLimit');
const { usageMiddleware } = require('./middleware/usage');
const { prisma } = require('./utils/prisma');
const { redis } = require('./utils/redis');
const { registerPluOrg } = require('./utils/bootstrap');

let worker = null;

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
  }
});

const PORT = Number(process.env.PORT) || 4200;

// ============================================
// HEALTH (no auth, no DB — must be first so healthcheck always succeeds)
// Some platforms check GET / — provide both
// ============================================
fastify.get('/health', async (_request, reply) => {
  return reply.status(200).send({ status: 'ok' });
});
fastify.get('/', async (_request, reply) => {
  return reply.status(200).send({ status: 'ok', message: 'SEO Agent API — see /docs' });
});

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
// GLOBAL HOOKS (PUBLIC_PATHS like /health skip auth/rateLimit/usage)
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
fastify.register(require('./routes/search'),        { prefix: '/api/search' });
fastify.register(require('./routes/brand'),         { prefix: '/api/brand' });
fastify.register(require('./routes/intelligence'),  { prefix: '/api/intelligence' });
fastify.register(require('./routes/domain'),        { prefix: '/api/domain' });
fastify.register(require('./routes/monitor'),       { prefix: '/api/monitor' });
fastify.register(require('./routes/audit'),         { prefix: '/api/audit' });
fastify.register(require('./routes/geo'),           { prefix: '/api/geo' });
fastify.register(require('./routes/pipeline'),      { prefix: '/api/pipeline' });
fastify.register(require('./routes/webhooks'),      { prefix: '/api/webhooks' });
fastify.register(require('./routes/billing'),       { prefix: '/api/billing' });

// ============================================
// START — listen first, DB/Redis after (so /health succeeds immediately)
// ============================================
const CONNECT_TIMEOUT = 10000; // 10s

async function connectDatabase() {
  try {
    await Promise.race([
      prisma.$connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database connection timeout')), CONNECT_TIMEOUT))
    ]);
    console.log('✅ Database connected');

    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), CONNECT_TIMEOUT))
    ]);
    console.log('✅ Redis connected');

    const pluApiKey = await registerPluOrg(prisma);
    console.log(`\n🔑 Plu API key: ${pluApiKey}\n`);

    try {
      const { startScheduler } = require('./jobs/scheduler');
      const pw = require('./jobs/pipelineWorker');
      worker = pw.worker;
      startScheduler(fastify.log);
      console.log('✅ Scheduler + pipeline worker started');
    } catch (e) {
      console.warn('⚠️ Background jobs failed to start:', e.message, e.stack);
    }
  } catch (err) {
    fastify.log.warn({ err: err.message }, 'DB/Redis not available; server stays up (GET /health works)');
  }
}

const start = async () => {
  await fastify.ready();

  console.log('[start] Binding server to port', PORT, '(0.0.0.0)...');
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log('[start] Server listening on port', PORT);
    console.log(`   GET  /health — status`);
    console.log(`   GET  /docs   — API reference`);
    console.log(`   POST /api/auth/register — get started\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  setImmediate(connectDatabase);
};

// Graceful shutdown
const shutdown = async () => {
  if (worker) await worker.close().catch(() => {});
  await fastify.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
