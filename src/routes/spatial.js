'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendError, isNonEmptyString, toPositiveInt, toFloat } = require('../utils/http');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const VALID_STATUS = ['NORMAL', 'MAINTENANCE', 'DECOMMISSIONED'];

router.use(authRequired);

/**
 * 按矩形范围查询工程（地图视口查询）
 * GET /api/spatial/bbox?swLat=xx&swLng=xx&neLat=xx&neLng=xx&status=NORMAL&district=城关区
 * 地图拖动缩放时前端会频繁调用这个接口，靠空间索引支撑性能
 */
router.get('/bbox', wrap(async (req, res) => {
  const { swLat, swLng, neLat, neLng, status, district } = req.query;

  const swLatNum = toFloat(swLat);
  const swLngNum = toFloat(swLng);
  const neLatNum = toFloat(neLat);
  const neLngNum = toFloat(neLng);

  if (swLatNum === null || swLngNum === null || neLatNum === null || neLngNum === null) {
    return sendError(res, 400, '请提供有效的矩形范围坐标（swLat, swLng, neLat, neLng）');
  }
  if (swLatNum >= neLatNum || swLngNum >= neLngNum) {
    return sendError(res, 400, '矩形范围坐标顺序错误，应为西南角到东北角');
  }

  const filters = {};
  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) return sendError(res, 400, '无效的工程状态');
    filters.status = status;
  }
  if (isNonEmptyString(district)) filters.district = district.trim();

  const list = await store.listProjectsByBoundingBox(
    { swLat: swLatNum, swLng: swLngNum, neLat: neLatNum, neLng: neLngNum },
    filters
  );

  res.json({
    data: list,
    total: list.length,
    bbox: { swLat: swLatNum, swLng: swLngNum, neLat: neLatNum, neLng: neLngNum },
  });
}));

/**
 * 按圆形范围查询工程
 * GET /api/spatial/circle?centerLat=xx&centerLng=xx&radius=500&status=NORMAL
 */
router.get('/circle', wrap(async (req, res) => {
  const { centerLat, centerLng, radius, status, district } = req.query;

  const centerLatNum = toFloat(centerLat);
  const centerLngNum = toFloat(centerLng);
  const radiusNum = toPositiveInt(radius);

  if (centerLatNum === null || centerLngNum === null) {
    return sendError(res, 400, '请提供有效的圆心坐标（centerLat, centerLng）');
  }
  if (radiusNum === null || radiusNum <= 0) {
    return sendError(res, 400, '请提供有效的查询半径（米，正整数）');
  }
  if (radiusNum > 50000) {
    return sendError(res, 400, '查询半径不能超过50000米');
  }

  const filters = {};
  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) return sendError(res, 400, '无效的工程状态');
    filters.status = status;
  }
  if (isNonEmptyString(district)) filters.district = district.trim();

  const list = await store.listProjectsByCircle(
    centerLatNum, centerLngNum, radiusNum, filters
  );

  res.json({
    data: list,
    total: list.length,
    center: { lat: centerLatNum, lng: centerLngNum },
    radiusMeters: radiusNum,
  });
}));

/**
 * 邻近查询：找出指定点周边的人防工程
 * GET /api/spatial/nearby?lat=xx&lng=xx&radius=1000&limit=10
 */
router.get('/nearby', wrap(async (req, res) => {
  const { lat, lng, radius, limit, status } = req.query;

  const latNum = toFloat(lat);
  const lngNum = toFloat(lng);
  const radiusNum = toPositiveInt(radius) || 1000;
  const limitNum = toPositiveInt(limit) || 10;

  if (latNum === null || lngNum === null) {
    return sendError(res, 400, '请提供有效的查询点坐标（lat, lng）');
  }
  if (radiusNum <= 0 || radiusNum > 50000) {
    return sendError(res, 400, '查询半径应在1-50000米之间');
  }
  if (limitNum <= 0 || limitNum > 100) {
    return sendError(res, 400, '返回数量应在1-100之间');
  }

  const filters = {};
  if (status !== undefined) {
    if (!VALID_STATUS.includes(status)) return sendError(res, 400, '无效的工程状态');
    filters.status = status;
  }

  const list = await store.findNearbyProjects(
    latNum, lngNum, radiusNum, limitNum, filters
  );

  res.json({
    data: list,
    total: list.length,
    queryPoint: { lat: latNum, lng: lngNum },
    radiusMeters: radiusNum,
  });
}));

/**
 * 按行政区聚合统计
 * GET /api/spatial/stats/district
 */
router.get('/stats/district', wrap(async (req, res) => {
  const stats = await store.getDistrictStats();
  res.json({
    data: stats,
    totalDistricts: stats.length,
  });
}));

/**
 * 全市人防底数汇总
 * GET /api/spatial/stats/city
 */
router.get('/stats/city', wrap(async (req, res) => {
  const summary = await store.getCitySummary();
  res.json({ data: summary });
}));

/**
 * 查询某点到最近人防工程的距离
 * GET /api/spatial/nearest?lat=xx&lng=xx
 */
router.get('/nearest', wrap(async (req, res) => {
  const { lat, lng } = req.query;

  const latNum = toFloat(lat);
  const lngNum = toFloat(lng);

  if (latNum === null || lngNum === null) {
    return sendError(res, 400, '请提供有效的查询点坐标（lat, lng）');
  }

  const result = await store.getDistanceToNearestProject(latNum, lngNum);
  if (!result) {
    return res.json({ data: null, message: '未找到可用的人防工程' });
  }

  res.json({ data: result });
}));

/**
 * 人防覆盖盲区分析
 * POST /api/spatial/coverage/analyze
 * Body: {
 *   polygon: [{lat, lng}, ...],
 *   gridSizeMeters: 100
 * }
 */
router.post('/coverage/analyze', wrap(async (req, res) => {
  const { polygon, gridSizeMeters } = req.body || {};

  if (!Array.isArray(polygon) || polygon.length < 3) {
    return sendError(res, 400, '请提供有效的区域多边形（至少3个点）');
  }

  for (const p of polygon) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') {
      return sendError(res, 400, '多边形点格式错误，应为 {lat: number, lng: number}');
    }
  }

  const gridSize = toPositiveInt(gridSizeMeters) || 100;
  if (gridSize < 10 || gridSize > 500) {
    return sendError(res, 400, '网格间距应在10-500米之间');
  }

  const result = await store.analyzeCoverageBlindArea(polygon, gridSize);

  if (!result) {
    return sendError(res, 400, '区域分析失败');
  }

  res.json({ data: result });
}));

/**
 * 更新工程空间信息
 * PUT /api/spatial/project/:id
 * 需要管理员或工程管理员权限
 */
router.put('/project/:id', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const id = toPositiveInt(req.params.id);
  if (id === null) return sendError(res, 400, '无效的工程 ID');

  const project = await store.getProject(id);
  if (!project) return sendError(res, 404, '人防工程不存在');

  const b = req.body || {};
  const spatialData = {};

  if (b.longitude !== undefined) {
    const lng = toFloat(b.longitude);
    if (lng === null || lng < -180 || lng > 180) {
      return sendError(res, 400, '经度范围应在-180到180之间');
    }
    spatialData.longitude = lng;
  }
  if (b.latitude !== undefined) {
    const lat = toFloat(b.latitude);
    if (lat === null || lat < -90 || lat > 90) {
      return sendError(res, 400, '纬度范围应在-90到90之间');
    }
    spatialData.latitude = lat;
  }
  if (b.boundaryPoints !== undefined) {
    if (b.boundaryPoints === null) {
      spatialData.boundaryPoints = null;
    } else if (Array.isArray(b.boundaryPoints) && b.boundaryPoints.length >= 3) {
      for (const p of b.boundaryPoints) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') {
          return sendError(res, 400, '轮廓点格式错误');
        }
      }
      spatialData.boundaryPoints = b.boundaryPoints;
    } else {
      return sendError(res, 400, '轮廓多边形至少需要3个点');
    }
  }
  if (b.serviceRadius !== undefined) {
    const r = toPositiveInt(b.serviceRadius);
    if (r === null || r < 10 || r > 5000) {
      return sendError(res, 400, '服务半径应在10-5000米之间');
    }
    spatialData.serviceRadius = r;
  }

  const updated = await store.updateProjectSpatial(id, spatialData);
  res.json({ data: updated });
}));

module.exports = router;
