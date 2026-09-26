import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// On a host with a persistent disk (e.g. Render), define DATA_DIR
// pointing to the mounted path (e.g. /var/data) to keep the DB between deploys.
const dataDir = process.env.DATA_DIR || __dirname;
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'africa-knxion.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    profession TEXT,
    bio TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    zip TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS service_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    price TEXT DEFAULT '',
    category TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    zip TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    zip TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'completed')),
    professional_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (professional_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reviewer_id INTEGER NOT NULL,
    professional_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (professional_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL,
    user_b INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_a, user_b),
    FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled')),
    message TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (offer_id) REFERENCES service_offers(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    actor_id INTEGER,
    type TEXT NOT NULL,
    ref_id INTEGER,
    text TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ---- Migrations for databases created before city/zip columns ----
// Table -> (new columns to add, old 'location' column to migrate into 'state')
const MIGRATIONS = {
  users: { columns: ['state', 'city', 'zip'], hasLocationLegacy: true },
  service_offers: { columns: ['state', 'city', 'zip'], hasLocationLegacy: true },
  service_requests: { columns: ['state', 'city', 'zip'], hasLocationLegacy: true },
};

function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

for (const [table, cfg] of Object.entries(MIGRATIONS)) {
  try {
    const cols = columnNames(table);
    if (!cols.length) continue;

    // Old schema stored the state in a 'location' column; carry it over to 'state'.
    if (cfg.hasLocationLegacy && cols.includes('location') && !cols.includes('state')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN state TEXT DEFAULT ''`);
      db.exec(`UPDATE ${table} SET state = location`);
    }

    for (const col of cfg.columns) {
      if (!columnNames(table).includes(col)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT DEFAULT ''`);
      }
    }
  } catch (err) {
    // Ignore migration errors; the fresh schema already has the columns.
  }
}

// Migrations for admin-moderation fields: 'active' (0/1) on users and service_offers.
for (const table of ['users', 'service_offers']) {
  try {
    if (!columnNames(table).includes('active')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
    }
  } catch (err) {
    // Ignore; already present on fresh schema.
  }
}

/* ---------- Password helpers ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

/* ---------- Users ---------- */

export function createUser({ fullName, email, phone, profession, bio = '', city = '', state = '', zip = '', role = 'member' }) {
  const stmt = db.prepare(`
    INSERT INTO users (full_name, email, phone, profession, bio, city, state, zip, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(fullName, email || null, phone || null, profession || null, bio, city, state, zip, role);
  return { id: result.lastInsertRowid };
}

export function createAccount(userId, username, password) {
  const stmt = db.prepare(`
    INSERT INTO accounts (user_id, username, password_hash)
    VALUES (?, ?, ?)
  `);
  return stmt.run(userId, username, hashPassword(password));
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getAccountByUsername(username) {
  return db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
}

export function getAccountByUserId(userId) {
  return db.prepare('SELECT * FROM accounts WHERE user_id = ?').get(userId);
}

export function changePassword(userId, newPassword) {
  return db.prepare('UPDATE accounts SET password_hash = ? WHERE user_id = ?')
    .run(hashPassword(newPassword), userId);
}

export function changeAccountUsername(userId, newUsername) {
  return db.prepare('UPDATE accounts SET username = ? WHERE user_id = ?').run(newUsername, userId);
}

export function createPasswordReset(userId, token, expiresAt) {
  // Invalidate any previous, still-pending resets for this user (single active token).
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(userId);
  return db.prepare(`
    INSERT INTO password_resets (user_id, token, expires_at)
    VALUES (?, ?, ?)
  `).run(userId, token, expiresAt);
}

export function getValidPasswordReset(token) {
  return db.prepare(`
    SELECT * FROM password_resets
    WHERE token = ? AND used = 0 AND expires_at > ?
  `).get(token, new Date().toISOString());
}

export function markPasswordResetUsed(id) {
  return db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(id);
}

export function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY id DESC').all();
}

export function searchUsers(query = '') {
  const q = `%${query}%`;
  return db.prepare(`
    SELECT * FROM users
    WHERE full_name LIKE ? OR profession LIKE ? OR city LIKE ? OR state LIKE ? OR zip LIKE ?
    ORDER BY id DESC
  `).all(q, q, q, q, q);
}

export function updateUser(id, { fullName, email, phone, profession, bio, city, state, zip }) {
  return db.prepare(`
    UPDATE users SET
      full_name = ?, email = ?, phone = ?, profession = ?, bio = ?, city = ?, state = ?, zip = ?
    WHERE id = ?
  `).run(fullName, email, phone, profession, bio, city, state, zip, id);
}

export function deleteUser(id) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function setUserRole(id, role) {
  const allowed = ['admin', 'member'];
  if (!allowed.includes(role)) return null;
  return db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

export function setUserActive(id, active) {
  return db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

export function authenticateUser(username, password) {
  const account = getAccountByUsername(username);
  if (!account) return null;
  if (!verifyPassword(password, account.password_hash)) return null;
  return getUserById(account.user_id);
}

export function registerUserWithAccount({ fullName, email, phone, profession, bio, city, state, zip, username, password, role = 'member' }) {
  const user = createUser({ fullName, email, phone, profession, bio, city, state, zip, role });
  createAccount(user.id, username, password);
  return user;
}

/* ---------- Service offers ---------- */

export function createOffer({ userId, title, description, price = '', category = '', city = '', state = '', zip = '' }) {
  const stmt = db.prepare(`
    INSERT INTO service_offers (user_id, title, description, price, category, city, state, zip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(userId, title, description, price, category, city, state, zip);
}

export function getOfferById(id) {
  return db.prepare(`
    SELECT o.*, u.full_name, u.profession, u.email, u.phone
    FROM service_offers o
    JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `).get(id);
}

export function getAllOffers() {
  return db.prepare(`
    SELECT o.*, u.full_name, u.profession, u.email, u.phone
    FROM service_offers o
    JOIN users u ON u.id = o.user_id
    ORDER BY o.id DESC
  `).all();
}

export function searchOffers(query = '') {
  const q = `%${query}%`;
  return db.prepare(`
    SELECT o.*, u.full_name, u.profession, u.email, u.phone
    FROM service_offers o
    JOIN users u ON u.id = o.user_id
    WHERE o.title LIKE ? OR o.description LIKE ? OR o.category LIKE ?
      OR o.city LIKE ? OR o.state LIKE ? OR o.zip LIKE ?
      OR u.full_name LIKE ? OR u.profession LIKE ?
    ORDER BY o.id DESC
  `).all(q, q, q, q, q, q, q, q);
}

export function deleteOffer(id) {
  return db.prepare('DELETE FROM service_offers WHERE id = ?').run(id);
}

export function setOfferActive(id, active) {
  return db.prepare('UPDATE service_offers SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

/* ---------- Service requests ---------- */

export function createRequest({ userId, title, description, category = '', city = '', state = '', zip = '' }) {
  const stmt = db.prepare(`
    INSERT INTO service_requests (user_id, title, description, category, city, state, zip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(userId, title, description, category, city, state, zip);
}

export function getRequestById(id) {
  return db.prepare(`
    SELECT r.*, u.full_name, u.profession, u.email, u.phone, p.full_name AS professional_name
    FROM service_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN users p ON p.id = r.professional_id
    WHERE r.id = ?
  `).get(id);
}

export function getAllRequests(status = null) {
  let sql = `
    SELECT r.*, u.full_name, u.profession, u.email, u.phone, p.full_name AS professional_name
    FROM service_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN users p ON p.id = r.professional_id
  `;
  const params = [];
  if (status) {
    sql += ' WHERE r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.id DESC';
  return db.prepare(sql).all(...params);
}

export function searchRequests(query = '') {
  const q = `%${query}%`;
  return db.prepare(`
    SELECT r.*, u.full_name, u.profession, u.email, u.phone, p.full_name AS professional_name
    FROM service_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN users p ON p.id = r.professional_id
    WHERE r.title LIKE ? OR r.description LIKE ? OR r.category LIKE ?
      OR r.city LIKE ? OR r.state LIKE ? OR r.zip LIKE ? OR u.full_name LIKE ?
    ORDER BY r.id DESC
  `).all(q, q, q, q, q, q, q);
}

export function updateRequestStatus(id, status, professionalId = null) {
  if (professionalId !== null) {
    return db.prepare('UPDATE service_requests SET status = ?, professional_id = ? WHERE id = ?')
      .run(status, professionalId, id);
  }
  return db.prepare('UPDATE service_requests SET status = ? WHERE id = ?').run(status, id);
}

export function deleteRequest(id) {
  return db.prepare('DELETE FROM service_requests WHERE id = ?').run(id);
}

/* ---------- Reviews ---------- */

export function createReview({ reviewerId, professionalId, rating, comment = '' }) {
  const stmt = db.prepare(`
    INSERT INTO reviews (reviewer_id, professional_id, rating, comment)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(reviewerId, professionalId, rating, comment);
}

export function getReviewsForProfessional(professionalId) {
  return db.prepare(`
    SELECT r.*, u.full_name
    FROM reviews r
    JOIN users u ON u.id = r.reviewer_id
    WHERE r.professional_id = ?
    ORDER BY r.id DESC
  `).all(professionalId);
}

export function getAverageRating(professionalId) {
  const row = db.prepare(`
    SELECT AVG(rating) AS avg, COUNT(*) AS count
    FROM reviews WHERE professional_id = ?
  `).get(professionalId);
  return { avg: row.avg ? Math.round(row.avg * 10) / 10 : 0, count: row.count };
}

export function getAllReviews() {
  return db.prepare(`
    SELECT r.*, u.full_name AS reviewer_name, p.full_name AS professional_name
    FROM reviews r
    JOIN users u ON u.id = r.reviewer_id
    JOIN users p ON p.id = r.professional_id
    ORDER BY r.id DESC
  `).all();
}

export function deleteReview(id) {
  return db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
}

/* ---------- Contact ---------- */

export function addContactMessage(name, email, message) {
  return db.prepare(`
    INSERT INTO contact_messages (name, email, message)
    VALUES (?, ?, ?)
  `).run(name, email, message);
}

export function getContactMessages() {
  return db.prepare('SELECT * FROM contact_messages ORDER BY id DESC').all();
}

export function deleteContactMessage(id) {
  return db.prepare('DELETE FROM contact_messages WHERE id = ?').run(id);
}

/* ---------- Conversations & messages ---------- */

// Find an existing conversation between two users, or create one.
// user_a is always the smaller id so the (user_a, user_b) unique pair is normalized.
function getOrCreateConversation(userId1, userId2) {
  const a = Math.min(userId1, userId2);
  const b = Math.max(userId1, userId2);
  let conv = db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(a, b);
  if (!conv) {
    const r = db.prepare('INSERT INTO conversations (user_a, user_b) VALUES (?, ?)').run(a, b);
    conv = { id: r.lastInsertRowid, user_a: a, user_b: b };
  }
  return conv;
}

export function getOrCreateConversationFor(userId1, userId2) {
  return getOrCreateConversation(userId1, userId2);
}

export function getConversationByIdForUser(userId1, userId2) {
  const a = Math.min(userId1, userId2);
  const b = Math.max(userId1, userId2);
  return db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(a, b);
}

export function sendMessage({ senderId, recipientId, body }) {
  if (senderId === recipientId) return null;
  const conv = getOrCreateConversation(senderId, recipientId);
  const r = db.prepare(`
    INSERT INTO messages (conversation_id, sender_id, body)
    VALUES (?, ?, ?)
  `).run(conv.id, senderId, body);
  // The recipient has an unread message.
  createNotification({
    userId: recipientId,
    actorId: senderId,
    type: 'message',
    refId: conv.id,
    text: 'You have a new message.',
  });
  return r;
}

export function getConversationsForUser(userId) {
  return db.prepare(`
    SELECT c.id, c.user_a, c.user_b,
           ua.full_name AS a_name, ub.full_name AS b_name,
           (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.read = 0 AND m.sender_id != ?) AS unread
    FROM conversations c
    JOIN users ua ON ua.id = c.user_a
    JOIN users ub ON ub.id = c.user_b
    WHERE c.user_a = ? OR c.user_b = ?
    ORDER BY (SELECT MAX(id) FROM messages m WHERE m.conversation_id = c.id) DESC
  `).all(userId, userId, userId);
}

export function getConversationForUser(conversationId, userId) {
  return db.prepare(`
    SELECT * FROM conversations WHERE id = ? AND (user_a = ? OR user_b = ?)
  `).get(conversationId, userId, userId);
}

export function getMessagesForConversation(conversationId) {
  return db.prepare(`
    SELECT m.*, u.full_name AS sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.id ASC
  `).all(conversationId);
}

// Mark all messages in a conversation as read (except those sent by the reader).
export function markConversationRead(conversationId, userId) {
  return db.prepare(`
    UPDATE messages SET read = 1
    WHERE conversation_id = ? AND sender_id != ?
  `).run(conversationId, userId);
}

export function countUnreadMessages(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS c
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.read = 0 AND m.sender_id != ? AND (c.user_a = ? OR c.user_b = ?)
  `).get(userId, userId, userId).c;
}

/* ---------- Reservations (on offers) ---------- */

export function createReservation({ offerId, clientId, message = '' }) {
  const r = db.prepare(`
    INSERT INTO reservations (offer_id, client_id, message)
    VALUES (?, ?, ?)
  `).run(offerId, clientId, message);
  const offer = getOfferById(offerId);
  if (offer) {
    createNotification({
      userId: offer.user_id,
      actorId: clientId,
      type: 'reservation',
      refId: offerId,
      text: 'Someone wants to book your service.',
    });
  }
  return r;
}

export function getReservationById(id) {
  return db.prepare(`
    SELECT r.*, o.title AS offer_title, o.user_id AS offer_owner,
           u.full_name AS client_name, u.profession AS client_profession
    FROM reservations r
    JOIN service_offers o ON o.id = r.offer_id
    JOIN users u ON u.id = r.client_id
    WHERE r.id = ?
  `).get(id);
}

export function getReservationsForOffer(offerId) {
  return db.prepare(`
    SELECT r.*, u.full_name AS client_name, u.profession AS client_profession, o.title AS offer_title
    FROM reservations r
    JOIN users u ON u.id = r.client_id
    JOIN service_offers o ON o.id = r.offer_id
    WHERE r.offer_id = ?
    ORDER BY r.id DESC
  `).all(offerId);
}

export function getReservationsForOfferOwner(ownerId) {
  return db.prepare(`
    SELECT r.*, u.full_name AS client_name, u.profession AS client_profession, o.title AS offer_title, o.user_id AS offer_owner
    FROM reservations r
    JOIN users u ON u.id = r.client_id
    JOIN service_offers o ON o.id = r.offer_id
    WHERE o.user_id = ?
    ORDER BY r.id DESC
  `).all(ownerId);
}

export function getReservationsForClient(clientId) {
  return db.prepare(`
    SELECT r.*, o.title AS offer_title, o.user_id AS offer_owner, o.price AS offer_price
    FROM reservations r
    JOIN service_offers o ON o.id = r.offer_id
    WHERE r.client_id = ?
    ORDER BY r.id DESC
  `).all(clientId);
}

export function updateReservationStatus(id, status) {
  return db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status, id);
}

/* ---------- Notifications ---------- */

export function createNotification({ userId, actorId = null, type, refId = null, text }) {
  return db.prepare(`
    INSERT INTO notifications (user_id, actor_id, type, ref_id, text)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, actorId, type, refId, text);
}

export function getNotifications(userId) {
  return db.prepare(`
    SELECT n.*, a.full_name AS actor_name
    FROM notifications n
    LEFT JOIN users a ON a.id = n.actor_id
    WHERE n.user_id = ?
    ORDER BY n.id DESC
    LIMIT 50
  `).all(userId);
}

export function countUnreadNotifications(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(userId).c;
}

export function markAllNotificationsRead(userId) {
  return db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
}

/* ---------- Stats (admin dashboard) ---------- */

export function getStats() {
  return {
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    activeUsers: db.prepare('SELECT COUNT(*) AS c FROM users WHERE active = 1').get().c,
    offers: db.prepare('SELECT COUNT(*) AS c FROM service_offers').get().c,
    activeOffers: db.prepare('SELECT COUNT(*) AS c FROM service_offers WHERE active = 1').get().c,
    requests: db.prepare('SELECT COUNT(*) AS c FROM service_requests').get().c,
    reviews: db.prepare('SELECT COUNT(*) AS c FROM reviews').get().c,
    openRequests: db.prepare("SELECT COUNT(*) AS c FROM service_requests WHERE status = 'open'").get().c,
    reservations: db.prepare('SELECT COUNT(*) AS c FROM reservations').get().c,
    pendingReservations: db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE status = 'pending'").get().c,
    messages: db.prepare('SELECT COUNT(*) AS c FROM messages').get().c,
    conversations: db.prepare('SELECT COUNT(*) AS c FROM conversations').get().c,
    unreadNotifications: db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE read = 0').get().c,
    statesCovered: db.prepare("SELECT COUNT(DISTINCT state) AS c FROM users WHERE state != ''").get().c,
  };
}

export function getUsersByState() {
  return db.prepare(`
    SELECT state, COUNT(*) AS c
FROM users
    WHERE state != ''
    GROUP BY state
    ORDER BY c DESC, state ASC
  `).all();
}

export function getCategoriesCount() {
  return db.prepare(`
    SELECT category, COUNT(*) AS c
    FROM service_offers
    WHERE category != ''
    GROUP BY category
    ORDER BY c DESC
  `).all();
}

/* ---------- Seeding ---------- */

export function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return false;

  const sampleUsers = [
    { fullName: 'Awa Diallo', email: 'awa@example.com', phone: '+1 912 555 0123', profession: 'Plumber', bio: 'Certified plumber with 10 years of experience.', city: 'Atlanta', state: 'GA', zip: '30301', role: 'member' },
    { fullName: 'Kwame Mensah', email: 'kwame@example.com', phone: '+1 202 555 0147', profession: 'Electrician', bio: 'Licensed electrician, residential and commercial.', city: 'Washington', state: 'DC', zip: '20001', role: 'member' },
    { fullName: 'Fatou Ndiaye', email: 'fatou@example.com', phone: '+1 718 555 0139', profession: 'Boutique Owner', bio: 'Sells traditional African fabrics and clothing.', city: 'Brooklyn', state: 'NY', zip: '11201', role: 'member' },
    { fullName: 'Tunde Okafor', email: 'tunde@example.com', phone: '+1 713 555 0170', profession: 'Web Developer', bio: 'Full-stack developer building websites and apps.', city: 'Houston', state: 'TX', zip: '77001', role: 'member' },
    { fullName: 'Nia Mabika', email: 'nia@example.com', phone: '+1 305 555 0128', profession: 'Graphic Designer', bio: 'Logo, branding and print design.', city: 'Miami', state: 'FL', zip: '33101', role: 'member' },
    { fullName: 'Chidi Eze', email: 'chidi@example.com', phone: '+1 470 555 0155', profession: 'Carpenter', bio: 'Custom furniture, cabinets and home repairs.', city: 'Decatur', state: 'GA', zip: '30030', role: 'member' },
    { fullName: 'Yaa Amara', email: 'yaa@example.com', phone: '+1 404 555 0141', profession: 'Hair Stylist', bio: 'Braids, weaves and natural hair care for the whole family.', city: 'Atlanta', state: 'GA', zip: '30303', role: 'member' },
    { fullName: 'Moussa Kone', email: 'moussa@example.com', phone: '+1 718 555 0163', profession: 'Plumber', bio: 'Emergency and scheduled plumbing, kitchen and bath.', city: 'Queens', state: 'NY', zip: '11385', role: 'member' },
    { fullName: 'Ada Uche', email: 'ada@example.com', phone: '+1 212 555 0177', profession: 'Caterer', bio: 'Authentic West African catering for events and offices.', city: 'Manhattan', state: 'NY', zip: '10001', role: 'member' },
    { fullName: 'Binta Sow', email: 'binta@example.com', phone: '+1 713 555 0189', profession: 'Boutique Owner', bio: 'African fashion, wax prints and bridal wear.', city: 'Dallas', state: 'TX', zip: '75201', role: 'member' },
    { fullName: 'Emeka Obi', email: 'emeka@example.com', phone: '+1 832 555 0192', profession: 'Electrician', bio: 'Residential and commercial wiring, solar setup.', city: 'Houston', state: 'TX', zip: '77002', role: 'member' },
    { fullName: 'Zainab Barrow', email: 'zainab@example.com', phone: '+1 305 555 0101', profession: 'Caterer', bio: 'Jollof, grilled specialties and event catering.', city: 'Orlando', state: 'FL', zip: '32801', role: 'member' },
    { fullName: 'Sekou Traore', email: 'sekou@example.com', phone: '+1 305 555 0166', profession: 'Carpenter', bio: 'Deck, cabinetry and general woodwork.', city: 'Miami', state: 'FL', zip: '33161', role: 'member' },
    { fullName: 'Aminata Keita', email: 'aminata@example.com', phone: '+1 205 555 0123', profession: 'Nurse', bio: 'Home health and patient care.', city: 'Birmingham', state: 'AL', zip: '35201', role: 'member' },
    { fullName: 'Kalou Traor', email: 'kalou@example.com', phone: '+1 907 555 0131', profession: 'Cook', bio: 'Home cooking and meal prep for families.', city: 'Anchorage', state: 'AK', zip: '99501', role: 'member' },
    { fullName: 'Safa Bello', email: 'safa@example.com', phone: '+1 602 555 0148', profession: 'Landscaper', bio: 'Lawn care, garden design and cleanups.', city: 'Phoenix', state: 'AZ', zip: '85001', role: 'member' },
    { fullName: 'Imani Haddad', email: 'imani@example.com', phone: '+1 501 555 0156', profession: 'Tailor', bio: 'Custom clothing and alterations.', city: 'Little Rock', state: 'AR', zip: '72201', role: 'member' },
    { fullName: 'Ngozi Akpabio', email: 'ngozi@example.com', phone: '+1 916 555 0164', profession: 'Chef', bio: 'Private chef and event cooking.', city: 'Sacramento', state: 'CA', zip: '94203', role: 'member' },
    { fullName: 'Yusuf Diallo', email: 'yusufca@example.com', phone: '+1 916 555 0172', profession: 'Accountant', bio: 'Bookkeeping and tax preparation.', city: 'Sacramento', state: 'CA', zip: '95814', role: 'member' },
    { fullName: 'Awa Cisse', email: 'awa_cisse@example.com', phone: '+1 303 555 0180', profession: 'Barber', bio: 'Men\u2019s grooming and fades.', city: 'Denver', state: 'CO', zip: '80201', role: 'member' },
    { fullName: 'Fanta Doumbia', email: 'fanta@example.com', phone: '+1 860 555 0188', profession: 'Tutor', bio: 'Math and science tutoring.', city: 'Hartford', state: 'CT', zip: '06101', role: 'member' },
    { fullName: 'Mamadou Sow', email: 'mamadou@example.com', phone: '+1 302 555 0121', profession: 'Painter', bio: 'Interior and exterior painting.', city: 'Wilmington', state: 'DE', zip: '19801', role: 'member' },
    { fullName: 'Kofi Boateng', email: 'kofi@example.com', phone: '+1 808 555 0132', profession: 'Caterer', bio: 'Hawaiian luau and event catering.', city: 'Honolulu', state: 'HI', zip: '96813', role: 'member' },
    { fullName: 'Zola Mbeki', email: 'zola@example.com', phone: '+1 208 555 0140', profession: 'Mechanic', bio: 'Auto repair and diagnostics.', city: 'Boise', state: 'ID', zip: '83701', role: 'member' },
    { fullName: 'Adama Barry', email: 'adama@example.com', phone: '+1 312 555 0158', profession: 'Chef', bio: 'West African restaurant chef.', city: 'Chicago', state: 'IL', zip: '60601', role: 'member' },
    { fullName: 'Najat Elamin', email: 'najat@example.com', phone: '+1 317 555 0166', profession: 'Nurse', bio: 'Pediatric home care.', city: 'Indianapolis', state: 'IN', zip: '46201', role: 'member' },
    { fullName: 'Tariq Jallow', email: 'tariq@example.com', phone: '+1 515 555 0174', profession: 'Farmer', bio: 'Organic produce and delivery.', city: 'Des Moines', state: 'IA', zip: '50301', role: 'member' },
    { fullName: 'Mariam Sagbo', email: 'mariam@example.com', phone: '+1 785 555 0182', profession: 'Baker', bio: 'Bread, pastries and wedding cakes.', city: 'Wichita', state: 'KS', zip: '67201', role: 'member' },
    { fullName: 'Bright Andoh', email: 'bright@example.com', phone: '+1 502 555 0112', profession: 'Electrician', bio: 'Residential wiring and repairs.', city: 'Louisville', state: 'KY', zip: '40201', role: 'member' },
    { fullName: 'Grace OkaforLA', email: 'grace@example.com', phone: '+1 504 555 0120', profession: 'Caterer', bio: 'Creole and West African fusion catering.', city: 'New Orleans', state: 'LA', zip: '70112', role: 'member' },
    { fullName: 'Seydou Kaba', email: 'seydou@example.com', phone: '+1 207 555 0138', profession: 'Carpenter', bio: 'Custom woodwork and repairs.', city: 'Portland', state: 'ME', zip: '04101', role: 'member' },
    { fullName: 'Lamar Johnson', email: 'lamar@example.com', phone: '+1 410 555 0146', profession: 'Web Developer', bio: 'Websites for small businesses.', city: 'Baltimore', state: 'MD', zip: '21201', role: 'member' },
    { fullName: 'Yara Fofana', email: 'yara@example.com', phone: '+1 617 555 0154', profession: 'Teacher', bio: 'ESL and language instruction.', city: 'Boston', state: 'MA', zip: '02101', role: 'member' },
    { fullName: 'Samuel Adjapong', email: 'samuel@example.com', phone: '+1 313 555 0162', profession: 'Plumber', bio: 'Residential and commercial plumbing.', city: 'Detroit', state: 'MI', zip: '48201', role: 'member' },
    { fullName: 'Ruth Dlamini', email: 'ruth@example.com', phone: '+1 612 555 0170', profession: 'Accountant', bio: 'Taxes and small business accounting.', city: 'Minneapolis', state: 'MN', zip: '55401', role: 'member' },
    { fullName: 'Tendai Moyo', email: 'tendai@example.com', phone: '+1 601 555 0178', profession: 'Chef', bio: 'Soul food and event catering.', city: 'Jackson', state: 'MS', zip: '39201', role: 'member' },
    { fullName: 'Achille Ndaye', email: 'achille@example.com', phone: '+1 816 555 0186', profession: 'Barber', bio: 'Men\u2019s grooming and haircuts.', city: 'Kansas City', state: 'MO', zip: '64101', role: 'member' },
    { fullName: 'Nala Zulu', email: 'nala@example.com', phone: '+1 406 555 0151', profession: 'Guide', bio: 'Outdoor tours and excursions.', city: 'Billings', state: 'MT', zip: '59101', role: 'member' },
    { fullName: 'Prosper Osei', email: 'prosper@example.com', phone: '+1 402 555 0159', profession: 'Trainer', bio: 'Personal fitness training.', city: 'Omaha', state: 'NE', zip: '68101', role: 'member' },
    { fullName: 'Zuri Banda', email: 'zuri@example.com', phone: '+1 702 555 0167', profession: 'Event Planner', bio: 'Weddings and corporate events.', city: 'Las Vegas', state: 'NV', zip: '89101', role: 'member' },
    { fullName: 'Omari Juma', email: 'omari@example.com', phone: '+1 603 555 0175', profession: 'Plumber', bio: 'Kitchen and bathroom plumbing.', city: 'Manchester', state: 'NH', zip: '03101', role: 'member' },
    { fullName: 'Yemisi Aina', email: 'yemisi@example.com', phone: '+1 973 555 0183', profession: 'Hair Stylist', bio: 'Braids and natural hair care.', city: 'Newark', state: 'NJ', zip: '07101', role: 'member' },
    { fullName: 'Carla Duarte', email: 'carla@example.com', phone: '+1 505 555 0143', profession: 'Potter', bio: 'Handmade pottery and ceramics.', city: 'Albuquerque', state: 'NM', zip: '87101', role: 'member' },
    { fullName: 'Isaac MensahNC', email: 'isaac@example.com', phone: '+1 704 555 0151', profession: 'Electrician', bio: 'Residential and solar wiring.', city: 'Charlotte', state: 'NC', zip: '28201', role: 'member' },
    { fullName: 'Halima Yusuf', email: 'halima@example.com', phone: '+1 701 555 0160', profession: 'Cook', bio: 'Home meals and catering.', city: 'Fargo', state: 'ND', zip: '58102', role: 'member' },
    { fullName: 'Dennis Okonkwo', email: 'dennis@example.com', phone: '+1 614 555 0168', profession: 'Mechanic', bio: 'Auto repair and maintenance.', city: 'Columbus', state: 'OH', zip: '43201', role: 'member' },
    { fullName: 'Kira Johnson', email: 'kira@example.com', phone: '+1 405 555 0176', profession: 'Caterer', bio: 'Barbecue and event catering.', city: 'Oklahoma City', state: 'OK', zip: '73101', role: 'member' },
    { fullName: 'Moses Adeyemi', email: 'moses@example.com', phone: '+1 503 555 0184', profession: 'Landscaper', bio: 'Garden design and lawn care.', city: 'Portland', state: 'OR', zip: '97201', role: 'member' },
    { fullName: 'Yaa BoatengPA', email: 'yaa_b@example.com', phone: '+1 215 555 0144', profession: 'Boutique Owner', bio: 'African fashion and accessories.', city: 'Philadelphia', state: 'PA', zip: '19101', role: 'member' },
    { fullName: 'Renee Fenton', email: 'renee@example.com', phone: '+1 401 555 0152', profession: 'Baker', bio: 'Artisan bread and pastries.', city: 'Providence', state: 'RI', zip: '02903', role: 'member' },
    { fullName: 'Kwaku Sarpong', email: 'kwaku@example.com', phone: '+1 843 555 0160', profession: 'Fisherman', bio: 'Fresh catch and seafood delivery.', city: 'Charleston', state: 'SC', zip: '29401', role: 'member' },
    { fullName: 'Naledi Mokoena', email: 'naledi@example.com', phone: '+1 605 555 0168', profession: 'Rancher', bio: 'Cattle and produce supplies.', city: 'Sioux Falls', state: 'SD', zip: '57101', role: 'member' },
    { fullName: 'Conrad Ade', email: 'conrad@example.com', phone: '+1 901 555 0176', profession: 'Musician', bio: 'Live music and event performances.', city: 'Memphis', state: 'TN', zip: '38101', role: 'member' },
    { fullName: 'Hawa Kone', email: 'hawa@example.com', phone: '+1 385 555 0184', profession: 'Photographer', bio: 'Portraits and event photography.', city: 'Salt Lake City', state: 'UT', zip: '84101', role: 'member' },
    { fullName: 'Peter Gbakolo', email: 'peter@example.com', phone: '+1 802 555 0155', profession: 'Carpenter', bio: 'Woodworking and furniture.', city: 'Burlington', state: 'VT', zip: '05401', role: 'member' },
    { fullName: 'Kendra Washington', email: 'kendra@example.com', phone: '+1 757 555 0163', profession: 'Nurse', bio: 'Home health care and support.', city: 'Virginia Beach', state: 'VA', zip: '23450', role: 'member' },
    { fullName: 'Omar DialloWA', email: 'omar@example.com', phone: '+1 509 555 0171', profession: 'Carpenter', bio: 'Decks and home renovations.', city: 'Spokane', state: 'WA', zip: '99201', role: 'member' },
    { fullName: 'Joy MensahWV', email: 'joy@example.com', phone: '+1 304 555 0179', profession: 'Baker', bio: 'Cakes and desserts.', city: 'Charleston', state: 'WV', zip: '25301', role: 'member' },
    { fullName: 'Theo Nduka', email: 'theo@example.com', phone: '+1 608 555 0187', profession: 'Electrician', bio: 'Residential wiring and panels.', city: 'Madison', state: 'WI', zip: '53701', role: 'member' },
    { fullName: 'Lena Sakala', email: 'lena@example.com', phone: '+1 307 555 0114', profession: 'Guide', bio: 'Wildlife and park tours.', city: 'Cheyenne', state: 'WY', zip: '82001', role: 'member' },
    { fullName: 'Amara Nwachukwu', email: 'amara@example.com', phone: '+1 404 555 0201', profession: 'Immigration Lawyer', bio: 'Visas, green cards, citizenship and deportation defense.', city: 'Atlanta', state: 'GA', zip: '30301', role: 'member' },
    { fullName: 'Kofi MensahEsq', email: 'kofi_law@example.com', phone: '+1 240 555 0202', profession: 'Business Lawyer', bio: 'Business formation, contracts, trademarks and compliance.', city: 'Silver Spring', state: 'MD', zip: '20901', role: 'member' },
    { fullName: 'Gbenga AdeyemiLaw', email: 'gbenga@example.com', phone: '+1 646 555 0203', profession: 'Immigration Lawyer', bio: 'Family-based and employment-based immigration.', city: 'New York', state: 'NY', zip: '10018', role: 'member' },
    { fullName: 'Amara Obi', email: 'amara_obi@example.com', phone: '+1 832 555 0204', profession: 'Family Lawyer', bio: 'Divorce, custody, adoption and estate planning.', city: 'Houston', state: 'TX', zip: '77002', role: 'member' },
    { fullName: 'Zulu Chaduka', email: 'zulu@example.com', phone: '+1 305 555 0205', profession: 'Real Estate Lawyer', bio: 'Residential and commercial closings, leases and disputes.', city: 'Miami', state: 'FL', zip: '33101', role: 'member' },
    { fullName: 'Nia Trader', email: 'nia_law@example.com', phone: '+1 312 555 0206', profession: 'Criminal Defense Lawyer', bio: 'Criminal defense and post-conviction relief.', city: 'Chicago', state: 'IL', zip: '60601', role: 'member' },
    { fullName: 'Sekou DoumbiaEsq', email: 'sekou_law@example.com', phone: '+1 404 555 0207', profession: 'Contracts Lawyer', bio: 'Reviewing and drafting business and service contracts.', city: 'Atlanta', state: 'GA', zip: '30303', role: 'member' },
    { fullName: 'Admin KNXION', email: 'admin@knxion.com', phone: '+1 000 000 0000', profession: 'Platform Administrator', bio: 'Africa KNXION administrator, serving the US community.', city: 'Washington', state: 'DC', zip: '20001', role: 'admin' },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (full_name, email, phone, profession, bio, city, state, zip, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAccount = db.prepare(`
    INSERT INTO accounts (user_id, username, password_hash)
    VALUES (?, ?, ?)
  `);

  const insertOffer = db.prepare(`
    INSERT INTO service_offers (user_id, title, description, price, category, city, state, zip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRequest = db.prepare(`
    INSERT INTO service_requests (user_id, title, description, category, city, state, zip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertReview = db.prepare(`
    INSERT INTO reviews (reviewer_id, professional_id, rating, comment)
    VALUES (?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    // Users + accounts
    const userIds = {};
    sampleUsers.forEach((u, i) => {
      const r = insertUser.run(u.fullName, u.email, u.phone, u.profession, u.bio, u.city, u.state, u.zip, u.role);
      userIds[u.email] = r.lastInsertRowid;
      insertAccount.run(r.lastInsertRowid, `user${i + 1}`, hashPassword('password123'));
    });
    // Give the admin a friendly username
    db.prepare("UPDATE accounts SET username = 'admin' WHERE user_id = ?")
      .run(userIds['admin@knxion.com']);

    // Offers — mirror the skills of members across all states
    insertOffer.run(userIds['awa@example.com'], 'Residential plumbing', 'Leak repair, pipe installation, water heaters and bathrooms.', 'From $120', 'Plumbing', 'Atlanta', 'GA', '30201');
    insertOffer.run(userIds['chidi@example.com'], 'Custom furniture & cabinets', 'Hand-built tables, shelves and fitted cabinets.', 'From $250', 'Carpentry', 'Decatur', 'GA', '30030');
    insertOffer.run(userIds['yaa@example.com'], 'Braids, weaves & natural hair', 'Protective styles and cuts for all hair types.', 'From $80', 'Hair & Beauty', 'Atlanta', 'GA', '30303');
    insertOffer.run(userIds['kwame@example.com'], 'Electrical wiring & troubleshooting', 'Safe installations, inspections and repairs.', 'From $150', 'Electrical', 'Washington', 'DC', '20001');
    insertOffer.run(userIds['moussa@example.com'], 'Kitchen & bath plumbing', 'Emergency calls, faucets, drains and fixtures.', 'From $110', 'Plumbing', 'Queens', 'NY', '11385');
    insertOffer.run(userIds['ada@example.com'], 'West African event catering', 'Jollof rice, grilled meats and desserts for events.', 'Negotiable', 'Catering', 'Manhattan', 'NY', '10001');
    insertOffer.run(userIds['fatou@example.com'], 'African fabrics & fittings', 'Authentic wax prints, made-to-measure outfits.', 'Variable', 'Fashion', 'Brooklyn', 'NY', '11201');
    insertOffer.run(userIds['tunde@example.com'], 'Website & web app development', 'Modern, responsive websites and business apps.', 'Negotiable', 'IT / Web', 'Houston', 'TX', '77001');
    insertOffer.run(userIds['emeka@example.com'], 'Home wiring & solar setup', 'Safe wiring, panels and solar installations.', 'From $180', 'Electrical', 'Houston', 'TX', '77002');
    insertOffer.run(userIds['binta@example.com'], 'Wax prints & bridal wear', 'Traditional outfits, interlock and bridal sets.', 'From $300', 'Fashion', 'Dallas', 'TX', '76001');
    insertOffer.run(userIds['nia@example.com'], 'Branding & logo design', 'Clean, memorable brand identities.', 'From $400', 'Design', 'Miami', 'FL', '33101');
    insertOffer.run(userIds['sekou@example.com'], 'Deck & cabinetry work', 'Decks, shelving and general woodwork.', 'From $200', 'Carpentry', 'Miami', 'FL', '33161');
    insertOffer.run(userIds['zainab@example.com'], 'Jollof & grilled catering', 'Event catering with traditional favorites.', 'From $350', 'Catering', 'Orlando', 'FL', '32801');
    insertOffer.run(userIds['aminata@example.com'], 'Home health & patient care', 'Compassionate nursing care and check-ups at home.', 'From $60/hr', 'Healthcare', 'Birmingham', 'AL', '35201');
    insertOffer.run(userIds['kalou@example.com'], 'Home cooking & meal prep', 'Fresh home-cooked meals and weekly meal prep.', 'From $40', 'Catering', 'Anchorage', 'AK', '99501');
    insertOffer.run(userIds['safa@example.com'], 'Lawn care & landscape design', 'Mowing, garden beds, irrigation and cleanups.', 'From $90', 'Landscaping', 'Phoenix', 'AZ', '85001');
    insertOffer.run(userIds['imani@example.com'], 'Custom tailoring & alterations', 'Made-to-fit clothing, hemming and repairs.', 'From $50', 'Fashion', 'Little Rock', 'AR', '72201');
    insertOffer.run(userIds['ngozi@example.com'], 'Private chef service', 'Personal chef for events and weekly meals.', 'From $300', 'Catering', 'Sacramento', 'CA', '94203');
    insertOffer.run(userIds['yusufca@example.com'], 'Bookkeeping & tax prep', 'Small business books, payroll and tax filing.', 'From $150', 'Business', 'Sacramento', 'CA', '95814');
    insertOffer.run(userIds['awa_cisse@example.com'], 'Men\u2019s grooming & fades', 'Precision fades, beard trims and hot towel shaves.', 'From $35', 'Hair & Beauty', 'Denver', 'CO', '80201');
    insertOffer.run(userIds['fanta@example.com'], 'Math & science tutoring', 'One-on-one support from middle school to college.', 'From $55/hr', 'Education', 'Hartford', 'CT', '06101');
    insertOffer.run(userIds['mamadou@example.com'], 'Interior & exterior painting', 'Clean, professional paint jobs for homes.', 'From $250', 'Home Services', 'Wilmington', 'DE', '19801');
    insertOffer.run(userIds['kofi@example.com'], 'Event & luau catering', 'Fresh local dishes for gatherings and parties.', 'Negotiable', 'Catering', 'Honolulu', 'HI', '96813');
    insertOffer.run(userIds['zola@example.com'], 'Auto repair & diagnostics', 'Engine, brake and AC diagnostics and repair.', 'From $120', 'Auto', 'Boise', 'ID', '83701');
    insertOffer.run(userIds['adama@example.com'], 'West African restaurant dishes', 'Authentic stews, jollof and grilled specialties.', 'From $25', 'Catering', 'Chicago', 'IL', '60601');
    insertOffer.run(userIds['najat@example.com'], 'Pediatric home care', 'Trusted nursing care for infants and children.', 'From $70/hr', 'Healthcare', 'Indianapolis', 'IN', '46201');
    insertOffer.run(userIds['tariq@example.com'], 'Organic farm produce', 'Fresh vegetables and farm-to-door delivery.', 'CSV share', 'Agriculture', 'Des Moines', 'IA', '50301');
    insertOffer.run(userIds['mariam@example.com'], 'Bread, pastries & cakes', 'Artisan breads, celebration cakes and desserts.', 'From $30', 'Catering', 'Wichita', 'KS', '67201');
    insertOffer.run(userIds['bright@example.com'], 'Residential electrical', 'Wiring, outlets, lighting and fixture installs.', 'From $140', 'Electrical', 'Louisville', 'KY', '40201');
    insertOffer.run(userIds['grace@example.com'], 'Creole fusion catering', 'Blend of Creole and West African flavors.', 'From $320', 'Catering', 'New Orleans', 'LA', '70112');
    insertOffer.run(userIds['seydou@example.com'], 'Custom woodwork', 'Furniture, shelving and restoration projects.', 'From $220', 'Carpentry', 'Portland', 'ME', '04101');
    insertOffer.run(userIds['lamar@example.com'], 'Small business websites', 'Affordable, modern sites with booking forms.', 'From $400', 'IT / Web', 'Baltimore', 'MD', '21201');
    insertOffer.run(userIds['yara@example.com'], 'ESL & language lessons', 'English and French instruction for all levels.', 'From $45/hr', 'Education', 'Boston', 'MA', '02101');
    insertOffer.run(userIds['samuel@example.com'], 'Residential plumbing', 'Repairs, water heaters and fixture installs.', 'From $110', 'Plumbing', 'Detroit', 'MI', '48201');
    insertOffer.run(userIds['ruth@example.com'], 'Small business accounting', 'Books, payroll and tax filing for local firms.', 'From $140', 'Business', 'Minneapolis', 'MN', '55401');
    insertOffer.run(userIds['tendai@example.com'], 'Soul food & event catering', 'Home-style classics for family and corporate events.', 'From $300', 'Catering', 'Jackson', 'MS', '39201');
    insertOffer.run(userIds['achille@example.com'], 'Men\u2019s grooming & cuts', 'Skin fades, lineups and beard care.', 'From $30', 'Hair & Beauty', 'Kansas City', 'MO', '64101');
    insertOffer.run(userIds['nala@example.com'], 'Outdoor & hiking tours', 'Guided scenic tours and day hikes.', 'From $80', 'Tourism', 'Billings', 'MT', '59101');
    insertOffer.run(userIds['prosper@example.com'], 'Personal fitness training', 'Strength, conditioning and weight loss plans.', 'From $60/hr', 'Fitness', 'Omaha', 'NE', '68101');
    insertOffer.run(userIds['zuri@example.com'], 'Event planning & coordination', 'Weddings, birthdays and corporate events.', 'From $500', 'Event Planning', 'Las Vegas', 'NV', '89101');
    insertOffer.run(userIds['omari@example.com'], 'Bathroom & kitchen plumbing', 'Renovation plumbing and fixture installs.', 'From $115', 'Plumbing', 'Manchester', 'NH', '03101');
    insertOffer.run(userIds['yemisi@example.com'], 'Braids & natural hair', 'Box braids, twists, cornrows and care.', 'From $85', 'Hair & Beauty', 'Newark', 'NJ', '07101');
    insertOffer.run(userIds['carla@example.com'], 'Handmade pottery & ceramics', 'Custom mugs, bowls and decorative pieces.', 'From $45', 'Crafts', 'Albuquerque', 'NM', '87101');
    insertOffer.run(userIds['isaac@example.com'], 'Residential & solar wiring', 'Safe wiring and solar panel setup.', 'From $160', 'Electrical', 'Charlotte', 'NC', '28201');
    insertOffer.run(userIds['halima@example.com'], 'Home meals & catering', 'Fresh daily meals and small event catering.', 'From $35', 'Catering', 'Fargo', 'ND', '58102');
    insertOffer.run(userIds['dennis@example.com'], 'Auto repair & maintenance', 'Tune-ups, brakes and general maintenance.', 'From $110', 'Auto', 'Columbus', 'OH', '43201');
    insertOffer.run(userIds['kira@example.com'], 'Barbecue & event catering', 'Smoked meats and sides for gatherings.', 'From $280', 'Catering', 'Oklahoma City', 'OK', '73101');
    insertOffer.run(userIds['moses@example.com'], 'Garden design & lawn care', 'Custom gardens, sod and seasonal cleanups.', 'From $95', 'Landscaping', 'Portland', 'OR', '97201');
    insertOffer.run(userIds['yaa_b@example.com'], 'African fashion & accessories', 'Dresses, headwraps and statement jewelry.', 'From $60', 'Fashion', 'Philadelphia', 'PA', '19101');
    insertOffer.run(userIds['renee@example.com'], 'Artisan bread & pastries', 'Sourdough, croissants and custom desserts.', 'From $28', 'Catering', 'Providence', 'RI', '02903');
    insertOffer.run(userIds['kwaku@example.com'], 'Fresh seafood delivery', 'Daily catch and seafood prep.', 'Market price', 'Agriculture', 'Charleston', 'SC', '29401');
    insertOffer.run(userIds['naledi@example.com'], 'Ranch & produce supply', 'Local meat, produce and farm supplies.', 'From $35', 'Agriculture', 'Sioux Falls', 'SD', '57101');
    insertOffer.run(userIds['conrad@example.com'], 'Live music for events', 'Solo and band performances for celebrations.', 'From $250', 'Entertainment', 'Memphis', 'TN', '38101');
    insertOffer.run(userIds['hawa@example.com'], 'Portrait & event photography', 'Portraits, social media and event coverage.', 'From $120', 'Design', 'Salt Lake City', 'UT', '84101');
    insertOffer.run(userIds['peter@example.com'], 'Woodworking & furniture', 'Handmade furniture and home repairs.', 'From $200', 'Carpentry', 'Burlington', 'VT', '05401');
    insertOffer.run(userIds['kendra@example.com'], 'Home health nursing', 'Skilled in-home care and support.', 'From $65/hr', 'Healthcare', 'Virginia Beach', 'VA', '23450');
    insertOffer.run(userIds['omar@example.com'], 'Decks & home renovations', 'Decks, fences and interior remodels.', 'From $230', 'Carpentry', 'Spokane', 'WA', '99201');
    insertOffer.run(userIds['joy@example.com'], 'Custom cakes & desserts', 'Layer cakes, cupcakes and dessert tables.', 'From $45', 'Catering', 'Charleston', 'WV', '25301');
    insertOffer.run(userIds['theo@example.com'], 'Residential wiring & panels', 'Breaker panels, outlets and lighting.', 'From $145', 'Electrical', 'Madison', 'WI', '53701');
    insertOffer.run(userIds['lena@example.com'], 'Wildlife & park tours', 'Guided park and wildlife day tours.', 'From $90', 'Tourism', 'Cheyenne', 'WY', '82001');
    insertOffer.run(userIds['amara@example.com'], 'Immigration consultations', 'Visas, green cards, citizenship and deportation defense.', 'From $200', 'Legal', 'Atlanta', 'GA', '30301');
    insertOffer.run(userIds['kofi_law@example.com'], 'Business formation & contracts', 'LLC setup, contracts, trademarks and compliance.', 'From $350', 'Legal', 'Silver Spring', 'MD', '20901');
    insertOffer.run(userIds['gbenga@example.com'], 'Work & family immigration', 'Employment and family-based visa applications.', 'From $250', 'Legal', 'New York', 'NY', '10018');
    insertOffer.run(userIds['amara_obi@example.com'], 'Family law & estate planning', 'Divorce, custody, adoption and wills.', 'From $200', 'Legal', 'Houston', 'TX', '77002');
    insertOffer.run(userIds['zulu@example.com'], 'Real estate closings', 'Residential and commercial closings, leases and disputes.', 'From $300', 'Legal', 'Miami', 'FL', '33101');
    insertOffer.run(userIds['nia_law@example.com'], 'Criminal defense', 'Defense and post-conviction relief.', 'From $500', 'Legal', 'Chicago', 'IL', '60601');
    insertOffer.run(userIds['sekou_law@example.com'], 'Contract review & drafting', 'Reviewing and drafting service and business contracts.', 'From $180', 'Legal', 'Atlanta', 'GA', '30303');

    // Requests — what the community needs across the country
    insertRequest.run(userIds['awa@example.com'], 'Website for my plumbing business', 'Simple portfolio site with a contact form and reviews.', 'IT / Web', 'Atlanta', 'GA', '30201');
    insertRequest.run(userIds['chidi@example.com'], 'Logo & flyer design', 'Branding for my carpentry shop.', 'Design', 'Decatur', 'GA', '30030');
    insertRequest.run(userIds['yaa@example.com'], 'Booking system for hair studio', 'Online appointments and reminders for clients.', 'IT / Web', 'Atlanta', 'GA', '30303');
    insertRequest.run(userIds['kwame@example.com'], 'Company logo & brand kit', 'A modern identity for my electrical company.', 'Design', 'Washington', 'DC', '20001');
    insertRequest.run(userIds['moussa@example.com'], 'Van wrap for work truck', 'Full-vehicle graphics for my plumbing service.', 'Design', 'Queens', 'NY', '11385');
    insertRequest.run(userIds['ada@example.com'], 'Commercial catering equipment', 'Chafing dishes, serving trays and warmers.', 'Catering', 'Manhattan', 'NY', '10001');
    insertRequest.run(userIds['fatou@example.com'], 'Kitchen renovation - plumbing', 'Remodeling my boutique kitchen and washroom.', 'Plumbing', 'Brooklyn', 'NY', '11201');
    insertRequest.run(userIds['tunde@example.com'], 'Landed model for my website', 'Photography for a professional portfolio.', 'Design', 'Houston', 'TX', '77001');
    insertRequest.run(userIds['emeka@example.com'], 'Licensing & permits help', 'Guidance for electrical contracting licenses.', 'Business', 'Houston', 'TX', '77002');
    insertRequest.run(userIds['binta@example.com'], 'Online store for my boutique', 'An e-commerce catalog for my clothing line.', 'IT / Web', 'Dallas', 'TX', '75201');
    insertRequest.run(userIds['nia@example.com'], 'Portfolio website', 'Showcase of my design work online.', 'IT / Web', 'Miami', 'FL', '33101');
    insertRequest.run(userIds['sekou@example.com'], 'Solar panel installation', 'Panels for my workshop roof.', 'Electrical', 'Miami', 'FL', '33161');
    insertRequest.run(userIds['zainab@example.com'], 'Event crew for catering', 'Reliable servers and cooks for events.', 'Catering', 'Orlando', 'FL', '32801');
    insertRequest.run(userIds['aminata@example.com'], 'Nursing license renewal course', 'Continuing education credits for nursing.', 'Education', 'Birmingham', 'AL', '35201');
    insertRequest.run(userIds['safa@example.com'], 'Irrigation system install', 'Automated watering for client properties.', 'Landscaping', 'Phoenix', 'AZ', '85001');
    insertRequest.run(userIds['ngozi@example.com'], 'Commercial kitchen space', 'Renting a kitchen for meal prep.', 'Catering', 'Sacramento', 'CA', '94203');
    insertRequest.run(userIds['awa_cisse@example.com'], 'Chair and station for barbershop', 'Quality equipment for my new shop.', 'Business', 'Denver', 'CO', '80201');
    insertRequest.run(userIds['fanta@example.com'], 'Lesson planning software', 'Tools to schedule and track tutoring sessions.', 'IT / Web', 'Hartford', 'CT', '06101');
    insertRequest.run(userIds['adama@example.com'], 'Restaurant renovation - plumbing', 'Updating my restaurant kitchen plumbing.', 'Plumbing', 'Chicago', 'IL', '60601');
    insertRequest.run(userIds['najat@example.com'], 'Home care supplies', 'Reliable medical supplies for clients.', 'Healthcare', 'Indianapolis', 'IN', '46201');
    insertRequest.run(userIds['mariam@example.com'], 'Commercial oven upgrade', 'A new convection oven for my bakery.', 'Business', 'Wichita', 'KS', '67201');
    insertRequest.run(userIds['grace@example.com'], 'Catering van', 'A delivery vehicle for my catering business.', 'Business', 'New Orleans', 'LA', '70112');
    insertRequest.run(userIds['lamar@example.com'], 'Logo design for web agency', 'A clean brand mark for my studio.', 'Design', 'Baltimore', 'MD', '21201');
    insertRequest.run(userIds['yara@example.com'], 'ESL class materials', 'Workbooks and teaching resources.', 'Education', 'Boston', 'MA', '02101');
    insertRequest.run(userIds['samuel@example.com'], 'Logbook & estimating software', 'Tools to quote and track plumbing jobs.', 'IT / Web', 'Detroit', 'MI', '48201');
    insertRequest.run(userIds['ruth@example.com'], 'Payroll system setup', 'Help automating payroll for my clients.', 'Business', 'Minneapolis', 'MN', '55401');
    insertRequest.run(userIds['achille@example.com'], 'New clippers & barber chairs', 'Upgrade equipment for my shop.', 'Business', 'Kansas City', 'MO', '64101');
    insertRequest.run(userIds['zuri@example.com'], 'Event decor & flowers', 'A florist and decorator for weddings.', 'Event Planning', 'Las Vegas', 'NV', '89101');
    insertRequest.run(userIds['yemisi@example.com'], 'Hair product vendor', 'Quality braiding hair and care products.', 'Business', 'Newark', 'NJ', '07101');
    insertRequest.run(userIds['isaac@example.com'], 'Solar panel partner', 'A licensed installer to team up with.', 'Electrical', 'Charlotte', 'NC', '28201');
    insertRequest.run(userIds['dennis@example.com'], 'Shop lift & tools', 'Equipment for my auto shop.', 'Auto', 'Columbus', 'OH', '43201');
    insertRequest.run(userIds['moses@example.com'], 'Landscaping trailer', 'A trailer to haul equipment.', 'Business', 'Portland', 'OR', '97201');
    insertRequest.run(userIds['yaa_b@example.com'], 'Mannequins & display racks', 'Fixtures for my clothing boutique.', 'Business', 'Philadelphia', 'PA', '19101');
    insertRequest.run(userIds['hawa@example.com'], 'Editing software subscription', 'Professional photo editing tools.', 'IT / Web', 'Salt Lake City', 'UT', '84101');
    insertRequest.run(userIds['kendra@example.com'], 'Medical transport service', 'Safe transport for home care clients.', 'Healthcare', 'Virginia Beach', 'VA', '23450');
    insertRequest.run(userIds['theo@example.com'], 'Wireless test equipment', 'Tools for safe electrical testing.', 'Electrical', 'Madison', 'WI', '53701');
    insertRequest.run(userIds['awa@example.com'], 'Citizenship application help', 'Assistance preparing my naturalization paperwork.', 'Legal', 'Atlanta', 'GA', '30201');
    insertRequest.run(userIds['emeka@example.com'], 'Green card application', 'Help with an employment-based green card application.', 'Legal', 'Houston', 'TX', '77001');
    insertRequest.run(userIds['amara@example.com'], 'Business trademarks', 'Protecting the name and logo of my firm.', 'Legal', 'Atlanta', 'GA', '30301');
    insertRequest.run(userIds['adama@example.com'], 'Contract for my restaurant', 'A review of my lease and vendor contracts.', 'Legal', 'Chicago', 'IL', '60601');
    insertRequest.run(userIds['najat@example.com'], 'Estate planning & will', 'Setting up a will and medical directives.', 'Legal', 'Indianapolis', 'IN', '46201');

    // Reviews
    insertReview.run(userIds['awa@example.com'], userIds['tunde@example.com'], 5, 'Very skilled, delivered on time.');
    insertReview.run(userIds['kwame@example.com'], userIds['nia@example.com'], 4, 'Nice design work, quick communication.');
    insertReview.run(userIds['fatou@example.com'], userIds['awa@example.com'], 5, 'Great plumber, clean work.');
    insertReview.run(userIds['tunde@example.com'], userIds['fatou@example.com'], 5, 'Beautiful fabrics and fitting.');
  });

  seed();
  return true;
}

export default db;
