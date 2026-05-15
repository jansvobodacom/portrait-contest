require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Složka pro uploady:
// - Na Railway: /data/uploads (persistentní volume)
// - Lokálně: public/uploads
const UPLOADS_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'uploads')
  : path.join(__dirname, 'public/uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Exportuj cestu pro routes
app.locals.UPLOADS_DIR = UPLOADS_DIR;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Na Railway: servi uploady z /data/uploads přes /uploads URL
if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  app.use('/uploads', express.static(UPLOADS_DIR));
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Globální proměnné pro views
app.use((req, res, next) => {
  res.locals.isAdmin = req.session.isAdmin || false;
  res.locals.votedFor = req.session.votedFor || null;
  next();
});

// Routes
app.use('/', require('./routes/public'));
app.use('/admin', require('./routes/admin'));

app.listen(PORT, () => {
  console.log(`\n🎉 Soutěž spuštěna na http://localhost:${PORT}`);
  console.log(`📁 Uploady: ${UPLOADS_DIR}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin\n`);
});
