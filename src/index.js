require('dotenv').config();
console.log('[boot] Starting SEO Agent API...');

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
const { redis, redisBullmq, connectRedis, connectRedisBullmq } = require('./utils/redis');
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

fastify.register(require('@fastify/swagger'), {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'SEO Agent API',
      version: '2.0.0',
      description: 'API-first SEO intelligence platform. Firecrawl gives raw web data. We give SEO intelligence. Authenticate with x-api-key or Authorization: Bearer <key>.'
    },
    servers: [{ url: '/', description: 'API' }],
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'API key' }
      }
    },
    security: [{ apiKey: [] }]
  }
});
fastify.register(require('@fastify/swagger-ui'), {
  routePrefix: '/docs',
  uiConfig: { docExpansion: 'list', displayRequestDuration: true }
});

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

fastify.setErrorHandler((err, request, reply) => {
  if (err.replySent === true || reply.sent) return;
  request.log.error(err);
  if (err.status === 400) {
    return reply.code(400).send({ error: 'validation_error', message: err.message, details: err.details || err.errors });
  }
  if (err.status) {
    return reply.code(err.status).send({ error: 'upstream_error', message: err.message, details: err.details });
  }
  if (err.name === 'ZodError') {
    return reply.code(400).send({ error: 'validation_error', details: err.errors });
  }
  reply.code(500).send({ error: 'internal_error', message: 'Something went wrong.' });
});

// ============================================
// STARTUP — load routes BEFORE listen (Fastify disallows register after boot)
// ============================================
const CONNECT_TIMEOUT = 10000; // 10s

async function connectDatabase() {
  try {
    await Promise.race([
      prisma.$connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database connection timeout')), CONNECT_TIMEOUT))
    ]);
    console.log('✅ Database connected');

    await connectRedis();
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connection timeout')), CONNECT_TIMEOUT))
    ]);
    console.log('✅ Redis connected');

    await connectRedisBullmq();
    await redisBullmq.ping().catch(() => {});
    console.log('✅ Redis (BullMQ) ready');

    await registerPluOrg(prisma);
    console.log('✅ Plu org ready');

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
    fastify.log.warn({ err: err.message }, 'DB/Redis not available');
    throw err;
  }
}

async function loadAllRoutes() {
  await fastify.register(require('./routes/health'),       { prefix: '/' });
  await fastify.register(require('./routes/auth'),          { prefix: '/api/auth' });
  await fastify.register(require('./routes/keywords'),      { prefix: '/api/keywords' });
  await fastify.register(require('./routes/competitors'),   { prefix: '/api/competitors' });
  await fastify.register(require('./routes/content'),       { prefix: '/api/content' });
  await fastify.register(require('./routes/rankings'),      { prefix: '/api/rankings' });
  await fastify.register(require('./routes/search'),        { prefix: '/api/search' });
  await fastify.register(require('./routes/brand'),         { prefix: '/api/brand' });
  await fastify.register(require('./routes/intelligence'),  { prefix: '/api/intelligence' });
  await fastify.register(require('./routes/domain'),        { prefix: '/api/domain' });
  await fastify.register(require('./routes/monitor'),       { prefix: '/api/monitor' });
  await fastify.register(require('./routes/audit'),         { prefix: '/api/audit' });
  await fastify.register(require('./routes/geo'),           { prefix: '/api/geo' });
  await fastify.register(require('./routes/pipeline'),      { prefix: '/api/pipeline' });
  await fastify.register(require('./routes/webhooks'),      { prefix: '/api/webhooks' });
  await fastify.register(require('./routes/billing'),       { prefix: '/api/billing' });
}

const start = async () => {
  try {
    console.log('[boot] Connecting to database and Redis...');
    await connectDatabase();
    console.log('[boot] Loading routes...');
    await loadAllRoutes();
    await fastify.ready();
    console.log('[start] Binding server to port', PORT, '(0.0.0.0)...');
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log('[start] Server listening — / and /health ready');
    console.log('[start] All routes loaded');
    console.log(`   GET  /health — status`);
    console.log(`   GET  /docs   — OpenAPI UI`);
    console.log(`   POST /api/auth/register — get started\n`);
  } catch (err) {
    console.error('[start] Failed:', err);
    process.exit(1);
  }
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
