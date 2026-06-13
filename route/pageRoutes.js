const express = require('express');
const path = require('path');
const { requirePageAuth } = require('./session');

const router = express.Router();
const htmlDir = path.join(__dirname, '..', 'public', 'html');

router.get('/', (req, res) => {
  res.sendFile(path.join(htmlDir, 'index.html'));
});

router.get('/signin', (req, res) => {
  res.sendFile(path.join(htmlDir, 'signin.html'));
});

router.get('/signup', (req, res) => {
  res.sendFile(path.join(htmlDir, 'signup.html'));
});

router.get('/main', requirePageAuth, (req, res) => {
  res.sendFile(path.join(htmlDir, 'main.html'));
});

module.exports = router;
