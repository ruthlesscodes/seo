const crypto = require('crypto');

const SALT_LEN = 16;
const KEY_LEN = 64;

function generateApiKey() {
  return `seo_${crypto.randomBytes(24).toString('base64url')}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

async function registerPluOrg(prisma) {
  const existing = await prisma.organization.findFirst({
    where: { domain: process.env.PLU_ORG_DOMAIN || 'getplu.com' },
    include: { apiKeys: true }
  });

  if (existing && existing.apiKeys.length > 0) {
    return existing.apiKeys[0].key;
  }

  const apiKey = generateApiKey();

  const org = existing || await prisma.organization.create({
    data: {
      name: process.env.PLU_ORG_NAME || 'Plu',
      domain: process.env.PLU_ORG_DOMAIN || 'getplu.com',
      plan: 'ENTERPRISE'
    }
  });

  if (!existing || existing.apiKeys.length === 0) {
    await prisma.apiKey.create({
      data: {
        key: apiKey,
        name: 'Internal',
        orgId: org.id
      }
    });
  }

  return existing?.apiKeys[0]?.key || apiKey;
}

module.exports = { generateApiKey, registerPluOrg, hashPassword, verifyPassword };
