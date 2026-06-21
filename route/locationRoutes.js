const crypto = require('crypto');
const express = require('express');
const { getLocationLogs, saveLocationLogs } = require('../db/db');
const { requireAuth } = require('./session');

const router = express.Router();
const LOCATION_BATCH_LIMIT = 1000;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_REASONABLE_ACCURACY_METERS = 100000;
const MAX_LOCATION_FUTURE_SKEW_MS = 10 * 60 * 1000;
const MAX_LOCATION_BACKFILL_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeLocationId(id) {
  const value = String(id || '').trim();

  if (!value) {
    return crypto.randomUUID();
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return value.toLowerCase();
  }

  return null;
}

function normalizeAccuracy(value) {
  if (value === null || value === undefined || value === '') {
    return { isValid: true, value: null };
  }

  const accuracy = Number(value);

  if (
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > MAX_REASONABLE_ACCURACY_METERS
  ) {
    return { isValid: false, value: null };
  }

  return { isValid: true, value: accuracy };
}

function normalizeCollectedAt(value) {
  const collectedAt = value ? new Date(value) : new Date();
  const collectedTime = collectedAt.getTime();
  const now = Date.now();

  if (
    Number.isNaN(collectedTime) ||
    collectedTime > now + MAX_LOCATION_FUTURE_SKEW_MS ||
    collectedTime < now - MAX_LOCATION_BACKFILL_AGE_MS
  ) {
    return null;
  }

  return collectedAt.toISOString();
}

function normalizeLocationPayload(payload) {
  const id = normalizeLocationId(payload.id);
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const accuracy = normalizeAccuracy(payload.accuracy);
  const collectedAt = normalizeCollectedAt(payload.collectedAt);

  if (
    !id ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    !accuracy.isValid ||
    !collectedAt
  ) {
    return null;
  }

  return {
    id,
    latitude,
    longitude,
    accuracy: accuracy.value,
    collectedAt,
    userAgent: String(payload.userAgent || '').slice(0, MAX_USER_AGENT_LENGTH),
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

  const accepted = [];
  const rejectedIds = [];

  locations.slice(0, LOCATION_BATCH_LIMIT).forEach((location) => {
    const normalizedLocation = normalizeLocationPayload(location || {});

    if (normalizedLocation) {
      accepted.push(normalizedLocation);
      return;
    }

    if (location?.id) {
      rejectedIds.push(String(location.id));
    }
  });

  return {
    accepted,
    rejectedIds,
    rejectedCount: Math.min(locations.length, LOCATION_BATCH_LIMIT) - accepted.length,
    truncatedCount: Math.max(locations.length - LOCATION_BATCH_LIMIT, 0),
  };
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
      return res.status(400).json({ message: 'valid latitude, longitude, accuracy, and collection time are required.' });
    }

    const savedLocationLogs = await saveLocationLogs([locationLog], req.user);

    if (!savedLocationLogs[0]) {
      return res.status(409).json({ message: 'duplicate location id ignored.' });
    }

    return res.status(201).json(savedLocationLogs[0]);
  } catch (error) {
    return next(error);
  }
});

router.post('/api/location/bulk', requireAuth, async (req, res, next) => {
  try {
    const batch = normalizeLocationBatchPayload(req.body || {});

    if (!batch) {
      return res.status(400).json({ message: 'valid location records are required.' });
    }

    if (!batch.accepted.length) {
      return res.status(batch.rejectedCount ? 202 : 400).json({
        saved: [],
        acceptedIds: [],
        rejectedIds: batch.rejectedIds,
        rejectedCount: batch.rejectedCount,
        truncatedCount: batch.truncatedCount,
      });
    }

    const savedLocationLogs = await saveLocationLogs(batch.accepted, req.user);
    return res.status(201).json({
      saved: savedLocationLogs,
      acceptedIds: batch.accepted.map((locationLog) => locationLog.id),
      rejectedIds: batch.rejectedIds,
      rejectedCount: batch.rejectedCount,
      truncatedCount: batch.truncatedCount,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
