const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 5000)
});

redis.on('error', (err) => console.error('Redis error:', err.message));

module.exports = { redis };
