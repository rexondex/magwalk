const express = require('express');
const path = require('path');
const { initializeDatabase } = require('./db/db');
const authRoutes = require('./route/authRoutes');
const locationRoutes = require('./route/locationRoutes');
const pageRoutes = require('./route/pageRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(pageRoutes);
app.use(authRoutes);
app.use(locationRoutes);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: 'Internal server error.' });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
