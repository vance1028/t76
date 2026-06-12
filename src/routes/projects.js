'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendError, isNonEmptyString, toPositiveInt, toFloat } = require('../utils/http');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const VALID_STATUS = ['NORMAL', 'MAINTENANCE', 'DECOMMISSIONED'];

function validateSpatialFields(b, allowPartial = true) {
  const result = { valid: true, errors: [], data: {} };

  if (b.longitude !== undefined) {
    const lng = toFloat(b.longitude);
    if (lng === null || lng < -180 || lng > 180) {
      result.errors.push('经度范围应在-180到180之间');
    } else {
      result.data.longitude = lng;
    }
  }
  if (b.latitude !== undefined) {
    const lat = toFloat(b.latitude);
    if (lat === null || lat < -90 || lat > 90) {
      result.errors.push('纬度范围应在-90到90之间');
    } else {
      result.data.latitude = lat;
    }
  }

  const hasLng = b.longitude !== undefined;
  const hasLat = b.latitude !== undefined;
  if (hasLng !== hasLat && !allowPartial) {
    result.errors.push('经度和纬度必须同时提供');
  }

  if (b.boundaryPoints !== undefined) {
    if (b.boundaryPoints === null) {
      result.data.boundaryPoints = null;
    } else if (Array.isArray(b.boundaryPoints) && b.boundaryPoints.length >= 3) {
      for (let i = 0; i < b.boundaryPoints.length; i++) {
        const p = b.boundaryPoints[i];
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') {
          result.errors.push(`轮廓点[${i}]格式错误，应为 {lat: number, lng: number}`);
          break;
        }
      }
      if (!result.errors.length) {
        result.data.boundaryPoints = b.boundaryPoints;
      }
    } else {
      result.errors.push('轮廓多边形至少需要3个点');
    }
  }

  if (b.serviceRadius !== undefined) {
    const r = toPositiveInt(b.serviceRadius);
    if (r === null || r < 10 || r > 5000) {
      result.errors.push('服务半径应在10-5000米之间');
    } else {
      result.data.serviceRadius = r;
    }
  }

  result.valid = result.errors.length === 0;
  return result;
}

// 所有工程接口都要登录
router.use(authRequired);

// 列表（支持 status / district / keyword 筛选）
router.get('/', wrap(async (req, res) => {
  const { status, district, keyword } = req.query;
  const filters = {};
  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) return sendError(res, 400, '无效的工程状态');
    filters.status = status;
  }
  if (isNonEmptyString(district)) filters.district = district.trim();
  if (isNonEmptyString(keyword)) filters.keyword = keyword.trim();
  const list = await store.listProjects(filters);
  res.json({ data: list, total: list.length });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  const p = await store.getProject(id);
  if (!p) return sendError(res, 404, '人防工程不存在');
  res.json({ data: p });
}));

// 新建工程（管理员/工程管理员可建）
router.post('/', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.code)) return sendError(res, 400, '工程编号不能为空');
  if (!isNonEmptyString(b.name)) return sendError(res, 400, '工程名称不能为空');
  if (b.status !== undefined && !VALID_STATUS.includes(b.status)) {
    return sendError(res, 400, '无效的工程状态');
  }

  const spatialValidation = validateSpatialFields(b, true);
  if (!spatialValidation.valid) {
    return sendError(res, 400, spatialValidation.errors.join('；'));
  }

  if (await store.findProjectByCode(b.code.trim())) {
    return sendError(res, 409, '工程编号已存在');
  }

  const projectData = {
    ...b,
    code: b.code.trim(),
    name: b.name.trim(),
    ...spatialValidation.data,
  };
  const p = await store.createProject(projectData);
  res.status(201).json({ data: p });
}));

// 更新工程
router.put('/:id', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  if (!(await store.getProject(id))) return sendError(res, 404, '人防工程不存在');
  const b = req.body || {};
  if (b.name !== undefined && !isNonEmptyString(b.name)) return sendError(res, 400, '工程名称不能为空');
  if (b.status !== undefined && !VALID_STATUS.includes(b.status)) {
    return sendError(res, 400, '无效的工程状态');
  }

  const spatialValidation = validateSpatialFields(b, true);
  if (!spatialValidation.valid) {
    return sendError(res, 400, spatialValidation.errors.join('；'));
  }

  const updateData = { ...b, ...spatialValidation.data };
  const updated = await store.updateProject(id, updateData);
  res.json({ data: updated });
}));

// 删除工程（仅管理员）
router.delete('/:id', requireRole('ADMIN'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  if (!(await store.getProject(id))) return sendError(res, 404, '人防工程不存在');
  await store.deleteProject(id);
  res.status(204).end();
}));

/* ---------- 工程下的设备设施 ---------- */

router.get('/:id/equipments', wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  if (!(await store.getProject(id))) return sendError(res, 404, '人防工程不存在');
  res.json({ data: await store.listEquipments(id) });
}));

router.post('/:id/equipments', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');
  if (!(await store.getProject(id))) return sendError(res, 404, '人防工程不存在');
  const b = req.body || {};
  if (!isNonEmptyString(b.name)) return sendError(res, 400, '设备名称不能为空');
  const e = await store.createEquipment({ ...b, projectId: id, name: b.name.trim() });
  res.status(201).json({ data: e });
}));

module.exports = router;
