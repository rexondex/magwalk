const crypto = require('crypto');
const { createSession, deleteSession, findSessionUser } = require('../db/db');

const SESSION_COOKIE_NAME = 'magwalk_session';
const SESSION_MAX_AGE_DAYS = Math.max(Number(process.env.MAGWALK_SESSION_DAYS) || 30, 1);
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * SESSION_MAX_AGE_DAYS;

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, item) => {
    const [rawName, ...rawValue] = item.trim().split('=');

    if (rawName) {
      cookies[rawName] = decodeURIComponent(rawValue.join('='));
    }

    return cookies;
  }, {});
}

function sessionCookieOptions(maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

async function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] ? findSessionUser(cookies[SESSION_COOKIE_NAME]) : null;
}

async function setSession(res, user) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  await createSession(sessionId, user, expiresAt);

  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; ${sessionCookieOptions(SESSION_MAX_AGE_SECONDS)}`
  );
}

async function clearSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);

  if (cookies[SESSION_COOKIE_NAME]) {
    await deleteSession(cookies[SESSION_COOKIE_NAME]);
  }

  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; ${sessionCookieOptions(0)}`);
}

async function requireAuth(req, res, next) {
  let user;

  try {
    user = await getSessionUser(req);
  } catch (error) {
    return next(error);
  }

  if (!user) {
    return res.status(401).json({ message: 'signin required' });
  }

  req.user = user;
  return next();
}

async function requirePageAuth(req, res, next) {
  let user;

  try {
    user = await getSessionUser(req);
  } catch (error) {
    return next(error);
  }

  if (!user) {
    return res.redirect('/signin');
  }

  req.user = user;
  return next();
}

module.exports = {
  clearSession,
  getSessionUser,
  requireAuth,
  requirePageAuth,
  setSession,
};
