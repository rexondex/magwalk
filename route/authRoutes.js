const crypto = require('crypto');
const express = require('express');
const { createUser, findUserByUsername } = require('../db/db');
const { clearSession, requireAuth, setSession } = require('./session');

const router = express.Router();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

router.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/api/signup', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({ message: 'ID must be 3-24 chars: a-z, 0-9, _' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 chars.' });
    }

    const existingUser = await findUserByUsername(username);

    if (existingUser) {
      return res.status(409).json({ message: 'ID already exists.' });
    }

    const passwordData = hashPassword(password);
    const user = await createUser({
      id: crypto.randomUUID(),
      username,
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
    });

    setSession(res, user);
    return res.status(201).json({ user: { id: user.id, username: user.username } });
  } catch (error) {
    return next(error);
  }
});

router.post('/api/signin', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const user = await findUserByUsername(username);

    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return res.status(401).json({ message: 'Invalid ID or password.' });
    }

    setSession(res, user);
    return res.json({ user: { id: user.id, username: user.username } });
  } catch (error) {
    return next(error);
  }
});

router.post('/api/signout', (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

module.exports = router;
