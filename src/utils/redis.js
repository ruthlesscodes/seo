const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 5000),
  lazyConnect: true
});

redis.on('error', (err) => console.error('Redis error:', err.message));

// BullMQ requires maxRetriesPerRequest: null for blocking commands (BLPOP etc)
const redisBullmq = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 5000),
  lazyConnect: true
});

redisBullmq.on('error', (err) => console.error('Redis (BullMQ) error:', err.message));

/** Call before using redis in request handlers. Idempotent. */
async function connectRedis() {
  if (redis.status !== 'ready') await redis.connect();
}
async function connectRedisBullmq() {
  if (redisBullmq.status !== 'ready') await redisBullmq.connect();
}

module.exports = { redis, redisBullmq, connectRedis, connectRedisBullmq };
