const crypto = require('crypto');

const KEY_ENV = 'MAGWALK_ENCRYPTION_KEY';
const keyValue = process.env[KEY_ENV];

if (!keyValue) {
  throw new Error(`${KEY_ENV} is required in .env.local`);
}

function readKey(value) {
  const base64 = Buffer.from(value, 'base64');

  if (base64.length === 32) {
    return base64;
  }

  const hex = Buffer.from(value, 'hex');

  if (hex.length === 32) {
    return hex;
  }

  return crypto.createHash('sha256').update(value).digest();
}

const encryptionKey = readKey(keyValue);

function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptText(value) {
  if (!value || !String(value).startsWith('v1:')) {
    return value;
  }

  const [, ivValue, authTagValue, ciphertextValue] = String(value).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagValue, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function encryptJson(value) {
  return encryptText(JSON.stringify(value));
}

function decryptJson(value) {
  return JSON.parse(decryptText(value));
}

function lookupHash(value) {
  return crypto.createHmac('sha256', encryptionKey).update(String(value)).digest('hex');
}

module.exports = {
  decryptJson,
  decryptText,
  encryptJson,
  encryptText,
  lookupHash,
};
