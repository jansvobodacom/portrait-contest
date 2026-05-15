const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.SMTP_FROM || 'Soutěž portrétů <info@example.com>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

async function sendConfirmation(email, name) {
  if (!process.env.SMTP_USER) return; // E-maily deaktivovány v dev
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: '✓ Přihláška přijata – Soutěž o nejhezčí portrét',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#222;">
        <h2 style="font-size:20px;font-weight:500;margin-bottom:8px;">Ahoj, ${name}!</h2>
        <p>Tvá přihláška do soutěže o nejhezčí portrét byla úspěšně přijata.</p>
        <p>Po schválení administrátorem se tvoje fotografie objeví v galerii a bude možné pro ni hlasovat.</p>
        <p style="margin-top:24px;"><a href="${APP_URL}/galerie" style="background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;">Zobrazit galerii</a></p>
        <p style="margin-top:24px;font-size:13px;color:#666;">Hodně štěstí! 🎉</p>
      </div>
    `,
  });
}

async function sendWinnerEmail(email, name) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: '🏆 Gratulujeme! Vyhráli jste soutěž o nejhezčí portrét!',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#222;">
        <h2 style="font-size:22px;font-weight:500;margin-bottom:8px;">🏆 Gratulujeme, ${name}!</h2>
        <p style="font-size:16px;">Vyhráli jste soutěž o nejhezčí portrét 2026!</p>
        <p>Vaše fotografie získala nejvíce hlasů od veřejnosti. Gratuluji!</p>
        <p style="margin-top:20px;"><strong>Vaše výhra:</strong> profesionální focení zdarma v naší studiu.</p>
        <p style="margin-top:8px;">Ozveme se vám co nejdříve s dalšími informacemi pro domluvení termínu.</p>
        <p style="margin-top:24px;font-size:13px;color:#666;">
          Jan Svoboda Photography<br>
          <a href="${APP_URL}">${APP_URL}</a>
        </p>
      </div>
    `,
  });
}

module.exports = { sendConfirmation, sendWinnerEmail };
