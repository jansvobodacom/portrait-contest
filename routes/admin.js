const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const uploadHeader = multer({
  dest: 'tmp/',
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['image/jpeg','image/png','image/webp'].includes(file.mimetype) ? cb(null,true) : cb(new Error('Pouze JPG/PNG/WebP'));
  }
});
const mailer = require('../mailer');
const fs = require('fs');
const path = require('path');

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ── Login ─────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin-login', { error: null });
});
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === (process.env.ADMIN_USERNAME || 'admin') &&
      password === (process.env.ADMIN_PASSWORD || 'admin123')) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.render('admin-login', { error: 'Nesprávné přihlašovací údaje' });
  }
});
router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/', requireAdmin, (req, res) => {
  const settings = getSettings();
  const entries = db.prepare('SELECT * FROM entries ORDER BY created_at DESC').all();
  const totalVotes = db.prepare("SELECT SUM(votes) as t FROM entries WHERE status='approved'").get().t || 0;
  const totalVoters = db.prepare('SELECT COUNT(*) as c FROM votes').get().c || 0;
  const pending = entries.filter(e => e.status === 'pending');
  const approved = entries.filter(e => e.status === 'approved').sort((a, b) => b.votes - a.votes);
  const rejected = entries.filter(e => e.status === 'rejected');
  // Hlasující s detaily
  const voters = db.prepare(`
    SELECT v.voter_email, v.created_at, e.anon_number
    FROM votes v
    LEFT JOIN entries e ON v.entry_id = e.id
    ORDER BY v.created_at DESC
  `).all();
  res.render('admin', {
    settings, entries, pending, approved, rejected, totalVotes, totalVoters, voters,
    success: req.query.success || null, error: req.query.error || null
  });
});

// ── Přepnutí fáze (volný výběr) ───────────────────────────────────────────────
router.post('/faze', requireAdmin, (req, res) => {
  const { phase } = req.body;
  if (!['registration', 'voting', 'results'].includes(phase)) return res.redirect('/admin');
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(phase, 'phase');
  const labels = { registration: 'Přihlašování', voting: 'Hlasování', results: 'Výsledky' };
  res.redirect('/admin?success=Fáze+přepnuta+na:+' + encodeURIComponent(labels[phase]));
});

// ── Moderace ──────────────────────────────────────────────────────────────────
router.post('/schvalit/:id', requireAdmin, (req, res) => {
  const entry = db.prepare('SELECT anon_number FROM entries WHERE id = ?').get(req.params.id);
  if (entry && !entry.anon_number) {
    // Pořadové číslo podle data přihlášení — kolikátý schválený účastník je
    const approvedCount = db.prepare("SELECT COUNT(*) as c FROM entries WHERE status = 'approved' AND anon_number IS NOT NULL").get().c;
    const num = approvedCount + 1;
    db.prepare("UPDATE entries SET status = 'approved', anon_number = ? WHERE id = ?").run(num, req.params.id);
  } else {
    db.prepare("UPDATE entries SET status = 'approved' WHERE id = ?").run(req.params.id);
  }
  res.redirect('/admin#moderace');
});
router.post('/zamit/:id', requireAdmin, (req, res) => {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  if (entry) {
    db.prepare("UPDATE entries SET status = 'rejected' WHERE id = ?").run(entry.id);
    const f = path.join(req.app.locals.UPLOADS_DIR, entry.photo);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  res.redirect('/admin#moderace');
});
router.post('/smazat/:id', requireAdmin, (req, res) => {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  if (entry) {
    db.prepare('DELETE FROM votes WHERE entry_id = ?').run(entry.id);
    db.prepare('DELETE FROM entries WHERE id = ?').run(entry.id);
    const f = path.join(req.app.locals.UPLOADS_DIR, entry.photo);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  res.redirect('/admin');
});

// ── Výherní e-mail ────────────────────────────────────────────────────────────
router.post('/email-vyherce', requireAdmin, async (req, res) => {
  const winner = db.prepare("SELECT * FROM entries WHERE status='approved' ORDER BY votes DESC LIMIT 1").get();
  if (!winner) return res.redirect('/admin?error=Žádný+výherce');
  try {
    await mailer.sendWinnerEmail(winner.email, winner.name);
    db.prepare("UPDATE settings SET value='1' WHERE key='winner_email_sent'").run();
    res.redirect('/admin?success=Výherní+e-mail+odeslán!');
  } catch (err) {
    console.error(err);
    res.redirect('/admin?error=Chyba+při+odesílání+e-mailu');
  }
});

// ── Nastavení ─────────────────────────────────────────────────────────────────
router.post('/nastaveni', requireAdmin, (req, res) => {
  const { contest_title, registration_end, voting_end, prize_description,
          home_subtitle, rules_text, color_primary, color_accent, color_bg,
          gallery_random, form_title, form_subtitle, form_anon_note,
          gallery_title, gallery_subtitle, results_title, footer_text } = req.body;
  const u = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  u.run(contest_title || '', 'contest_title');
  u.run(registration_end || '', 'registration_end');
  u.run(voting_end || '', 'voting_end');
  u.run(prize_description || '', 'prize_description');
  u.run(home_subtitle || '', 'home_subtitle');
  u.run(rules_text || '', 'rules_text');
  u.run(color_primary || '#1a1a18', 'color_primary');
  u.run(color_accent || '#0F6E56', 'color_accent');
  u.run(color_bg || '#fafaf9', 'color_bg');
  u.run(gallery_random === 'on' ? '1' : '0', 'gallery_random');
  u.run(form_title || '', 'form_title');
  u.run(form_subtitle || '', 'form_subtitle');
  u.run(form_anon_note || '', 'form_anon_note');
  u.run(gallery_title || '', 'gallery_title');
  u.run(gallery_subtitle || '', 'gallery_subtitle');
  u.run(results_title || '', 'results_title');
  u.run(footer_text || '', 'footer_text');
  // Texty formuláře
  const fields = ['form_label_name','form_label_email','form_label_note',
    'form_placeholder_name','form_placeholder_email','form_placeholder_note',
    'form_upload_text','form_upload_hint','form_note','form_submit',
    'vote_modal_hint','vote_submit'];
  fields.forEach(f => { if (req.body[f] !== undefined) u.run(req.body[f], f); });
  res.redirect('/admin?success=Nastavení+uloženo');
});

// ── Export CSV účastníků ───────────────────────────────────────────────────────
router.get('/export-csv', requireAdmin, (req, res) => {
  const entries = db.prepare('SELECT name, email, status, votes, anon_number, created_at FROM entries ORDER BY votes DESC').all();
  const header = 'Jméno,E-mail,Status,Číslo účastníka,Hlasy,Přihlášeno\n';
  const rows = entries.map(e => `"${e.name}","${e.email}","${e.status}",${e.anon_number||''},${e.votes},"${e.created_at}"`).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ucastnici-export.csv"');
  res.send('\uFEFF' + header + rows);
});

// ── Export CSV hlasujících ────────────────────────────────────────────────────
router.get('/export-voters-csv', requireAdmin, (req, res) => {
  const voters = db.prepare(`
    SELECT v.voter_email, v.created_at, e.anon_number
    FROM votes v LEFT JOIN entries e ON v.entry_id = e.id
    ORDER BY v.created_at DESC
  `).all();
  const header = 'E-mail hlasujícího,Hlasoval pro zadečka č.,Čas hlasu\n';
  const rows = voters.map(v => `"${v.voter_email}",${v.anon_number||'?'},"${v.created_at}"`).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="hlasujici-export.csv"');
  res.send('\uFEFF' + header + rows);
});

// ── QR kód pro účastníka ─────────────────────────────────────────────────────
router.get('/qr/:id', requireAdmin, async (req, res) => {
  const entry = db.prepare('SELECT id, anon_number FROM entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.redirect('/admin');
  const appUrl = process.env.APP_URL || 'https://portrait-contest-production.up.railway.app';
  const url = `${appUrl}/zadecek/${entry.id}`;
  try {
    const qrcode = require('qrcode');
    const qrDataUrl = await qrcode.toDataURL(url, { width: 400, margin: 2, color: { dark: '#1a1a18', light: '#fafaf8' } });
    res.send(`<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"><title>QR kód – Zadeček č. ${entry.anon_number}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#fafaf8;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}
    .card{background:#fff;border:0.5px solid rgba(0,0,0,0.1);border-radius:12px;padding:2rem;text-align:center;max-width:340px;width:100%}
    h1{font-size:16px;font-weight:500;margin-bottom:4px}p{font-size:13px;color:#5a5955;margin-bottom:1.5rem}
    img{width:200px;height:200px;border-radius:8px;margin-bottom:1.5rem}
    .url{font-size:11px;color:#9a9893;word-break:break-all;margin-bottom:1.25rem}
    .btn{display:inline-block;background:#1a1a18;color:#fff;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:500;text-decoration:none;margin-right:8px}
    .btn-ghost{display:inline-block;padding:10px 20px;border:0.5px solid rgba(0,0,0,0.2);border-radius:6px;font-size:13px;color:#5a5955;text-decoration:none}
    </style></head><body><div class="card">
    <h1>Zadeček č. ${entry.anon_number}</h1>
    <p>QR kód pro sdílení</p>
    <img src="${qrDataUrl}" alt="QR kód">
    <div class="url">${url}</div>
    <a href="${qrDataUrl}" download="ucastnik-${entry.anon_number}-qr.png" class="btn">⬇ Stáhnout PNG</a>
    <a href="/admin" class="btn-ghost">← Admin</a>
    </div></body></html>`);
  } catch (err) {
    console.error(err);
    res.redirect('/admin?error=Chyba+při+generování+QR+kódu');
  }
});

// ── Upload header fotky ──────────────────────────────────────────────────────
router.post('/header-foto', requireAdmin, uploadHeader.single('header_photo'), async (req, res) => {
  if (!req.file) return res.redirect('/admin?error=Vyberte+fotografii');
  try {
    const UPLOADS_DIR = req.app.locals.UPLOADS_DIR;
    const filename = 'header-' + Date.now() + '.jpg';
    const outPath = path.join(UPLOADS_DIR, filename);
    try {
      const sharp = require('sharp');
      await sharp(req.file.path).resize(1600, 800, { fit: 'cover' }).jpeg({ quality: 90 }).toFile(outPath);
    } catch { fs.copyFileSync(req.file.path, outPath); }
    fs.unlinkSync(req.file.path);
    // Smaž starou header fotku
    const existing = db.prepare("SELECT value FROM settings WHERE key = 'header_photo'").get();
    if (existing && existing.value) {
      const oldPath = path.join(UPLOADS_DIR, existing.value);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    db.prepare("UPDATE settings SET value = ? WHERE key = 'header_photo'").run(filename);
    res.redirect('/admin?success=Header+fotka+nahrána!');
  } catch(err) {
    console.error(err);
    res.redirect('/admin?error=Chyba+při+nahrávání+fotky');
  }
});

router.post('/header-foto-smazat', requireAdmin, (req, res) => {
  const current = db.prepare("SELECT value FROM settings WHERE key = 'header_photo'").get();
  if (current && current.value) {
    const f = path.join(req.app.locals.UPLOADS_DIR, current.value);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  db.prepare("UPDATE settings SET value = '' WHERE key = 'header_photo'").run();
  res.redirect('/admin?success=Header+fotka+smazána');
});

// ── Smazat hlas ──────────────────────────────────────────────────────────────
router.post('/smazat-hlas', requireAdmin, (req, res) => {
  const { voter_email } = req.body;
  if (!voter_email) return res.redirect('/admin?error=Zadejte+e-mail');
  const vote = db.prepare('SELECT * FROM votes WHERE voter_email = ?').get(voter_email.trim().toLowerCase());
  if (!vote) return res.redirect('/admin?error=Hlas+s+tímto+e-mailem+nenalezen');
  db.prepare('UPDATE entries SET votes = MAX(0, votes - 1) WHERE id = ?').run(vote.entry_id);
  db.prepare('DELETE FROM votes WHERE voter_email = ?').run(voter_email.trim().toLowerCase());
  res.redirect('/admin?success=Hlas+smazán+('+encodeURIComponent(voter_email)+')');
});

// ── Poznámka k účastníkovi ───────────────────────────────────────────────────
router.post('/poznamka/:id', requireAdmin, (req, res) => {
  const { note_admin } = req.body;
  db.prepare('UPDATE entries SET note_admin = ? WHERE id = ?').run(note_admin || '', req.params.id);
  res.redirect('/admin#moderace');
});

// ── Otočení fotky ─────────────────────────────────────────────────────────────
router.post('/otocit/:id', requireAdmin, async (req, res) => {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.redirect('/admin?error=Příspěvek+nenalezen');
  try {
    const UPLOADS_DIR = req.app.locals.UPLOADS_DIR;
    const filePath = path.join(UPLOADS_DIR, entry.photo);
    const sharp = require('sharp');
    const rotated = await sharp(filePath).rotate(90).toBuffer();
    fs.writeFileSync(filePath, rotated);
    res.redirect('/admin?success=Fotka+otočena');
  } catch (err) {
    console.error(err);
    res.redirect('/admin?error=Chyba+při+otáčení+fotky');
  }
});

module.exports = router;
