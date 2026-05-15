# 📸 Soutěž portrétů – Instalační příručka

## Co aplikace umí

- **Přihláška**: Formulář s uploadem fotky (až 15 MB, automatický resize přes Sharp)
- **Moderace**: Admin musí každou fotku schválit před zveřejněním
- **Galerie + hlasování**: Veřejná galerie, každý návštěvník 1 hlas (anti-spam přes session)
- **Výsledky**: Živé pořadí s podiem
- **E-maily**: Potvrzení přihlášky + výherní e-mail jedním kliknutím
- **Admin panel**: Statistiky, moderace, nastavení, export CSV
- **Databáze**: SQLite (žádný extra server nepotřeba)

---

## Rychlý start (lokálně)

```bash
# 1. Rozbal zip a vstup do složky
cd portrait-contest

# 2. Nainstaluj závislosti
npm install

# 3. Nastav prostředí
cp .env.example .env
# Otevři .env a vyplň SESSION_SECRET, ADMIN_PASSWORD a SMTP údaje

# 4. Spusť
npm start
# nebo pro vývoj s auto-restartem:
npm run dev
```

Aplikace běží na http://localhost:3000  
Admin panel: http://localhost:3000/admin

---

## Nasazení na VPS (Hetzner / DigitalOcean)

### 1. Server (Ubuntu 22.04)

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2 pro produkci
sudo npm install -g pm2

# Nginx jako reverse proxy
sudo apt install -y nginx
```

### 2. Nahrání aplikace

```bash
# Na svém počítači:
scp -r portrait-contest/ user@IP:/var/www/

# Na serveru:
cd /var/www/portrait-contest
npm install --production
cp .env.example .env
nano .env  # vyplň hodnoty
```

### 3. Spuštění přes PM2

```bash
pm2 start server.js --name portrait-contest
pm2 save
pm2 startup  # automatický start po restartu serveru
```

### 4. Nginx konfigurace

```nginx
server {
    listen 80;
    server_name soutez.jansvoboda.com;

    client_max_body_size 20M;  # pro upload fotek

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/soutez /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS (Let's Encrypt)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d soutez.jansvoboda.com
```

---

## Nasazení na Railway (nejjednodušší)

1. Jdi na [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo
3. Přidej Environment Variables (SESSION_SECRET, ADMIN_PASSWORD, SMTP_*)
4. Railway automaticky spustí `npm start`

> ⚠️ Na Railway musíš použít volume pro persistenci DB a uploads:
> - `/var/data` jako volume, v `.env` nastav `DB_PATH=/var/data/contest.db` a uploaduj do `/var/data/uploads/`

---

## Nastavení e-mailů (Gmail)

1. Zapni dvoufaktorové ověření na Google účtu
2. Jdi na myaccount.google.com → Zabezpečení → Hesla aplikací
3. Vygeneruj heslo pro "Pošta" a zkopíruj ho do `.env` jako `SMTP_PASS`

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tvuj@gmail.com
SMTP_PASS=vygenerovane_heslo_aplikace
```

---

## Struktura souborů

```
portrait-contest/
├── server.js          ← Hlavní soubor
├── db.js              ← Databáze (SQLite)
├── mailer.js          ← Odesílání e-mailů
├── routes/
│   ├── public.js      ← Veřejné stránky + API hlasování
│   └── admin.js       ← Admin panel
├── views/
│   ├── home.ejs       ← Přihláška
│   ├── gallery.ejs    ← Galerie + hlasování
│   ├── results.ejs    ← Výsledky
│   ├── admin.ejs      ← Admin panel
│   └── admin-login.ejs
├── public/
│   └── uploads/       ← Nahrané fotografie
├── contest.db         ← SQLite databáze (vytvoří se automaticky)
└── .env               ← Konfigurace (necommituj do git!)
```

---

## Časté dotazy

**Jak změnit datum ukončení?**  
V admin panelu → Nastavení → Datum ukončení.

**Jak uzavřít hlasování?**  
Admin panel → Nastavení → odškrtni "Hlasování otevřeno".

**Jak odeslat výherní e-mail?**  
Admin panel → klikni na tlačítko "Odeslat výherní e-mail" u lídra.

**Jak zálohovat data?**  
Stačí zkopírovat soubor `contest.db` a složku `public/uploads/`.
