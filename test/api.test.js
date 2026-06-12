'use strict';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const { createApp } = require('../src/app');
const { waitForDb, close } = require('../src/db');
const store = require('../src/data/store');
const spatial = require('../src/utils/spatial');

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
  assert.strictEqual(res.body.total, 12);
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

/* ---------- 空间计算工具函数 ---------- */

test('Haversine 球面距离计算：同一点距离为0', () => {
  const dist = spatial.haversineDistance(34.0522, 108.9499, 34.0522, 108.9499);
  assert.strictEqual(dist, 0);
});

test('Haversine 球面距离计算：约1公里误差在10米内', () => {
  const dist = spatial.haversineDistance(34.0522, 108.9499, 34.0522, 108.9609);
  assert.ok(dist > 990 && dist < 1010, `距离应约1000米，实际${dist.toFixed(2)}米`);
});

test('点在矩形范围内判定正确', () => {
  assert.strictEqual(spatial.pointInBoundingBox(34.05, 108.95, 34.00, 108.90, 34.10, 109.00), true);
  assert.strictEqual(spatial.pointInBoundingBox(34.05, 108.80, 34.00, 108.90, 34.10, 109.00), false);
});

test('点在圆形范围内判定正确（球面距离）', () => {
  assert.strictEqual(spatial.pointInCircle(34.0522, 108.9499, 34.0522, 108.9499, 100), true);
  assert.strictEqual(spatial.pointInCircle(34.0522, 108.9609, 34.0522, 108.9499, 500), false);
});

test('射线法点在多边形内判定正确', () => {
  const square = [
    { lat: 34.00, lng: 108.90 },
    { lat: 34.00, lng: 109.00 },
    { lat: 34.10, lng: 109.00 },
    { lat: 34.10, lng: 108.90 },
  ];
  assert.strictEqual(spatial.pointInPolygon(34.05, 108.95, square), true);
  assert.strictEqual(spatial.pointInPolygon(34.05, 108.85, square), false);
});

test('WKT与多边形坐标互转正确', () => {
  const polygon = [
    { lat: 34.00, lng: 108.90 },
    { lat: 34.00, lng: 109.00 },
    { lat: 34.10, lng: 109.00 },
    { lat: 34.10, lng: 108.90 },
  ];
  const wkt = spatial.polygonToWKT(polygon);
  assert.ok(wkt.startsWith('POLYGON'));
  const parsed = spatial.wktToPolygon(wkt);
  assert.strictEqual(parsed.length, 4);
  assert.strictEqual(parsed[0].lat, 34.00);
  assert.strictEqual(parsed[0].lng, 108.90);
});

test('GeoJSON与多边形坐标互转正确', () => {
  const polygon = [
    { lat: 34.00, lng: 108.90 },
    { lat: 34.00, lng: 109.00 },
    { lat: 34.10, lng: 109.00 },
    { lat: 34.10, lng: 108.90 },
  ];
  const geojson = spatial.polygonToGeoJSON(polygon);
  assert.strictEqual(geojson.type, 'Polygon');
  assert.strictEqual(geojson.coordinates[0].length, 5);
  const parsed = spatial.geoJSONToPolygon(geojson);
  assert.strictEqual(parsed.length, 4);
});

test('获取多边形外接矩形正确', () => {
  const polygon = [
    { lat: 34.00, lng: 108.90 },
    { lat: 34.00, lng: 109.00 },
    { lat: 34.10, lng: 109.00 },
    { lat: 34.10, lng: 108.90 },
  ];
  const bbox = spatial.getBoundingBox(polygon);
  assert.strictEqual(bbox.swLat, 34.00);
  assert.strictEqual(bbox.swLng, 108.90);
  assert.strictEqual(bbox.neLat, 34.10);
  assert.strictEqual(bbox.neLng, 109.00);
});

/* ---------- 空间查询 API ---------- */

test('矩形范围查询：城关区范围内应返回城关区工程', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/bbox?swLat=34.03&swLng=108.92&neLat=34.07&neLng=108.97')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total >= 3, `应至少返回3个城关区工程，实际返回${res.body.total}`);
  assert.ok(res.body.data.every(p => p.longitude !== null && p.latitude !== null));
});

test('矩形范围查询：小范围应精确筛选', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/bbox?swLat=34.052&swLng=108.949&neLat=34.053&neLng=108.950')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total >= 1, `中心广场附近应有工程，实际返回${res.body.total}`);
});

test('矩形范围查询：参数错误返回400', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/bbox?swLat=abc&swLng=108.92&neLat=34.07&neLng=108.97')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 400);
});

test('圆形范围查询：中心广场500米范围内工程', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/circle?centerLat=34.052231&centerLng=108.949871&radius=500')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.every(p => p.distanceMeters <= 500), '返回的工程距离应都在500米内');
  assert.ok(res.body.total >= 1, `应有工程在500米范围内，实际返回${res.body.total}`);
});

test('圆形范围查询：返回结果按距离排序', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/circle?centerLat=34.052231&centerLng=108.949871&radius=3000')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  if (res.body.data.length >= 2) {
    for (let i = 0; i < res.body.data.length - 1; i++) {
      assert.ok(res.body.data[i].distanceMeters <= res.body.data[i + 1].distanceMeters,
        `结果应按距离升序排列：${res.body.data[i].distanceMeters} > ${res.body.data[i + 1].distanceMeters}`);
    }
  }
});

test('邻近查询：返回指定点周边最近的工程', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/nearby?lat=34.052231&lng=108.949871&radius=2000&limit=5')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total <= 5, '返回数量不应超过limit');
  assert.ok(res.body.data[0].distanceMeters < 100, '最近的工程距离应小于100米');
  assert.ok(res.body.data.every(p => p.distanceMeters <= 2000), '所有工程距离应在2000米内');
});

test('行政区聚合统计：应返回各行政区数据', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/stats/district')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.totalDistricts, 5);
  const chengguan = res.body.data.find(d => d.district === '城关区');
  assert.ok(chengguan, '应包含城关区统计');
  assert.strictEqual(chengguan.projectCount, 3);
  assert.ok(chengguan.totalArea > 0);
  assert.ok(chengguan.protectionLevelDistribution);
  assert.ok(chengguan.statusDistribution);
  assert.ok(chengguan.boundingBox);
});

test('全市人防底数汇总', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/stats/city')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.totalProjects, 12);
  assert.ok(res.body.data.totalArea > 0);
  assert.ok(res.body.data.areaByType);
  assert.strictEqual(res.body.data.districtCount, 5);
});

test('查询最近人防工程距离', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/nearest?lat=34.052231&lng=108.949871')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data);
  assert.strictEqual(res.body.data.projectName, '中心广场地下人防工程');
  assert.ok(res.body.data.distanceMeters < 100);
});

test('人防覆盖盲区分析：中心广场区域应完全覆盖', async () => {
  const token = await tokenOf('admin', 'admin123');
  const testPolygon = [
    { lat: 34.050, lng: 108.947 },
    { lat: 34.050, lng: 108.953 },
    { lat: 34.055, lng: 108.953 },
    { lat: 34.055, lng: 108.947 },
  ];
  const res = await request(app)
    .post('/api/spatial/coverage/analyze')
    .set('Authorization', `Bearer ${token}`)
    .send({ polygon: testPolygon, gridSizeMeters: 200 });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data);
  assert.ok(res.body.data.coverageRate >= 0.8, '中心广场覆盖率应大于80%');
  assert.ok(res.body.data.totalSamplePoints > 0);
});

test('人防覆盖盲区分析：远郊区域应有盲区', async () => {
  const token = await tokenOf('admin', 'admin123');
  const testPolygon = [
    { lat: 33.900, lng: 108.800 },
    { lat: 33.900, lng: 108.850 },
    { lat: 33.950, lng: 108.850 },
    { lat: 33.950, lng: 108.800 },
  ];
  const res = await request(app)
    .post('/api/spatial/coverage/analyze')
    .set('Authorization', `Bearer ${token}`)
    .send({ polygon: testPolygon, gridSizeMeters: 500 });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data);
  assert.ok(res.body.data.blindPoints > 0, '远郊区域应有盲区');
  assert.ok(res.body.data.coverageRate < 0.5, '远郊覆盖率应小于50%');
});

test('更新工程空间信息', async () => {
  const token = await tokenOf('admin', 'admin123');
  const newBoundary = [
    { lat: 34.050, lng: 108.947 },
    { lat: 34.050, lng: 108.953 },
    { lat: 34.055, lng: 108.953 },
    { lat: 34.055, lng: 108.947 },
  ];
  const res = await request(app)
    .put('/api/spatial/project/1')
    .set('Authorization', `Bearer ${token}`)
    .send({
      longitude: 108.950,
      latitude: 34.052,
      boundaryPoints: newBoundary,
      serviceRadius: 1000,
    });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.longitude, 108.950);
  assert.strictEqual(res.body.data.latitude, 34.052);
  assert.strictEqual(res.body.data.serviceRadius, 1000);
  assert.ok(res.body.data.boundary);
  assert.strictEqual(res.body.data.boundary.type, 'Polygon');
});

test('新建工程支持空间字段', async () => {
  const token = await tokenOf('admin', 'admin123');
  const boundary = [
    { lat: 34.060, lng: 108.970 },
    { lat: 34.060, lng: 108.975 },
    { lat: 34.065, lng: 108.975 },
    { lat: 34.065, lng: 108.970 },
  ];
  const res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({
      code: 'RF-TEST-SPATIAL',
      name: '空间测试工程',
      district: '新城区',
      longitude: 108.9725,
      latitude: 34.0625,
      boundaryPoints: boundary,
      serviceRadius: 600,
    });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.longitude, 108.9725);
  assert.strictEqual(res.body.data.latitude, 34.0625);
  assert.strictEqual(res.body.data.serviceRadius, 600);
  assert.ok(res.body.data.boundary);
});

test('空间字段验证：经度越界返回400', async () => {
  const token = await tokenOf('admin', 'admin123');
  const res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({
      code: 'RF-TEST-INVALID',
      name: '无效经度测试',
      longitude: 200,
      latitude: 34.0,
    });
  assert.strictEqual(res.status, 400);
});

test('空间字段验证：服务半径越界返回400', async () => {
  const token = await tokenOf('admin', 'admin123');
  const res = await request(app)
    .put('/api/spatial/project/1')
    .set('Authorization', `Bearer ${token}`)
    .send({ serviceRadius: 10000 });
  assert.strictEqual(res.status, 400);
});

test('空间索引性能：100次矩形查询总时间应合理', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const startTime = Date.now();
  const count = 100;
  for (let i = 0; i < count; i++) {
    const offsetLat = (i % 10) * 0.005;
    const offsetLng = Math.floor(i / 10) * 0.005;
    await request(app)
      .get(`/api/spatial/bbox?swLat=${34.03 + offsetLat}&swLng=${108.92 + offsetLng}&neLat=${34.04 + offsetLat}&neLng=${108.93 + offsetLng}`)
      .set('Authorization', `Bearer ${token}`);
  }
  const totalTime = Date.now() - startTime;
  const avgTime = totalTime / count;
  assert.ok(avgTime < 100, `100次查询平均时间应小于100ms，实际${avgTime.toFixed(2)}ms`);
});

test('工程返回包含GeoJSON格式的边界', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/projects/1')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.boundary);
  assert.strictEqual(res.body.data.boundary.type, 'Polygon');
  assert.ok(Array.isArray(res.body.data.boundary.coordinates));
  assert.ok(res.body.data.boundaryPoints);
  assert.strictEqual(res.body.data.boundaryPoints.length, 4);
});

test('矩形范围查询支持状态和行政区筛选', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app)
    .get('/api/spatial/bbox?swLat=34.00&swLng=108.90&neLat=34.10&neLng=109.00&status=NORMAL&district=城关区')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.every(p => p.status === 'NORMAL' && p.district === '城关区'));
});
