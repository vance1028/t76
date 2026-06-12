'use strict';

/**
 * 数据仓储层 - 基于 MySQL（mysql2/promise）。
 * 所有方法 async，返回 camelCase 字段对象。
 */

const { pool } = require('../db');
const { hashPassword } = require('../utils/password');
const {
  haversineDistance,
  pointInPolygon,
  polygonIntersectsBoundingBox,
  polygonIntersectsCircle,
  polygonToWKT,
  wktToPolygon,
  pointToWKT,
  polygonToGeoJSON,
  generateRectPolygon,
  getBoundingBox,
} = require('../utils/spatial');

/* ----------------------------- 映射 ----------------------------- */

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    name: r.name,
    role: r.role,
    department: r.department,
    status: r.status,
    createdAt: r.created_at,
  };
}

// 含密码哈希的内部映射，仅登录校验用，绝不直接返回给前端
function mapUserWithHash(r) {
  if (!r) return null;
  return { ...mapUser(r), passwordHash: r.password_hash };
}

function mapProject(r, includeGeometry = true) {
  if (!r) return null;
  const base = {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    protectionLevel: r.protection_level,
    areaSqm: Number(r.area_sqm),
    address: r.address,
    district: r.district,
    peacetimeUse: r.peacetime_use,
    status: r.status,
    completedAt: r.completed_at,
    longitude: r.longitude ? Number(r.longitude) : null,
    latitude: r.latitude ? Number(r.latitude) : null,
    serviceRadius: r.service_radius || 500,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (includeGeometry) {
    const boundaryWkt = r.boundary_wkt || r.boundary;
    if (boundaryWkt) {
      const polygon = wktToPolygon(boundaryWkt);
      if (polygon) {
        base.boundary = polygonToGeoJSON(polygon);
        base.boundaryPoints = polygon;
      }
    }
    if (r.distance_meters !== undefined) {
      base.distanceMeters = Number(r.distance_meters);
    }
  }
  return base;
}

function mapEquipment(r) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    category: r.category,
    model: r.model,
    installDate: r.install_date,
    status: r.status,
    createdAt: r.created_at,
  };
}

function mapInspection(r) {
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.project_id,
    inspectorId: r.inspector_id,
    inspectDate: r.inspect_date,
    type: r.type,
    result: r.result,
    issues: r.issues,
    createdAt: r.created_at,
  };
}

/* --------------------------- 初始化/重置 --------------------------- */

async function seed() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['inspections', 'equipments', 'projects', 'users']) {
      await conn.query(`TRUNCATE TABLE ${t}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    // 用户（密码运行时哈希）：admin/admin123, manager/manager123, inspector/inspect123
    await conn.query(
      `INSERT INTO users (id, username, password_hash, name, role, department) VALUES
        (1, 'admin', ?, '系统管理员', 'ADMIN', '人防办信息科'),
        (2, 'manager', ?, '张管理', 'MANAGER', '工程管理科'),
        (3, 'inspector', ?, '李巡检', 'INSPECTOR', '维护管理科')`,
      [hashPassword('admin123'), hashPassword('manager123'), hashPassword('inspect123')],
    );

    const projectData = [
      { id: 1, code: 'RF-2024-001', name: '中心广场地下人防工程', type: 'COMBINED', protectionLevel: '6', areaSqm: 8600.50, address: '人民中路1号地下', district: '城关区', peacetimeUse: '地下停车场', status: 'NORMAL', completedAt: '2018-09-01', lat: 34.052231, lng: 108.949871, width: 180, height: 150, radius: 800 },
      { id: 2, code: 'RF-2024-002', name: '滨江路防空地下室', type: 'BASEMENT', protectionLevel: '6B', areaSqm: 3200.00, address: '滨江路88号', district: '江南区', peacetimeUse: '商业仓储', status: 'NORMAL', completedAt: '2020-05-15', lat: 34.021876, lng: 108.976543, width: 120, height: 80, radius: 500 },
      { id: 3, code: 'RF-2024-003', name: '老城区单建掘开式工程', type: 'SINGLE', protectionLevel: '5', areaSqm: 5400.00, address: '解放街地下', district: '城关区', peacetimeUse: '暂未利用', status: 'MAINTENANCE', completedAt: '2010-03-20', lat: 34.048765, lng: 108.943210, width: 150, height: 100, radius: 600 },
      { id: 4, code: 'RF-2024-004', name: '科技园人员掩蔽所', type: 'SHELTER', protectionLevel: '6', areaSqm: 2100.00, address: '科技大道12号地下', district: '高新区', peacetimeUse: '社区活动中心', status: 'NORMAL', completedAt: '2021-11-30', lat: 34.061234, lng: 108.923456, width: 90, height: 70, radius: 500 },
      { id: 5, code: 'RF-2024-005', name: '火车站人防地下商业街', type: 'COMBINED', protectionLevel: '6', areaSqm: 12500.00, address: '火车站广场地下', district: '新城区', peacetimeUse: '商业步行街', status: 'NORMAL', completedAt: '2015-12-20', lat: 34.035678, lng: 108.967890, width: 250, height: 100, radius: 1000 },
      { id: 6, code: 'RF-2024-006', name: '大学城应急避难所', type: 'SHELTER', protectionLevel: '6', areaSqm: 4200.00, address: '大学城中心区地下', district: '长安区', peacetimeUse: '学生活动中心', status: 'NORMAL', completedAt: '2019-08-10', lat: 34.001234, lng: 108.934567, width: 140, height: 90, radius: 700 },
      { id: 7, code: 'RF-2024-007', name: '工业区物资储备库', type: 'SINGLE', protectionLevel: '5', areaSqm: 7800.00, address: '工业园区18号', district: '高新区', peacetimeUse: '物资储备', status: 'NORMAL', completedAt: '2012-06-15', lat: 34.072345, lng: 108.912345, width: 200, height: 120, radius: 600 },
      { id: 8, code: 'RF-2024-008', name: '居民区配套掩蔽所', type: 'BASEMENT', protectionLevel: '6B', areaSqm: 2800.00, address: '幸福花园小区地下', district: '江南区', peacetimeUse: '居民活动室', status: 'NORMAL', completedAt: '2022-03-25', lat: 34.018765, lng: 108.987654, width: 100, height: 80, radius: 400 },
      { id: 9, code: 'RF-2024-009', name: '政务中心人防工程', type: 'COMBINED', protectionLevel: '5', areaSqm: 6500.00, address: '政务广场地下', district: '新城区', peacetimeUse: '政务服务配套', status: 'NORMAL', completedAt: '2017-11-08', lat: 34.041234, lng: 108.956789, width: 160, height: 110, radius: 800 },
      { id: 10, code: 'RF-2024-010', name: '医疗救护中心', type: 'SHELTER', protectionLevel: '5', areaSqm: 3800.00, address: '人民医院地下', district: '城关区', peacetimeUse: '医疗设备间', status: 'NORMAL', completedAt: '2016-04-18', lat: 34.055678, lng: 108.938765, width: 110, height: 95, radius: 600 },
      { id: 11, code: 'RF-2024-011', name: '滨江新区地下车库', type: 'BASEMENT', protectionLevel: '6', areaSqm: 5200.00, address: '滨江新区1号地块', district: '江南区', peacetimeUse: '地下停车场', status: 'NORMAL', completedAt: '2023-01-15', lat: 34.028765, lng: 108.962345, width: 130, height: 115, radius: 500 },
      { id: 12, code: 'RF-2024-012', name: '产业园人员掩蔽所', type: 'SHELTER', protectionLevel: '6', areaSqm: 3100.00, address: '创业产业园B区', district: '长安区', peacetimeUse: '员工餐厅', status: 'MAINTENANCE', completedAt: '2020-09-30', lat: 34.008765, lng: 108.945678, width: 105, height: 85, radius: 450 },
    ];

    for (const p of projectData) {
      const polygon = generateRectPolygon(p.lat, p.lng, p.width, p.height);
      const wkt = polygonToWKT(polygon);
      await conn.query(
        `INSERT INTO projects (id, code, name, type, protection_level, area_sqm, address, district, peacetime_use, status, completed_at, longitude, latitude, location, boundary, service_radius)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ST_PointFromText(?, 4326), ST_PolygonFromText(?, 4326), ?)`,
        [p.id, p.code, p.name, p.type, p.protectionLevel, p.areaSqm, p.address, p.district, p.peacetimeUse, p.status, p.completedAt,
         p.lng, p.lat, pointToWKT(p.lat, p.lng), wkt, p.radius]
      );
    }

    await conn.query(
      `INSERT INTO equipments (project_id, name, category, model, install_date, status) VALUES
        (1, '1号防护密闭门', 'PROTECTIVE_DOOR', 'HFM2030', '2018-08-01', 'NORMAL'),
        (1, '战时通风机', 'VENTILATION', 'F300', '2018-08-10', 'NORMAL'),
        (1, '柴油发电机组', 'POWER', '50GF', '2018-08-15', 'NORMAL'),
        (2, '防爆波活门', 'PROTECTIVE_DOOR', 'HK600', '2020-04-20', 'NORMAL'),
        (2, '给排水泵', 'WATER', 'WQ15', '2020-05-01', 'FAULT'),
        (3, '滤毒通风设备', 'VENTILATION', 'LD60', '2010-03-01', 'MAINTENANCE')`,
    );

    await conn.query(
      `INSERT INTO inspections (project_id, inspector_id, inspect_date, type, result, issues) VALUES
        (1, 3, '2026-05-10', 'ROUTINE', 'PASS', ''),
        (2, 3, '2026-05-12', 'ROUTINE', 'FAIL', '给排水泵故障，需更换'),
        (3, 3, '2026-04-20', 'SPECIAL', 'FAIL', '滤毒设备老化，建议大修'),
        (1, 3, '2026-06-01', 'ROUTINE', 'PASS', '')`,
    );
  } finally {
    conn.release();
  }
}

async function isEmpty() {
  const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM users');
  return rows[0].cnt === 0;
}

/* ----------------------------- 用户 ----------------------------- */

async function findUserByUsername(username) {
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
  return mapUserWithHash(rows[0]);
}

async function getUser(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return mapUser(rows[0]);
}

async function listUsers() {
  const [rows] = await pool.query('SELECT * FROM users ORDER BY id');
  return rows.map(mapUser);
}

async function createUser({ username, password, name = '', role = 'INSPECTOR', department = '' }) {
  const [r] = await pool.query(
    'INSERT INTO users (username, password_hash, name, role, department) VALUES (?, ?, ?, ?, ?)',
    [username, hashPassword(password), name, role, department],
  );
  return getUser(r.insertId);
}

/* ----------------------------- 人防工程 ----------------------------- */

async function getProject(id) {
  const [rows] = await pool.query(
    'SELECT p.*, ST_AsText(p.boundary) AS boundary_wkt FROM projects p WHERE id = ?',
    [id]
  );
  return mapProject(rows[0]);
}

async function findProjectByCode(code) {
  const [rows] = await pool.query(
    'SELECT p.*, ST_AsText(p.boundary) AS boundary_wkt FROM projects p WHERE code = ?',
    [code]
  );
  return mapProject(rows[0]);
}

async function listProjects({ status, district, keyword } = {}) {
  const where = [];
  const params = [];
  if (status !== undefined) { where.push('status = ?'); params.push(status); }
  if (district !== undefined) { where.push('district = ?'); params.push(district); }
  if (keyword !== undefined && keyword !== '') {
    where.push('(name LIKE ? OR code LIKE ? OR address LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT p.*, ST_AsText(p.boundary) AS boundary_wkt FROM projects p ${clause} ORDER BY id`,
    params
  );
  return rows.map(mapProject);
}

async function createProject(p) {
  const fields = ['code', 'name', 'type', 'protection_level', 'area_sqm', 'address', 'district', 'peacetime_use', 'status', 'completed_at'];
  const values = [p.code, p.name, p.type || 'COMBINED', p.protectionLevel || '6', p.areaSqm || 0,
    p.address || '', p.district || '', p.peacetimeUse || '', p.status || 'NORMAL', p.completedAt || null];
  const placeholders = ['?', '?', '?', '?', '?', '?', '?', '?', '?', '?'];

  if (p.longitude !== undefined && p.latitude !== undefined) {
    fields.push('longitude', 'latitude', 'location');
    values.push(p.longitude, p.latitude, pointToWKT(p.latitude, p.longitude));
    placeholders.push('?', '?', 'ST_PointFromText(?, 4326)');
  }
  if (p.boundaryPoints !== undefined) {
    const wkt = polygonToWKT(p.boundaryPoints);
    if (wkt) {
      fields.push('boundary');
      values.push(wkt);
      placeholders.push('ST_PolygonFromText(?, 4326)');
    }
  }
  if (p.serviceRadius !== undefined) {
    fields.push('service_radius');
    values.push(p.serviceRadius);
    placeholders.push('?');
  }

  const sql = `INSERT INTO projects (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
  const [r] = await pool.query(sql, values);
  return getProject(r.insertId);
}

async function updateProject(id, patch) {
  const map = {
    name: 'name', type: 'type', protectionLevel: 'protection_level', areaSqm: 'area_sqm',
    address: 'address', district: 'district', peacetimeUse: 'peacetime_use',
    status: 'status', completedAt: 'completed_at',
    longitude: 'longitude', latitude: 'latitude',
    serviceRadius: 'service_radius',
  };
  const sets = [];
  const params = [];

  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(patch[k]);
    }
  }

  if (patch.longitude !== undefined && patch.latitude !== undefined) {
    sets.push('location = ST_PointFromText(?, 4326)');
    params.push(pointToWKT(patch.latitude, patch.longitude));
  }

  if (patch.boundaryPoints !== undefined) {
    if (patch.boundaryPoints === null) {
      sets.push('boundary = NULL');
    } else {
      const wkt = polygonToWKT(patch.boundaryPoints);
      if (wkt) {
        sets.push('boundary = ST_PolygonFromText(?, 4326)');
        params.push(wkt);
      }
    }
  }

  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await pool.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getProject(id);
}

async function deleteProject(id) {
  const [r] = await pool.query('DELETE FROM projects WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* --------------------------- 空间查询 --------------------------- */

/**
 * 按矩形范围查询工程（地图视口查询）
 * 性能策略：先用空间索引 MBRContains 粗筛（R-Tree索引，O(log n)），再精确判定
 * @param {Object} bbox {swLat, swLng, neLat, neLng}
 * @param {Object} filters {status, district}
 * @returns {Promise<Array>}
 */
async function listProjectsByBoundingBox(bbox, filters = {}) {
  const { swLat, swLng, neLat, neLng } = bbox;

  const where = [];
  const params = [];

  where.push(
    `MBRContains(
      ST_MakeEnvelope(
        ST_PointFromText(?, 4326),
        ST_PointFromText(?, 4326)
      ), location
    )`
  );
  params.push(`POINT(${swLng} ${swLat})`, `POINT(${neLng} ${neLat})`);

  if (filters.status !== undefined) { where.push('status = ?'); params.push(filters.status); }
  if (filters.district !== undefined) { where.push('district = ?'); params.push(filters.district); }

  const clause = `WHERE ${where.join(' AND ')}`;

  const sql = `
    SELECT
      p.*,
      ST_AsText(p.boundary) AS boundary_wkt
    FROM projects p
    ${clause}
    ORDER BY p.id
  `;

  const [rows] = await pool.query(sql, params);

  return rows.map(r => {
    const project = mapProject(r);
    return project;
  });
}

/**
 * 按圆形范围查询工程
 * 性能策略：先用外接矩形 MBR 走空间索引粗筛，再用 ST_Distance_Sphere 精确过滤
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusMeters
 * @param {Object} filters
 * @returns {Promise<Array>}
 */
async function listProjectsByCircle(centerLat, centerLng, radiusMeters, filters = {}) {
  const centerPointWkt = pointToWKT(centerLat, centerLng);

  const approxDegrees = radiusMeters / 111000;
  const swLat = centerLat - approxDegrees;
  const swLng = centerLng - approxDegrees / Math.cos(toRad(centerLat));
  const neLat = centerLat + approxDegrees;
  const neLng = centerLng + approxDegrees / Math.cos(toRad(centerLat));

  const where = [];
  const params = [];

  where.push(
    `MBRContains(
      ST_MakeEnvelope(
        ST_PointFromText(?, 4326),
        ST_PointFromText(?, 4326)
      ), location
    )`
  );
  params.push(`POINT(${swLng} ${swLat})`, `POINT(${neLng} ${neLat})`);

  where.push(
    `ST_Distance_Sphere(location, ST_PointFromText(?, 4326)) <= ?`
  );
  params.push(centerPointWkt, radiusMeters);

  if (filters.status !== undefined) { where.push('status = ?'); params.push(filters.status); }
  if (filters.district !== undefined) { where.push('district = ?'); params.push(filters.district); }

  const clause = `WHERE ${where.join(' AND ')}`;

  const sql = `
    SELECT
      p.*,
      ST_AsText(p.boundary) AS boundary_wkt,
      ST_Distance_Sphere(p.location, ST_PointFromText(?, 4326)) AS distance_meters
    FROM projects p
    ${clause}
    ORDER BY distance_meters ASC
  `;
  params.unshift(centerPointWkt);

  const [rows] = await pool.query(sql, params);
  return rows.map(r => mapProject(r));
}

/**
 * 邻近查询：找出指定点周围一定距离内的工程，返回带距离的列表
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusMeters
 * @param {number} limit
 * @param {Object} filters
 * @returns {Promise<Array>}
 */
async function findNearbyProjects(centerLat, centerLng, radiusMeters, limit = 10, filters = {}) {
  const centerPointWkt = pointToWKT(centerLat, centerLng);

  const approxDegrees = radiusMeters / 111000;
  const swLat = centerLat - approxDegrees;
  const swLng = centerLng - approxDegrees / Math.cos(toRad(centerLat));
  const neLat = centerLat + approxDegrees;
  const neLng = centerLng + approxDegrees / Math.cos(toRad(centerLat));

  const where = [];
  const params = [];

  where.push(
    `MBRContains(
      ST_MakeEnvelope(
        ST_PointFromText(?, 4326),
        ST_PointFromText(?, 4326)
      ), location
    )`
  );
  params.push(`POINT(${swLng} ${swLat})`, `POINT(${neLng} ${neLat})`);

  if (filters.status !== undefined) { where.push('status = ?'); params.push(filters.status); }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      p.*,
      ST_AsText(p.boundary) AS boundary_wkt,
      ST_Distance_Sphere(p.location, ST_PointFromText(?, 4326)) AS distance_meters
    FROM projects p
    ${clause}
    HAVING distance_meters <= ?
    ORDER BY distance_meters ASC
    LIMIT ?
  `;
  params.push(centerPointWkt, radiusMeters, limit);

  const [rows] = await pool.query(sql, params);
  return rows.map(r => mapProject(r));
}

/**
 * 按行政区聚合统计
 * 返回各行政区的工程数量、总建筑面积、按防护等级/状态的分布
 * @returns {Promise<Array>}
 */
async function getDistrictStats() {
  const sql = `
    SELECT
      district,
      COUNT(*) AS project_count,
      SUM(area_sqm) AS total_area,
      SUM(CASE WHEN protection_level = '5' THEN 1 ELSE 0 END) AS count_level_5,
      SUM(CASE WHEN protection_level = '6' THEN 1 ELSE 0 END) AS count_level_6,
      SUM(CASE WHEN protection_level = '6B' THEN 1 ELSE 0 END) AS count_level_6b,
      SUM(CASE WHEN status = 'NORMAL' THEN 1 ELSE 0 END) AS count_status_normal,
      SUM(CASE WHEN status = 'MAINTENANCE' THEN 1 ELSE 0 END) AS count_status_maintenance,
      SUM(CASE WHEN status = 'DECOMMISSIONED' THEN 1 ELSE 0 END) AS count_status_decommissioned,
      AVG(service_radius) AS avg_service_radius,
      MIN(longitude) AS min_lng,
      MAX(longitude) AS max_lng,
      MIN(latitude) AS min_lat,
      MAX(latitude) AS max_lat
    FROM projects
    WHERE district IS NOT NULL AND district != ''
    GROUP BY district
    ORDER BY project_count DESC
  `;

  const [rows] = await pool.query(sql);
  return rows.map(r => ({
    district: r.district,
    projectCount: Number(r.project_count),
    totalArea: Number(r.total_area) || 0,
    protectionLevelDistribution: {
      level5: Number(r.count_level_5),
      level6: Number(r.count_level_6),
      level6b: Number(r.count_level_6b),
    },
    statusDistribution: {
      normal: Number(r.count_status_normal),
      maintenance: Number(r.count_status_maintenance),
      decommissioned: Number(r.count_status_decommissioned),
    },
    avgServiceRadius: Number(r.avg_service_radius) || 0,
    boundingBox: {
      swLng: Number(r.min_lng),
      swLat: Number(r.min_lat),
      neLng: Number(r.max_lng),
      neLat: Number(r.max_lat),
    },
  }));
}

/**
 * 获取全市人防底数汇总
 * @returns {Promise<Object>}
 */
async function getCitySummary() {
  const sql = `
    SELECT
      COUNT(*) AS total_projects,
      SUM(area_sqm) AS total_area,
      SUM(CASE WHEN type = 'COMBINED' THEN area_sqm ELSE 0 END) AS area_combined,
      SUM(CASE WHEN type = 'BASEMENT' THEN area_sqm ELSE 0 END) AS area_basement,
      SUM(CASE WHEN type = 'SINGLE' THEN area_sqm ELSE 0 END) AS area_single,
      SUM(CASE WHEN type = 'SHELTER' THEN area_sqm ELSE 0 END) AS area_shelter,
      COUNT(DISTINCT district) AS district_count,
      SUM(CASE WHEN status = 'NORMAL' THEN 1 ELSE 0 END) AS count_normal,
      SUM(CASE WHEN status = 'MAINTENANCE' THEN 1 ELSE 0 END) AS count_maintenance
    FROM projects
  `;

  const [rows] = await pool.query(sql);
  const r = rows[0];
  return {
    totalProjects: Number(r.total_projects),
    totalArea: Number(r.total_area) || 0,
    areaByType: {
      combined: Number(r.area_combined) || 0,
      basement: Number(r.area_basement) || 0,
      single: Number(r.area_single) || 0,
      shelter: Number(r.area_shelter) || 0,
    },
    districtCount: Number(r.district_count),
    statusCount: {
      normal: Number(r.count_normal),
      maintenance: Number(r.count_maintenance),
    },
  };
}

/**
 * 计算某点到最近人防工程的距离
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<Object>}
 */
async function getDistanceToNearestProject(lat, lng) {
  const pointWkt = pointToWKT(lat, lng);

  const sql = `
    SELECT
      p.id,
      p.name,
      ST_Distance_Sphere(p.location, ST_PointFromText(?, 4326)) AS distance_meters
    FROM projects p
    WHERE p.status = 'NORMAL'
    ORDER BY distance_meters ASC
    LIMIT 1
  `;

  const [rows] = await pool.query(sql, [pointWkt]);
  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    projectId: r.id,
    projectName: r.name,
    distanceMeters: Number(r.distance_meters),
  };
}

/**
 * 人防覆盖盲区分析
 * 给定一片人口聚居区域（多边形），分析其是否在工程服务半径覆盖内
 * @param {Array<{lat: number, lng: number}>} areaPolygon 待分析区域多边形
 * @param {number} gridSizeMeters 网格采样间距（米），越小精度越高但计算越慢
 * @returns {Promise<Object>}
 */
async function analyzeCoverageBlindArea(areaPolygon, gridSizeMeters = 100) {
  const bbox = getBoundingBox(areaPolygon);
  if (!bbox) return null;

  const [activeProjects, citySummary] = await Promise.all([
    listProjects({ status: 'NORMAL' }),
    getCitySummary(),
  ]);

  const projectsWithGeometry = activeProjects.filter(p => p.longitude && p.latitude);

  const latStep = gridSizeMeters / 111000;
  const lngStep = gridSizeMeters / (111000 * Math.cos(toRad((bbox.swLat + bbox.neLat) / 2)));

  const samplePoints = [];
  const blindPoints = [];
  const coveredPoints = [];

  for (let lat = bbox.swLat; lat <= bbox.neLat; lat += latStep) {
    for (let lng = bbox.swLng; lng <= bbox.neLng; lng += lngStep) {
      if (!pointInPolygon(lat, lng, areaPolygon)) continue;

      samplePoints.push({ lat, lng });

      let isCovered = false;
      let minDistance = Infinity;
      let coveringProject = null;

      for (const p of projectsWithGeometry) {
        const dist = haversineDistance(lat, lng, p.latitude, p.longitude);
        if (dist < minDistance) {
          minDistance = dist;
        }
        if (dist <= p.serviceRadius) {
          isCovered = true;
          coveringProject = p;
          break;
        }
      }

      if (isCovered) {
        coveredPoints.push({ lat, lng, coveredBy: coveringProject?.id, distance: minDistance });
      } else {
        blindPoints.push({ lat, lng, nearestDistance: minDistance });
      }
    }
  }

  const totalPoints = samplePoints.length;
  const coveredCount = coveredPoints.length;
  const blindCount = blindPoints.length;
  const coverageRate = totalPoints > 0 ? coveredCount / totalPoints : 0;

  let blindAreaCentroid = null;
  if (blindPoints.length > 0) {
    const sumLat = blindPoints.reduce((s, p) => s + p.lat, 0);
    const sumLng = blindPoints.reduce((s, p) => s + p.lng, 0);
    blindAreaCentroid = {
      lat: sumLat / blindPoints.length,
      lng: sumLng / blindPoints.length,
    };
  }

  return {
    totalSamplePoints: totalPoints,
    coveredPoints: coveredCount,
    blindPoints: blindCount,
    coverageRate,
    coveragePercent: (coverageRate * 100).toFixed(2),
    isFullyCovered: blindCount === 0,
    blindAreaCentroid,
    blindAreaPolygon: blindPoints.length >= 3 ? extractBlindAreaPolygon(blindPoints) : null,
    gridSizeMeters,
    analysisArea: {
      polygon: areaPolygon,
      boundingBox: bbox,
    },
    totalProjectsInCity: citySummary.totalProjects,
    activeProjectsAnalyzed: projectsWithGeometry.length,
  };
}

function extractBlindAreaPolygon(blindPoints) {
  if (blindPoints.length < 3) return null;

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const p of blindPoints) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  return [
    { lat: minLat, lng: minLng },
    { lat: maxLat, lng: minLng },
    { lat: maxLat, lng: maxLng },
    { lat: minLat, lng: maxLng },
  ];
}

function toRad(deg) {
  return deg * Math.PI / 180;
}

/* ----------------------------- 设备设施 ----------------------------- */

async function listEquipments(projectId) {
  const [rows] = await pool.query(
    'SELECT * FROM equipments WHERE project_id = ? ORDER BY id', [projectId]);
  return rows.map(mapEquipment);
}

async function createEquipment(e) {
  const [r] = await pool.query(
    `INSERT INTO equipments (project_id, name, category, model, install_date, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [e.projectId, e.name, e.category || 'OTHER', e.model || '', e.installDate || null, e.status || 'NORMAL'],
  );
  const [rows] = await pool.query('SELECT * FROM equipments WHERE id = ?', [r.insertId]);
  return mapEquipment(rows[0]);
}

/* ----------------------------- 检查记录 ----------------------------- */

async function listInspections({ projectId } = {}) {
  if (projectId !== undefined) {
    const [rows] = await pool.query(
      'SELECT * FROM inspections WHERE project_id = ? ORDER BY inspect_date DESC, id DESC', [projectId]);
    return rows.map(mapInspection);
  }
  const [rows] = await pool.query('SELECT * FROM inspections ORDER BY inspect_date DESC, id DESC');
  return rows.map(mapInspection);
}

async function createInspection(i) {
  const [r] = await pool.query(
    `INSERT INTO inspections (project_id, inspector_id, inspect_date, type, result, issues)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [i.projectId, i.inspectorId || null, i.inspectDate, i.type || 'ROUTINE', i.result || 'PASS', i.issues || ''],
  );
  const [rows] = await pool.query('SELECT * FROM inspections WHERE id = ?', [r.insertId]);
  return mapInspection(rows[0]);
}

async function updateProjectSpatial(id, spatialData) {
  const { longitude, latitude, boundaryPoints, serviceRadius } = spatialData;

  const sets = [];
  const params = [];

  if (longitude !== undefined) { sets.push('longitude = ?'); params.push(longitude); }
  if (latitude !== undefined) { sets.push('latitude = ?'); params.push(latitude); }
  if (longitude !== undefined && latitude !== undefined) {
    sets.push('location = ST_PointFromText(?, 4326)');
    params.push(pointToWKT(latitude, longitude));
  }
  if (boundaryPoints !== undefined) {
    if (boundaryPoints === null) {
      sets.push('boundary = NULL');
    } else {
      const wkt = polygonToWKT(boundaryPoints);
      if (wkt) {
        sets.push('boundary = ST_PolygonFromText(?, 4326)');
        params.push(wkt);
      }
    }
  }
  if (serviceRadius !== undefined) { sets.push('service_radius = ?'); params.push(serviceRadius); }

  if (sets.length === 0) return getProject(id);

  sets.push('updated_at = CURRENT_TIMESTAMP(3)');
  params.push(id);

  await pool.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, params);
  return getProject(id);
}

module.exports = {
  seed, isEmpty,
  findUserByUsername, getUser, listUsers, createUser,
  listProjects, getProject, findProjectByCode, createProject, updateProject, deleteProject,
  listEquipments, createEquipment,
  listInspections, createInspection,
  listProjectsByBoundingBox,
  listProjectsByCircle,
  findNearbyProjects,
  getDistrictStats,
  getCitySummary,
  getDistanceToNearestProject,
  analyzeCoverageBlindArea,
  updateProjectSpatial,
};
