const express = require('express');
const path = require('path');
const { getSessionUser, requirePageAuth } = require('./session');

const router = express.Router();
const htmlDir = path.join(__dirname, '..', 'public', 'html');

router.get('/', redirectSignedInUser, (req, res) => {
  res.sendFile(path.join(htmlDir, 'index.html'));
});

async function redirectSignedInUser(req, res, next) {
  try {
    const user = await getSessionUser(req);

    if (user) {
      return res.redirect('/main');
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

router.get('/signin', redirectSignedInUser, (req, res) => {
  res.sendFile(path.join(htmlDir, 'signin.html'));
});

router.get('/signup', redirectSignedInUser, (req, res) => {
  res.sendFile(path.join(htmlDir, 'signup.html'));
});

router.get('/main', requirePageAuth, (req, res) => {
  res.sendFile(path.join(htmlDir, 'main.html'));
});

module.exports = router;
