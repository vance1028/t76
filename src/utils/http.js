'use strict';

function sendError(res, status, message, details) {
  const body = { error: { message } };
  if (details !== undefined) body.error.details = details;
  return res.status(status).json(body);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function toPositiveInt(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isValidDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !Number.isNaN(new Date(v + 'T00:00:00Z').getTime());
}

module.exports = { sendError, isNonEmptyString, toPositiveInt, isValidDate };
