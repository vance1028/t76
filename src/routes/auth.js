'use strict';

const express = require('express');
const store = require('../data/store');
const { signToken, authRequired } = require('../auth');
const { sendError, isNonEmptyString } = require('../utils/http');
const { verifyPassword } = require('../utils/password');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// 登录
router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
    return sendError(res, 400, '用户名和密码不能为空');
  }
  const user = await store.findUserByUsername(username.trim());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return sendError(res, 401, '用户名或密码错误');
  }
  if (user.status !== 'ACTIVE') {
    return sendError(res, 403, '账号已停用');
  }
  const token = signToken(user);
  res.json({
    data: {
      token,
      user: { id: user.id, username: user.username, name: user.name, role: user.role, department: user.department },
    },
  });
}));

// 当前登录用户信息
router.get('/me', authRequired, wrap(async (req, res) => {
  const user = await store.getUser(req.user.id);
  if (!user) return sendError(res, 404, '用户不存在');
  res.json({ data: user });
}));

module.exports = router;
