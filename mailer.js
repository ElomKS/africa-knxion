import 'dotenv/config';
import nodemailer from 'nodemailer';

let transporter = null;
let mode = 'console';

function parseFrom(value) {
  const m = /^\s*([^<]+)\s*<([^>]+)>\s*$/.exec(value || '');
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: null, email: (value || '').trim() };
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || user || 'no-reply@africaknxion.local';

  if (!transporter) {
    if (process.env.BREVO_API_KEY) {
      mode = 'brevo-api';
    } else if (host && user && pass) {
      transporter = nodemailer.createTransport({
        host,
        port,
        secure: Number(process.env.SMTP_SECURE || 0) === 1,
        auth: { user, pass },
      });
      mode = 'smtp';
    } else {
      mode = 'console';
    }
  }

  return { transporter, from };
}

export function getMailMode() {
  getTransporter();
  return mode;
}

function notifyTarget() {
  return process.env.CONTACT_NOTIFY_EMAIL || process.env.MAIL_TO || process.env.SMTP_USER || null;
}

async function sendViaBrevoApi({ to, subject, text, html, from, label }) {
  const apiKey = process.env.BREVO_API_KEY;
  const sender = parseFrom(from);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: sender.name, email: sender.email },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  console.log(`[Mailer] sent ${label} to ${to} via brevo-api (messageId: ${data.messageId})`);
  return { delivered: true, mode: 'brevo-api', messageId: data.messageId };
}

async function send({ to, subject, text, html, label }) {
  const { transporter: t, from } = getTransporter();
  if (mode === 'brevo-api') {
    return sendViaBrevoApi({ to, subject, text, html, from, label });
  }
  if (t) {
    const info = await t.sendMail({ from, to, subject, text, html });
    console.log(`[Mailer] sent ${label} to ${to} via ${mode} (messageId: ${info.messageId})`);
    return { delivered: true, mode: 'smtp', messageId: info.messageId };
  }
  // Dev fallback: log the message so flows can still be exercised locally.
  console.log(`\n[Mailer] (no SMTP configured) ${label} -> ${to}\nSubject: ${subject}\n${text}\n`);
  return { delivered: false, mode: 'console' };
}

export async function sendPasswordResetEmail(to, resetUrl) {
  const subject = 'Password reset – Africa KNXION';
  const text =
    `Hello,\n\n` +
    `We received a request to reset your password.\n\n` +
    `Click the link below to set a new password. It is valid for 10 minutes:\n` +
    `${resetUrl}\n\n` +
    `If you did not request this, you can safely ignore this email.`;

  const html =
    `<p>Hello,</p>` +
    `<p>We received a request to reset your password.</p>` +
    `<p>Click the link below to set a new password. It is valid for <strong>10 minutes</strong>:</p>` +
    `<p><a href="${resetUrl}">${resetUrl}</a></p>` +
    `<p>If you did not request this, you can safely ignore this email.</p>`;

  return send({ to, subject, text, html, label: 'Password reset' });
}

export async function sendContactNotification({ name, email, message }) {
  const to = notifyTarget();
  if (!to) {
    console.log(
      `\n[Mailer] (no CONTACT_NOTIFY_EMAIL/SMTP_USER set) Contact message from ${name} <${email}>:\n${message}\n`
    );
    return { delivered: false, mode: 'console' };
  }
  const subject = `New contact message from ${name}`;
  const text =
    `A new message was submitted from the Contact us form.\n\n` +
    `Name: ${name}\nEmail: ${email}\n\n` +
    `Message:\n${message}\n`;
  const html =
    `<p><strong>New contact message</strong> from the Contact us form.</p>` +
    `<p><strong>Name:</strong> ${name}<br><strong>Email:</strong> ${email}</p>` +
    `<p><strong>Message:</strong><br>${String(message).replace(/\n/g, '<br>')}</p>`;
  return send({ to, subject, text, html, label: 'Contact notification' });
}

export async function sendProUpgradeNotification({ memberId, memberName, email, offerCount, price, months, note }) {
  const to = notifyTarget();
  const subject = `PRO upgrade request – ${memberName}`;
  const text =
    `A member requested a PRO upgrade.\n\n` +
    `Member: ${memberName} (id ${memberId})\n` +
    `Email: ${email || 'not provided'}\n` +
    `Active offers: ${offerCount}\n` +
    `PRO price: $${price}/month\n` +
    (months ? `Requested for: ${months} month(s)\n` : '') +
    (note ? `Note: ${note}\n` : '') +
    `\nCheck the admin dashboard to activate their PRO status.`;
  const html =
    `<p><strong>PRO upgrade request</strong></p>` +
    `<p><strong>Member:</strong> ${memberName} (id ${memberId})<br>` +
    `<strong>Email:</strong> ${email || 'not provided'}<br>` +
    `<strong>Active offers:</strong> ${offerCount}<br>` +
    `<strong>PRO price:</strong> $${price}/month</p>` +
    (months ? `<p><strong>Requested for:</strong> ${months} month(s)</p>` : '') +
    (note ? `<p><strong>Note:</strong> ${String(note).replace(/\n/g, '<br>')}</p>` : '') +
    `<p>Check the <a href="${process.env.BASE_URL || ''}/admin">admin dashboard</a> to activate their PRO status.</p>`;

  if (!to) {
    console.log(
      `\n[Mailer] (no CONTACT_NOTIFY_EMAIL/SMTP_USER set) PRO upgrade request from ${memberName} <${email}>:\n` +
        `${text}\n`
    );
    return { delivered: false, mode: 'console' };
  }
  return send({ to, subject, text, html, label: 'PRO upgrade request' });
}

export const mailerSettings = () => ({
  host: process.env.SMTP_HOST,
  user: process.env.SMTP_USER,
  from: getTransporter().from,
  notify: notifyTarget(),
  mode: getMailMode(),
});