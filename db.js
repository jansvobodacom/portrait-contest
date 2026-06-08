const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Na Railway ukládáme DB do /data (persistentní volume)
// Lokálně ukládáme vedle server.js
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'contest.db'));

// Inicializace tabulek
db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    note        TEXT DEFAULT '',
    photo       TEXT NOT NULL,
    status      TEXT DEFAULT 'pending',
    votes       INTEGER DEFAULT 0,
    anon_number INTEGER,
    ip          TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id    INTEGER NOT NULL,
    voter_email TEXT NOT NULL,
    voter_ip    TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(voter_email),
    FOREIGN KEY (entry_id) REFERENCES entries(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Výchozí nastavení
// phase: 'registration' | 'voting' | 'results'
const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
insertSetting.run('phase', 'registration');
insertSetting.run('contest_title', 'Soutěž o nejhezčí portrét 2026');
insertSetting.run('registration_end', '2026-06-15');
insertSetting.run('voting_end', '2026-07-15');
insertSetting.run('prize_description', 'Profesionální focení zdarma');
insertSetting.run('winner_email_sent', '0');

// Migrace – přidej anon_number pokud sloupec chybí (pro existující DB)
try {
  db.prepare('ALTER TABLE entries ADD COLUMN anon_number INTEGER').run();
} catch (e) { /* sloupec už existuje, ok */ }

// Nová nastavení pro texty, pravidla a barvy
insertSetting.run('home_subtitle', 'Pošlete svůj nejlepší portrétní snímek. Veřejnost hlasuje – vítěz získá profesionální focení zdarma.');
insertSetting.run('rules_text', 'Pravidla soutěže:\n\n1. Soutěž je otevřena pro všechny.\n2. Každý účastník může zaslat jednu fotografii.\n3. Fotografie musí být portrétní snímek.\n4. Hlasovat může každý zadáním svého e-mailu.\n5. Každý e-mail může hlasovat jednou.\n6. Vítěz s nejvyšším počtem hlasů získá výhru.\n7. Pořadatel si vyhrazuje právo odstranit nevhodné fotografie.');
insertSetting.run('color_primary', '#1a1a18');
insertSetting.run('color_accent', '#0F6E56');
insertSetting.run('color_bg', '#fafaf9');

module.exports = db;
