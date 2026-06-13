const crypto = require('crypto');
const express = require('express');
const { getLocationLogs, saveLocationLogs } = require('../db/db');
const { requireAuth } = require('./session');

const router = express.Router();

function normalizeLocationPayload(payload) {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const accuracy = Number(payload.accuracy);
  const collectedAt = payload.collectedAt ? new Date(payload.collectedAt) : new Date();

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Number.isNaN(collectedAt.getTime())) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    collectedAt: collectedAt.toISOString(),
    userAgent: String(payload.userAgent || ''),
  };
}

router.get('/api/location', requireAuth, async (req, res, next) => {
  try {
    const logs = await getLocationLogs(req.user);
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
    return res.status(201).json(savedLocationLogs[0]);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
