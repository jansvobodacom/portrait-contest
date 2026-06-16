const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const mailer = require('../mailer');

// Rate limiting – max 5 přihlášek za hodinu z jedné IP
const rateLimit = {};
function checkRateLimit(ip) {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  if (!rateLimit[ip]) rateLimit[ip] = [];
  rateLimit[ip] = rateLimit[ip].filter(t => now - t < hour);
  if (rateLimit[ip].length >= 5) return false;
  rateLimit[ip].push(now);
  return true;
}

// Multer
const upload = multer({
  dest: 'tmp/',
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Povoleny jsou pouze JPG, PNG a WebP.'));
  }
});

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// Formátování data: 2026-06-15 → 15. 6. 2026
function formatDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  if (!y || !m || !d) return str;
  return `${parseInt(d)}. ${parseInt(m)}. ${y}`;
}

// ── Domovská stránka ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const settings = getSettings();
  let entries = [];
  if (settings.phase === 'voting' || settings.phase === 'results') {
    entries = db.prepare(
      "SELECT id, photo, votes, anon_number FROM entries WHERE status = 'approved' ORDER BY votes DESC, created_at ASC"
    ).all();
    // Náhodné pořadí pokud je zapnuto
    if (settings.gallery_random === '1' && settings.phase === 'voting') {
      entries = entries.sort(() => Math.random() - 0.5);
    }
  }
  res.render('home', {
    settings, entries, formatDate,
    votedFor: req.session.votedFor || null,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// ── Odeslání přihlášky ───────────────────────────────────────────────────────
router.post('/prihlasit', upload.single('photo'), async (req, res) => {
  const settings = getSettings();
  if (settings.phase !== 'registration') {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.redirect('/?error=Přihlašování+je+uzavřeno');
  }
  // Rate limiting
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.redirect('/?error=Příliš+mnoho+přihlášek+z+jedné+adresy.+Zkuste+to+za+hodinu.');
  }
  const { name, email, note } = req.body;
  if (!name || !email || !req.file) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.redirect('/?error=Vyplňte+všechna+povinná+pole+včetně+fotografie');
  }
  const existing = db.prepare('SELECT id FROM entries WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    fs.unlinkSync(req.file.path);
    return res.redirect('/?error=Tento+e-mail+je+již+přihlášen.+Každý+může+přihlásit+pouze+jednu+fotografii.');
  }
  try {
    const UPLOADS_DIR = req.app.locals.UPLOADS_DIR;
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const outPath = path.join(UPLOADS_DIR, filename);
    try {
      const sharp = require('sharp');
      await sharp(req.file.path).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(outPath);
    } catch { fs.copyFileSync(req.file.path, outPath); }
    fs.unlinkSync(req.file.path);
    db.prepare('INSERT INTO entries (name, email, note, photo, ip) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), note?.trim() || '', filename, ip);
    try { await mailer.sendConfirmation(email, name); } catch {}
    res.redirect('/?success=Přihláška+odeslána!+Čeká+na+schválení.');
  } catch (err) {
    console.error(err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.redirect('/?error=Chyba+při+nahrávání+fotografie');
  }
});

// ── Galerie ──────────────────────────────────────────────────────────────────
router.get('/galerie', (req, res) => {
  const settings = getSettings();
  // Blokovat galerii pokud není fáze hlasování nebo výsledků
  if (settings.phase === 'registration') {
    return res.render('blocked', { settings, formatDate, message: 'Galerie bude dostupná po spuštění hlasování.' });
  }
  let entries = db.prepare(
    "SELECT id, photo, votes, anon_number FROM entries WHERE status = 'approved' ORDER BY votes DESC, created_at ASC"
  ).all();
  if (settings.gallery_random === '1' && settings.phase === 'voting') {
    entries = entries.sort(() => Math.random() - 0.5);
  }
  res.render('gallery', {
    settings, entries, formatDate,
    voterEmail: req.session.voterEmail || null,
    votedFor: req.session.votedFor || null
  });
});

// ── Hlasování (AJAX POST) ────────────────────────────────────────────────────
router.post('/hlasovat', (req, res) => {
  const { entry_id, voter_email } = req.body;
  const settings = getSettings();
  if (settings.phase !== 'voting') return res.json({ ok: false, error: 'Hlasování není aktuálně otevřeno.' });
  const email = (voter_email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ ok: false, error: 'Zadejte platný e-mail.' });
  const id = parseInt(entry_id);
  const entry = db.prepare("SELECT id FROM entries WHERE id = ? AND status = 'approved'").get(id);
  if (!entry) return res.json({ ok: false, error: 'Příspěvek nenalezen.' });
  const existingVote = db.prepare('SELECT entry_id FROM votes WHERE voter_email = ?').get(email);
  if (existingVote) {
    if (existingVote.entry_id === id) {
      const voted = db.prepare('SELECT anon_number FROM entries WHERE id = ?').get(existingVote.entry_id);
      return res.json({ ok: false, error: `Z tohoto e-mailu již byl odevzdán hlas pro Zadečka č. ${voted ? voted.anon_number : '?'}. Chcete změnit svůj hlas na tohoto účastníka?`, canSwitch: true, oldEntryId: existingVote.entry_id });
    }
    db.prepare('UPDATE entries SET votes = MAX(0, votes - 1) WHERE id = ?').run(existingVote.entry_id);
    db.prepare('UPDATE votes SET entry_id = ? WHERE voter_email = ?').run(id, email);
    db.prepare('UPDATE entries SET votes = votes + 1 WHERE id = ?').run(id);
    req.session.voterEmail = email;
    req.session.votedFor = id;
    const votes = db.prepare('SELECT votes FROM entries WHERE id = ?').get(id).votes;
    return res.json({ ok: true, votes, oldEntryId: existingVote.entry_id });
  }
  db.prepare('INSERT INTO votes (entry_id, voter_email, voter_ip) VALUES (?, ?, ?)').run(id, email, req.ip || '');
  db.prepare('UPDATE entries SET votes = votes + 1 WHERE id = ?').run(id);
  req.session.voterEmail = email;
  req.session.votedFor = id;
  const votes = db.prepare('SELECT votes FROM entries WHERE id = ?').get(id).votes;
  res.json({ ok: true, votes, oldEntryId: null });
});

// ── Výsledky (jen po skončení hlasování) ─────────────────────────────────────
router.get('/vysledky', (req, res) => {
  const settings = getSettings();
  if (settings.phase !== 'results') {
    return res.render('blocked', { settings, formatDate, message: 'Výsledky budou zveřejněny po ukončení hlasování.' });
  }
  const entries = db.prepare("SELECT id, photo, votes, anon_number FROM entries WHERE status = 'approved' ORDER BY votes DESC").all();
  res.render('results', { settings, entries, formatDate });
});

// ── Přehlasování (vynutit změnu hlasu) ──────────────────────────────────────
router.post('/hlasovat-prepsat', (req, res) => {
  const { entry_id, voter_email } = req.body;
  const settings = getSettings();
  if (settings.phase !== 'voting') return res.json({ ok: false, error: 'Hlasování není otevřeno.' });
  const email = (voter_email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ ok: false, error: 'Zadejte platný e-mail.' });
  const id = parseInt(entry_id);
  const entry = db.prepare("SELECT id FROM entries WHERE id = ? AND status = 'approved'").get(id);
  if (!entry) return res.json({ ok: false, error: 'Příspěvek nenalezen.' });
  const existingVote = db.prepare('SELECT entry_id FROM votes WHERE voter_email = ?').get(email);
  if (existingVote) {
    db.prepare('UPDATE entries SET votes = MAX(0, votes - 1) WHERE id = ?').run(existingVote.entry_id);
    db.prepare('UPDATE votes SET entry_id = ? WHERE voter_email = ?').run(id, email);
  } else {
    db.prepare('INSERT INTO votes (entry_id, voter_email, voter_ip) VALUES (?, ?, ?)').run(id, email, req.ip || '');
  }
  db.prepare('UPDATE entries SET votes = votes + 1 WHERE id = ?').run(id);
  req.session.voterEmail = email;
  req.session.votedFor = id;
  const votes = db.prepare('SELECT votes FROM entries WHERE id = ?').get(id).votes;
  res.json({ ok: true, votes, oldEntryId: existingVote?.entry_id || null });
});

// ── Pravidla ──────────────────────────────────────────────────────────────────
router.get('/pravidla', (req, res) => {
  const settings = getSettings();
  res.render('rules', { settings, formatDate });
});

// ── Sdílení ───────────────────────────────────────────────────────────────────
router.get('/ucastnik/:id', (req, res) => {
  const settings = getSettings();
  const entry = db.prepare("SELECT id, photo, votes, anon_number FROM entries WHERE id = ? AND status = 'approved'").get(req.params.id);
  if (!entry) return res.redirect('/galerie');
  res.render('share', { settings, entry, formatDate, appUrl: process.env.APP_URL || '' });
});

module.exports = router;
