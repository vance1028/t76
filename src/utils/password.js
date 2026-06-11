'use strict';

const crypto = require('crypto');

/**
 * 用 scrypt 对密码做加盐哈希（Node 内置，无需第三方依赖）。
 * 存储格式：scrypt$<salt-hex>$<hash-hex>
 */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** 校验明文密码与已存储的哈希是否匹配（用恒定时间比较防时序攻击）。 */
function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(plain, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { hashPassword, verifyPassword };
