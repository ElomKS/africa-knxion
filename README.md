# Africa KNXION
A platform that connects the African-American / diasporic community across the **United States** through direct services.

Africa KNXION lets people register with their **name, contact details, profession, city, US state and ZIP code**, then request services directly from professionals across the community. It combines a **services marketplace**, a **professional directory** and a **service request system** — all filterable by **US state**.

Built with **Express** and **EJS** for server-side rendering, and **SQLite** for storage.

## Features

- **User registration** with name, contact (email/phone), profession, city, US state and ZIP
- **Professional directory** — browse members by profession, filter by **US state**
- **Service offers** — professionals publish what they offer (filterable by state, with city & ZIP)
- **Service requests** — members ask for services they need (filterable by state, with city & ZIP)
- **Matching** — connect a request with a professional
- **Reviews & ratings** — members rate services received
- **Admin dashboard** — manage members, offers and requests
- **Location-aware** — full "City, State (ST) ZIP" display across profiles, cards and admin

## Usage

1. Install dependencies

```bash
npm install
```

2. Seed the database with sample data

```bash
npm run seed
```

3. Start the app in development mode (auto-reload)

```bash
npm run dev
```

4. Or start in production mode

```bash
npm start
```

5. Open in the browser

```text
http://localhost:3000
```

## Scripts

- `npm run seed` — populate DB with sample members, offers and requests
- `npm run add-user` — create an admin/staff user (see scripts/add-user.js)
- `npm test` — run the test suite

## Environment variables

- `PORT` — server port (default 3000)
- `SESSION_SECRET` — session signing secret
- `DATA_DIR` — persistent directory for the SQLite DB (for hosting)

### Email / SMTP (password reset)

The "forgot password" flow sends a reset link by email via Nodemailer. Without SMTP configured it logs the link to the console (dev mode). To enable email delivery set:

- `SMTP_HOST` — SMTP server host (e.g. `smtp-relay.brevo.com`)
- `SMTP_PORT` — port (default 587)
- `SMTP_USER` — SMTP login. **For Brevo, use the dedicated login shown on the SMTP & API page** (e.g. `bb30df001@smtp-brevo.com`), *not* your Brevo account email.
- `SMTP_PASS` — SMTP password/key (e.g. the `xsmtpsib-...` key from Brevo SMTP Keys)
- `SMTP_SECURE` — set `1` for SSL/TLS (implicit), `0` or omit for STARTTLS
- `MAIL_FROM` — "From" header. Must be a **validated sender** in Brevo (Sender Identity), e.g. `Africa KNXION <komlavi.elom@outlook.fr>`
- `CONTACT_NOTIFY_EMAIL` — recipient for the contact form notifications

On Windows, the npm scripts run Node with `--use-system-ca` so that the OS certificate store (which may contain a local AV/proxy TLS root, e.g. Norton) is trusted during the SMTP handshake.

Reset links are single-use and expire after **10 minutes**.

## Notes

- Uses a local SQLite database (`africa-knxion.db`), gitignored.
- In production, set `NODE_ENV=production` and a `DATA_DIR`.

## Deploy on Render

The app is ready for [Render](https://render.com) as a **Web Service**.

1. Create a Web Service from the GitHub repo (`ElomKS/africa-knxion`).
2. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start` (or the Procfile: `node index.js`)
   - **Instance Type**: Free
3. Set environment variables in the dashboard:
   - `NODE_ENV=production`
   - `SESSION_SECRET` — random secret
   - `SMTP_HOST=smtp-relay.brevo.com`
   - `SMTP_PORT=587`
   - `SMTP_USER` — Brevo SMTP login (`...@smtp-brevo.com`)
   - `SMTP_PASS` — Brevo SMTP key
   - `MAIL_FROM` — validated Brevo sender, e.g. `Africa KNXION <komlavi.elom@outlook.fr>`
   - `CONTACT_NOTIFY_EMAIL` — recipient for contact form notifications

> **Note on persistence**: with a free instance the disk is **ephemeral** — the SQLite database is re-seeded on every deploy and data is lost. To persist data across deploys, add a **Persistent Disk** (Render paid) and point `DATA_DIR` to the mounted path (e.g. `/var/data`).

On Windows, local npm scripts run Node with `--use-system-ca` so that a local AV/proxy TLS root (e.g. Norton) is trusted during the SMTP handshake. This flag is harmless on Linux/Render.
