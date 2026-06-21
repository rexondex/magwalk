const crypto = require('crypto');
const express = require('express');
const { getLocationLogs, saveLocationLogs } = require('../db/db');
const { requireAuth } = require('./session');

const router = express.Router();
const LOCATION_BATCH_LIMIT = 1000;

function normalizeLocationId(id) {
  const value = String(id || '').trim();

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return value;
  }

  return crypto.randomUUID();
}

function normalizeLocationPayload(payload) {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const accuracy = Number(payload.accuracy);
  const collectedAt = payload.collectedAt ? new Date(payload.collectedAt) : new Date();

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Number.isNaN(collectedAt.getTime())) {
    return null;
  }

  return {
    id: normalizeLocationId(payload.id),
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    collectedAt: collectedAt.toISOString(),
    userAgent: String(payload.userAgent || ''),
  };
}

function normalizeLocationFilters(query) {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  const limit = query.limit ? Number(query.limit) : 500;

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return null;
  }

  if (from && to && from > to) {
    return null;
  }

  return {
    from: from ? from.toISOString() : null,
    to: to ? to.toISOString() : null,
    limit: Number.isFinite(limit) ? limit : 500,
  };
}

function normalizeLocationBatchPayload(payload) {
  const locations = Array.isArray(payload) ? payload : payload.locations;

  if (!Array.isArray(locations)) {
    return null;
  }

  return locations
    .slice(0, LOCATION_BATCH_LIMIT)
    .map((location) => normalizeLocationPayload(location || {}))
    .filter(Boolean);
}

router.get('/api/location', requireAuth, async (req, res, next) => {
  try {
    const filters = normalizeLocationFilters(req.query || {});

    if (!filters) {
      return res.status(400).json({ message: 'Invalid location history filter.' });
    }

    const logs = await getLocationLogs(req.user, filters);
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

router.post('/api/location', requireAuth, async (req, res, next) => {
  try {
    const locationLog = normalizeLocationPayload(req.body || {});

    if (!locationLog) {
      return res.status(400).json({ message: 'latitude and longitude are required.' });
    }

    const savedLocationLogs = await saveLocationLogs([locationLog], req.user);
    return res.status(savedLocationLogs[0] ? 201 : 200).json(savedLocationLogs[0] || locationLog);
  } catch (error) {
    return next(error);
  }
});

router.post('/api/location/bulk', requireAuth, async (req, res, next) => {
  try {
    const locationLogs = normalizeLocationBatchPayload(req.body || {});

    if (!locationLogs || !locationLogs.length) {
      return res.status(400).json({ message: 'valid location records are required.' });
    }

    const savedLocationLogs = await saveLocationLogs(locationLogs, req.user);
    return res.status(201).json({
      saved: savedLocationLogs,
      acceptedIds: locationLogs.map((locationLog) => locationLog.id),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
