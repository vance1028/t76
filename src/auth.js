'use strict';

const jwt = require('jsonwebtoken');
const { sendError } = require('./utils/http');

const JWT_SECRET = process.env.JWT_SECRET || 'civil-defense-dev-secret';
const TOKEN_TTL = '8h';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

/** 鉴权中间件：校验 Bearer token，挂载 req.user。 */
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return sendError(res, 401, '未登录或缺少令牌');
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = { id: payload.sub, username: payload.username, role: payload.role };
    return next();
  } catch {
    return sendError(res, 401, '令牌无效或已过期');
  }
}

/** 角色校验中间件工厂：要求 req.user.role 属于 allowedRoles 之一。 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, '未登录');
    if (!allowedRoles.includes(req.user.role)) {
      return sendError(res, 403, '当前角色无权执行此操作');
    }
    return next();
  };
}

module.exports = { signToken, authRequired, requireRole };
