const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const mailer = require('../mailer');

// Multer ukládá dočasně do tmp/
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

// ── Domovská stránka ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const settings = getSettings();
  // Pro voting/results fázi potřebujeme entries na homepage
  let entries = [];
  if (settings.phase === 'voting' || settings.phase === 'results') {
    entries = db.prepare(
      "SELECT id, name, note, photo, votes, anon_number FROM entries WHERE status = 'approved' ORDER BY votes DESC, created_at ASC"
    ).all();
  }
  res.render('home', {
    settings, entries,
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
  const { name, email, note } = req.body;
  if (!name || !email || !req.file) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.redirect('/?error=Vyplňte+všechna+povinná+pole+včetně+fotografie');
  }
  const existing = db.prepare('SELECT id FROM entries WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    fs.unlinkSync(req.file.path);
    return res.redirect('/?error=Tento+e-mail+je+již+přihlášen');
  }
  try {
    const UPLOADS_DIR = req.app.locals.UPLOADS_DIR;
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const outPath = path.join(UPLOADS_DIR, filename);
    try {
      const sharp = require('sharp');
      await sharp(req.file.path).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(outPath);
    } catch {
      fs.copyFileSync(req.file.path, outPath);
    }
    fs.unlinkSync(req.file.path);
    db.prepare('INSERT INTO entries (name, email, note, photo, ip) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), note?.trim() || '', filename, req.ip || '');
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
  const entries = db.prepare(
    "SELECT id, name, note, photo, votes, anon_number FROM entries WHERE status = 'approved' ORDER BY votes DESC, created_at ASC"
  ).all();
  res.render('gallery', {
    settings, entries,
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
    if (existingVote.entry_id === id) return res.json({ ok: false, error: 'Z tohoto e-mailu již byl hlas odevzdán.' });
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

// ── Výsledky ─────────────────────────────────────────────────────────────────
router.get('/vysledky', (req, res) => {
  const settings = getSettings();
  const entries = db.prepare("SELECT id, name, note, photo, votes, anon_number FROM entries WHERE status = 'approved' ORDER BY votes DESC").all();
  res.render('results', { settings, entries });
});

module.exports = router;

// ── Pravidla ──────────────────────────────────────────────────────────────────
router.get('/pravidla', (req, res) => {
  const settings = getSettings();
  res.render('rules', { settings });
});

// ── Sdílení – stránka konkrétního účastníka ────────────────────────────────
router.get('/ucastnik/:id', (req, res) => {
  const settings = getSettings();
  const entry = db.prepare("SELECT id, photo, votes, anon_number FROM entries WHERE id = ? AND status = 'approved'").get(req.params.id);
  if (!entry) return res.redirect('/galerie');
  res.render('share', { settings, entry, appUrl: process.env.APP_URL || '' });
});
