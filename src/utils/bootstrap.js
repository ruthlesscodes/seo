const crypto = require('crypto');

const SALT_LEN = 16;
const KEY_LEN = 64;

function generateApiKey() {
  return `seo_${crypto.randomBytes(24).toString('base64url')}`;
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LEN).toString('hex');
    crypto.scrypt(password, salt, KEY_LEN, (err, derived) => {
      if (err) return reject(err);
      resolve(`${salt}:${derived.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    if (!stored || !password) return resolve(false);
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(password, salt, KEY_LEN, (err, derived) => {
      if (err) return resolve(false);
      resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived));
    });
  });
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
