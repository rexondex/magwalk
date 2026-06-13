const crypto = require('crypto');

const sessions = new Map();

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, item) => {
    const [rawName, ...rawValue] = item.trim().split('=');

    if (rawName) {
      cookies[rawName] = decodeURIComponent(rawValue.join('='));
    }

    return cookies;
  }, {});
}

function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.magwalk_session ? sessions.get(cookies.magwalk_session) : null;
}

function setSession(res, user) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    id: user.id,
    username: user.username,
  });

  res.setHeader(
    'Set-Cookie',
    `magwalk_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
  );
}

function clearSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);

  if (cookies.magwalk_session) {
    sessions.delete(cookies.magwalk_session);
  }

  res.setHeader('Set-Cookie', 'magwalk_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);

  if (!user) {
    return res.status(401).json({ message: 'signin required' });
  }

  req.user = user;
  return next();
}

function requirePageAuth(req, res, next) {
  const user = getSessionUser(req);

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
