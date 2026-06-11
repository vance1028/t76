'use strict';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const { createApp } = require('../src/app');
const { waitForDb, close } = require('../src/db');
const store = require('../src/data/store');

const app = createApp();

async function login(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res;
}

async function tokenOf(username, password) {
  const res = await login(username, password);
  return res.body.data.token;
}

before(async () => {
  await waitForDb();
});

beforeEach(async () => {
  await store.seed();
});

after(async () => {
  await close();
});

test('GET /api/health 返回 ok', async () => {
  const res = await request(app).get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
});

/* ---------- 登录 ---------- */

test('登录成功返回 token 和用户信息', async () => {
  const res = await login('admin', 'admin123');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.token);
  assert.strictEqual(res.body.data.user.role, 'ADMIN');
});

test('密码错误返回 401', async () => {
  const res = await login('admin', 'wrongpass');
  assert.strictEqual(res.status, 401);
});

test('用户名不存在返回 401', async () => {
  const res = await login('nobody', 'x');
  assert.strictEqual(res.status, 401);
});

test('空用户名/密码返回 400', async () => {
  const res = await login('', '');
  assert.strictEqual(res.status, 400);
});

test('GET /api/auth/me 带 token 返回当前用户', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.username, 'manager');
});

/* ---------- 鉴权拦截 ---------- */

test('未带 token 访问工程列表返回 401', async () => {
  const res = await request(app).get('/api/projects');
  assert.strictEqual(res.status, 401);
});

test('无效 token 返回 401', async () => {
  const res = await request(app).get('/api/projects').set('Authorization', 'Bearer not.a.token');
  assert.strictEqual(res.status, 401);
});

/* ---------- 工程查询 ---------- */

test('登录后能列出种子工程', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/projects').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.total, 4);
});

test('工程列表支持按状态筛选', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/projects?status=MAINTENANCE').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.every((p) => p.status === 'MAINTENANCE'));
});

test('工程列表支持关键词搜索', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/projects?keyword=滨江').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.length, 1);
});

test('工程详情含设备子资源接口', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/projects/1/equipments').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.length >= 1);
});

/* ---------- 角色权限 ---------- */

test('管理员能新建工程', async () => {
  const token = await tokenOf('admin', 'admin123');
  const res = await request(app).post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'RF-NEW-1', name: '新增测试工程', district: '城关区' });
  assert.strictEqual(res.status, 201);
});

test('巡检员新建工程被拒 403', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'RF-NEW-2', name: 'x' });
  assert.strictEqual(res.status, 403);
});

test('工程编号重复返回 409', async () => {
  const token = await tokenOf('admin', 'admin123');
  const res = await request(app).post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'RF-2024-001', name: '重复编号' });
  assert.strictEqual(res.status, 409);
});

test('仅管理员能删除工程；管理员删除成功 204', async () => {
  const mgr = await tokenOf('manager', 'manager123');
  const denied = await request(app).delete('/api/projects/4').set('Authorization', `Bearer ${mgr}`);
  assert.strictEqual(denied.status, 403);

  const admin = await tokenOf('admin', 'admin123');
  const ok = await request(app).delete('/api/projects/4').set('Authorization', `Bearer ${admin}`);
  assert.strictEqual(ok.status, 204);
});

/* ---------- 检查记录 ---------- */

test('巡检员能登记检查记录', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).post('/api/inspections')
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: 1, inspectDate: '2026-06-05', type: 'ROUTINE', result: 'PASS' });
  assert.strictEqual(res.status, 201);
});

test('检查记录非法日期返回 400', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).post('/api/inspections')
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: 1, inspectDate: '2026/6/5' });
  assert.strictEqual(res.status, 400);
});

test('检查记录可按工程筛选', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/inspections?projectId=1').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.every((i) => i.projectId === 1));
});

test('未知接口返回 404', async () => {
  const res = await request(app).get('/api/unknown');
  assert.strictEqual(res.status, 404);
});
