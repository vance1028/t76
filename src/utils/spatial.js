'use strict';

/**
 * 空间计算工具函数
 * - 球面距离计算（Haversine公式）
 * - 点在多边形内判定（射线法）
 * - 范围相交判定
 * - GeoJSON/WKT 格式转换
 */

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg) {
  return deg * Math.PI / 180;
}

function toDeg(rad) {
  return rad * 180 / Math.PI;
}

/**
 * 计算两点之间的球面距离（Haversine公式）
 * 经纬度不能直接当平面算欧氏距离，地球是圆的
 * @param {number} lat1 点1纬度
 * @param {number} lng1 点1经度
 * @param {number} lat2 点2纬度
 * @param {number} lng2 点2经度
 * @returns {number} 距离（米）
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * 点是否在矩形范围内（含边界）
 * @param {number} lat 点纬度
 * @param {number} lng 点经度
 * @param {number} swLat 西南角纬度
 * @param {number} swLng 西南角经度
 * @param {number} neLat 东北角纬度
 * @param {number} neLng 东北角经度
 * @returns {boolean}
 */
function pointInBoundingBox(lat, lng, swLat, swLng, neLat, neLng) {
  return lat >= swLat && lat <= neLat && lng >= swLng && lng <= neLng;
}

/**
 * 点是否在圆形范围内（含边界）
 * 使用球面距离计算
 * @param {number} lat 点纬度
 * @param {number} lng 点经度
 * @param {number} centerLat 圆心纬度
 * @param {number} centerLng 圆心经度
 * @param {number} radiusMeters 半径（米）
 * @returns {boolean}
 */
function pointInCircle(lat, lng, centerLat, centerLng, radiusMeters) {
  const dist = haversineDistance(lat, lng, centerLat, centerLng);
  return dist <= radiusMeters;
}

/**
 * 射线法判定点是否在多边形内
 * @param {number} lat 点纬度
 * @param {number} lng 点经度
 * @param {Array<{lat: number, lng: number}>} polygon 多边形顶点数组，需闭合
 * @returns {boolean}
 */
function pointInPolygon(lat, lng, polygon) {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;

    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * 判断点是否在多边形边界上
 * @param {number} lat 点纬度
 * @param {number} lng 点经度
 * @param {Array<{lat: number, lng: number}>} polygon 多边形顶点数组
 * @param {number} toleranceMeters 容差（米）
 * @returns {boolean}
 */
function pointOnPolygonBoundary(lat, lng, polygon, toleranceMeters = 1) {
  if (!polygon || polygon.length < 2) return false;

  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dist = pointToSegmentDistance(
      lat, lng,
      polygon[i].lat, polygon[i].lng,
      polygon[j].lat, polygon[j].lng
    );
    if (dist <= toleranceMeters) return true;
  }
  return false;
}

/**
 * 点到线段的最短球面距离
 * @param {number} lat 点纬度
 * @param {number} lng 点经度
 * @param {number} lat1 线段端点1纬度
 * @param {number} lng1 线段端点1经度
 * @param {number} lat2 线段端点2纬度
 * @param {number} lng2 线段端点2经度
 * @returns {number} 距离（米）
 */
function pointToSegmentDistance(lat, lng, lat1, lng1, lat2, lng2) {
  const d1 = haversineDistance(lat, lng, lat1, lng1);
  const d2 = haversineDistance(lat, lng, lat2, lng2);
  const d3 = haversineDistance(lat1, lng1, lat2, lng2);

  if (d3 === 0) return Math.min(d1, d2);

  if (d1 * d1 >= d2 * d2 + d3 * d3) return d2;
  if (d2 * d2 >= d1 * d1 + d3 * d3) return d1;

  const s = (d1 + d2 + d3) / 2;
  const area = Math.sqrt(s * (s - d1) * (s - d2) * (s - d3));
  return 2 * area / d3;
}

/**
 * 判断两个矩形是否相交
 * @param {Object} bbox1 {swLat, swLng, neLat, neLng}
 * @param {Object} bbox2 {swLat, swLng, neLat, neLng}
 * @returns {boolean}
 */
function boundingBoxIntersect(bbox1, bbox2) {
  return !(
    bbox1.neLat < bbox2.swLat ||
    bbox1.swLat > bbox2.neLat ||
    bbox1.neLng < bbox2.swLng ||
    bbox1.swLng > bbox2.neLng
  );
}

/**
 * 获取多边形的外接矩形（MBR - Minimum Bounding Rectangle）
 * 空间索引的关键：先通过 MBR 粗筛，再精确判定
 * @param {Array<{lat: number, lng: number}>} polygon
 * @returns {Object} {swLat, swLng, neLat, neLng}
 */
function getBoundingBox(polygon) {
  if (!polygon || polygon.length === 0) return null;

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const p of polygon) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  return { swLat: minLat, swLng: minLng, neLat: maxLat, neLng: maxLng };
}

/**
 * 判断多边形与矩形范围是否相交
 * 策略：先 MBR 粗筛，再逐边检测，最后看点是否在内部
 * @param {Array<{lat: number, lng: number}>} polygon
 * @param {Object} bbox {swLat, swLng, neLat, neLng}
 * @returns {boolean}
 */
function polygonIntersectsBoundingBox(polygon, bbox) {
  if (!polygon || polygon.length < 3) return false;

  const polyBbox = getBoundingBox(polygon);
  if (!boundingBoxIntersect(polyBbox, bbox)) return false;

  for (const p of polygon) {
    if (pointInBoundingBox(p.lat, p.lng, bbox.swLat, bbox.swLng, bbox.neLat, bbox.neLng)) {
      return true;
    }
  }

  const bboxCorners = [
    { lat: bbox.swLat, lng: bbox.swLng },
    { lat: bbox.neLat, lng: bbox.swLng },
    { lat: bbox.neLat, lng: bbox.neLng },
    { lat: bbox.swLat, lng: bbox.neLng },
  ];
  for (const corner of bboxCorners) {
    if (pointInPolygon(corner.lat, corner.lng, polygon)) return true;
  }

  return false;
}

/**
 * 判断多边形与圆形范围是否相交
 * @param {Array<{lat: number, lng: number}>} polygon
 * @param {number} centerLat 圆心纬度
 * @param {number} centerLng 圆心经度
 * @param {number} radiusMeters 半径（米）
 * @returns {boolean}
 */
function polygonIntersectsCircle(polygon, centerLat, centerLng, radiusMeters) {
  if (!polygon || polygon.length < 3) return false;

  if (pointInPolygon(centerLat, centerLng, polygon)) return true;

  for (const p of polygon) {
    if (pointInCircle(p.lat, p.lng, centerLat, centerLng, radiusMeters)) return true;
  }

  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dist = pointToSegmentDistance(
      centerLat, centerLng,
      polygon[i].lat, polygon[i].lng,
      polygon[j].lat, polygon[j].lng
    );
    if (dist <= radiusMeters) return true;
  }

  return false;
}

/**
 * 坐标点数组转 WKT POLYGON 格式
 * @param {Array<{lat: number, lng: number}>} polygon
 * @returns {string}
 */
function polygonToWKT(polygon) {
  if (!polygon || polygon.length < 3) return null;
  const points = polygon.map(p => `${p.lng} ${p.lat}`).join(', ');
  const first = `${polygon[0].lng} ${polygon[0].lat}`;
  return `POLYGON((${points}, ${first}))`;
}

/**
 * WKT POLYGON 转坐标点数组
 * @param {string} wkt
 * @returns {Array<{lat: number, lng: number}>}
 */
function wktToPolygon(wkt) {
  if (!wkt) return null;
  const match = wkt.match(/POLYGON\s*\(\((.*?)\)\)/i);
  if (!match) return null;
  const coordsStr = match[1].split(',');
  return coordsStr.map(s => {
    const [lng, lat] = s.trim().split(/\s+/).map(Number);
    return { lat, lng };
  }).filter(p => !isNaN(p.lat) && !isNaN(p.lng));
}

/**
 * 经纬度点转 WKT POINT 格式
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
function pointToWKT(lat, lng) {
  return `POINT(${lng} ${lat})`;
}

/**
 * 多边形坐标数组转 GeoJSON 格式
 * @param {Array<{lat: number, lng: number}>} polygon
 * @returns {Object} GeoJSON Polygon
 */
function polygonToGeoJSON(polygon) {
  if (!polygon || polygon.length < 3) return null;
  const coords = polygon.map(p => [p.lng, p.lat]);
  coords.push([polygon[0].lng, polygon[0].lat]);
  return {
    type: 'Polygon',
    coordinates: [coords],
  };
}

/**
 * GeoJSON Polygon 转坐标数组
 * @param {Object} geoJson
 * @returns {Array<{lat: number, lng: number}>}
 */
function geoJSONToPolygon(geoJson) {
  if (!geoJson || geoJson.type !== 'Polygon' || !geoJson.coordinates) return null;
  const coords = geoJson.coordinates[0];
  return coords.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
}

/**
 * 在指定中心点周围按距离和角度计算目标点
 * 用于生成测试用的多边形轮廓
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} distanceMeters
 * @param {number} bearingDegrees 方位角（0=正北，90=正东）
 * @returns {{lat: number, lng: number}}
 */
function destinationPoint(centerLat, centerLng, distanceMeters, bearingDegrees) {
  const δ = distanceMeters / EARTH_RADIUS_METERS;
  const θ = toRad(bearingDegrees);
  const φ1 = toRad(centerLat);
  const λ1 = toRad(centerLng);

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );

  return {
    lat: toDeg(φ2),
    lng: toDeg(λ2),
  };
}

/**
 * 生成矩形多边形（以中心点为中心，按米计算宽高）
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} widthMeters 东西方向宽度
 * @param {number} heightMeters 南北方向高度
 * @returns {Array<{lat: number, lng: number}>}
 */
function generateRectPolygon(centerLat, centerLng, widthMeters, heightMeters) {
  const halfW = widthMeters / 2;
  const halfH = heightMeters / 2;
  return [
    destinationPoint(centerLat, centerLng, Math.sqrt(halfW * halfW + halfH * halfH), 315),
    destinationPoint(centerLat, centerLng, Math.sqrt(halfW * halfW + halfH * halfH), 45),
    destinationPoint(centerLat, centerLng, Math.sqrt(halfW * halfW + halfH * halfH), 135),
    destinationPoint(centerLat, centerLng, Math.sqrt(halfW * halfW + halfH * halfH), 225),
  ];
}

module.exports = {
  EARTH_RADIUS_METERS,
  haversineDistance,
  pointInBoundingBox,
  pointInCircle,
  pointInPolygon,
  pointOnPolygonBoundary,
  pointToSegmentDistance,
  boundingBoxIntersect,
  getBoundingBox,
  polygonIntersectsBoundingBox,
  polygonIntersectsCircle,
  polygonToWKT,
  wktToPolygon,
  pointToWKT,
  polygonToGeoJSON,
  geoJSONToPolygon,
  destinationPoint,
  generateRectPolygon,
};
