'use strict';

/**
 * 数据仓储层 - 基于 MySQL（mysql2/promise）。
 * 所有方法 async，返回 camelCase 字段对象。
 */

const { pool } = require('../db');
const { hashPassword } = require('../utils/password');

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

function mapProject(r) {
  if (!r) return null;
  return {
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
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

    await conn.query(
      `INSERT INTO projects (id, code, name, type, protection_level, area_sqm, address, district, peacetime_use, status, completed_at) VALUES
        (1, 'RF-2024-001', '中心广场地下人防工程', 'COMBINED', '6', 8600.50, '人民中路1号地下', '城关区', '地下停车场', 'NORMAL', '2018-09-01'),
        (2, 'RF-2024-002', '滨江路防空地下室', 'BASEMENT', '6B', 3200.00, '滨江路88号', '江南区', '商业仓储', 'NORMAL', '2020-05-15'),
        (3, 'RF-2024-003', '老城区单建掘开式工程', 'SINGLE', '5', 5400.00, '解放街地下', '城关区', '暂未利用', 'MAINTENANCE', '2010-03-20'),
        (4, 'RF-2024-004', '科技园人员掩蔽所', 'SHELTER', '6', 2100.00, '科技大道12号地下', '高新区', '社区活动中心', 'NORMAL', '2021-11-30')`,
    );

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
  const [rows] = await pool.query(`SELECT * FROM projects ${clause} ORDER BY id`, params);
  return rows.map(mapProject);
}

async function getProject(id) {
  const [rows] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
  return mapProject(rows[0]);
}

async function findProjectByCode(code) {
  const [rows] = await pool.query('SELECT * FROM projects WHERE code = ?', [code]);
  return mapProject(rows[0]);
}

async function createProject(p) {
  const [r] = await pool.query(
    `INSERT INTO projects (code, name, type, protection_level, area_sqm, address, district, peacetime_use, status, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.code, p.name, p.type || 'COMBINED', p.protectionLevel || '6', p.areaSqm || 0,
     p.address || '', p.district || '', p.peacetimeUse || '', p.status || 'NORMAL', p.completedAt || null],
  );
  return getProject(r.insertId);
}

async function updateProject(id, patch) {
  const map = {
    name: 'name', type: 'type', protectionLevel: 'protection_level', areaSqm: 'area_sqm',
    address: 'address', district: 'district', peacetimeUse: 'peacetime_use',
    status: 'status', completedAt: 'completed_at',
  };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { sets.push(`${col} = ?`); params.push(patch[k]); }
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

module.exports = {
  seed, isEmpty,
  findUserByUsername, getUser, listUsers, createUser,
  listProjects, getProject, findProjectByCode, createProject, updateProject, deleteProject,
  listEquipments, createEquipment,
  listInspections, createInspection,
};
