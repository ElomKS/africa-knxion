// Africa KNXION - service & community platform
import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import {
  registerUserWithAccount,
  authenticateUser,
  getUserById,
  getAllUsers,
  searchUsers,
  updateUser,
  deleteUser,
  getAccountByUserId,
  getAccountByUsername,
  changeAccountUsername,
  changePassword,
  createPasswordReset,
  getValidPasswordReset,
  markPasswordResetUsed,
  getAllOffers,
  getOfferById,
  createOffer,
  searchOffers,
  deleteOffer,
  getAllRequests,
  getRequestById,
  createRequest,
  searchRequests,
  updateRequestStatus,
  deleteRequest,
  createReview,
  getReviewsForProfessional,
  getAverageRating,
  addContactMessage,
  getContactMessages,
  deleteContactMessage,
  getStats,
  seedDatabase,
  sendMessage,
  getConversationsForUser,
  getConversationForUser,
  getMessagesForConversation,
  markConversationRead,
  countUnreadMessages,
  createReservation,
  getReservationById,
  getReservationsForOffer,
  getReservationsForOfferOwner,
  getReservationsForClient,
  updateReservationStatus,
  getNotifications,
  countUnreadNotifications,
  markAllNotificationsRead,
  createNotification,
  getConversationByIdForUser,
  getOrCreateConversationFor,
  setUserRole,
  setUserActive,
  setUserFeatured,
  setOfferActive,
  setOfferFeatured,
  getAllReviews,
  deleteReview,
  getUsersByState,
  getCategoriesCount,
  createProUpgrade,
  getProUpgrades,
  setProUpgradeStatus,
} from './db.js';
import { US_STATES, stateLabel, cityState, formatLocation, normalizeState } from './states.js';
import { sendPasswordResetEmail, sendContactNotification, sendProUpgradeNotification, getMailMode, mailerSettings } from './mailer.js';
import { getProPriceForOfferCount, getProSavings, PRO_BASE_PRICE, PRO_ADDITIONAL_PRICE } from './pricing.js';

export const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

if (isProduction && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is required in production. Refusing to start.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'"],
    },
  },
}));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'knxion-secret-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: isProduction,
    sameSite: 'lax',
  },
}));

seedDatabase();

/* ---------- Helpers ---------- */

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.userId) {
    const user = getUserById(req.session.userId);
    if (user && user.role === 'admin') return next();
  }
  return res.status(403).render('error', { title: 'Access denied', error: 'Admin access required', user: req.session.user });
}

function currentUser(req) {
  if (!req.session.userId) return null;
  return getUserById(req.session.userId);
}

function safeNext(value) {
  if (typeof value !== 'string' || !value) return '/';
  // Only allow internal relative paths: start with '/', no '//', no ':' (so no
  // 'https://', '//host', 'javascript:' ...) and no backslash tricks.
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.includes('\\')) return '/';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return '/';
  return value;
}

// Simple in-memory rate limiter (per IP + bucket). Good enough for the free
// Render tier; a distributed store would be needed for horizontal scaling.
const rateBuckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).render('error', {
        title: 'Too many attempts',
        error: `Too many attempts. Please try again in ${retryAfter} seconds.`,
        user: req.session.user,
      });
    }
    next();
  };
}

// Periodically drop old buckets so the map does not grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) {
    if (b.resetAt <= now) rateBuckets.delete(k);
  }
}, 60_000).unref();

// Expose current user to all views
app.use((req, res, next) => {
  res.locals.user = currentUser(req);
  res.locals.path = req.path;
  res.locals.states = US_STATES;
  res.locals.stateLabel = stateLabel;
  res.locals.cityState = cityState;
  res.locals.formatLocation = formatLocation;
  if (req.session.userId) {
    res.locals.unreadMessages = countUnreadMessages(req.session.userId);
    res.locals.unreadNotifications = countUnreadNotifications(req.session.userId);
  } else {
    res.locals.unreadMessages = 0;
    res.locals.unreadNotifications = 0;
  }
  next();
});

/* ---------- Home ---------- */

app.get('/', (req, res) => {
  const offers = getAllOffers().filter((o) => o.active !== 0).slice(0, 6);
  const requests = getAllRequests().filter((r) => r.status === 'open').slice(0, 6);
  const members = getAllUsers().filter((u) => u.role !== 'admin' && u.active !== 0).slice(0, 6);
  const stats = getStats();
  const memberCount = getAllUsers().filter((u) => u.role !== 'admin' && u.active !== 0).length;
  res.render('index', {
    title: 'Connect with the African community',
    offers,
    requests,
    members,
    statOffers: stats.activeOffers,
    statRequests: stats.openRequests,
    statMembers: memberCount,
  });
});

/* ---------- Directory ---------- */

app.get('/directory', (req, res) => {
  const q = req.query.q || '';
  const selectedState = normalizeState(req.query.state || '');
  const selectedCity = (req.query.city || '').trim();
  let members = q ? searchUsers(q) : getAllUsers();
  members = members.filter((u) => u.role !== 'admin' && u.active !== 0);
  if (selectedState) {
    members = members.filter((u) => normalizeState(u.state) === selectedState);
  }
  if (selectedCity) {
    members = members.filter((u) => (u.city || '').toLowerCase() === selectedCity.toLowerCase());
  }
  const allMembers = getAllUsers().filter((u) => u.role !== 'admin' && u.active !== 0);
  const cities = selectedState
    ? [...new Set(allMembers.filter((u) => normalizeState(u.state) === selectedState).map((u) => u.city).filter(Boolean))].sort()
    : [];
  res.render('directory', { title: 'Member directory', members, q, selectedState, selectedCity, cities });
});

app.get('/profiles/:id', (req, res) => {
  const id = Number(req.params.id);
  const member = getUserById(id);
  if (!member) return res.status(404).render('error', { title: 'Member not found', error: 'Member not found', user: req.session.user });
  const offers = getAllOffers().filter((o) => o.user_id === id && o.active !== 0);
  const reviews = getReviewsForProfessional(id);
  const rating = getAverageRating(id);
  res.render('profiles/show', { title: member.full_name, member, offers, reviews, rating });
});

/* ---------- Offers ---------- */

app.get('/services', (req, res) => {
  const q = req.query.q || '';
  const selectedState = normalizeState(req.query.state || '');
  const selectedCity = (req.query.city || '').trim();
  let offers = q ? searchOffers(q) : getAllOffers();
  offers = offers.filter((o) => o.active !== 0);
  if (selectedState) {
    offers = offers.filter((o) => normalizeState(o.state) === selectedState);
  }
  if (selectedCity) {
    offers = offers.filter((o) => (o.city || '').toLowerCase() === selectedCity.toLowerCase());
  }
  const allOffers = getAllOffers().filter((o) => o.active !== 0);
  const cities = selectedState
    ? [...new Set(allOffers.filter((o) => normalizeState(o.state) === selectedState).map((o) => o.city).filter(Boolean))].sort()
    : [];
  res.render('services/index', { title: 'Service offers', offers, q, selectedState, selectedCity, cities });
});

app.get('/services/new', requireAuth, (req, res) => {
  res.render('services/new', { title: 'Publish a service offer' });
});

app.post('/services', requireAuth, (req, res) => {
  const { title, description, price, category, city, state, zip } = req.body;
  if (!title || !description) {
    return res.status(400).render('services/new', { title: 'Publish a service offer', error: 'Title and description are required.' });
  }
  createOffer({
    userId: req.session.userId,
    title,
    description,
    price: price || '',
    category: category || '',
    city: city || '',
    state: normalizeState(state),
    zip: zip || '',
  });
  res.redirect('/services');
});

app.get('/services/:id', (req, res) => {
  const id = Number(req.params.id);
  const offer = getOfferById(id);
  if (!offer) return res.status(404).render('error', { title: 'Offer not found', error: 'Offer not found', user: req.session.user });
  const viewer = currentUser(req);
  const isOwner = viewer && (viewer.id === offer.user_id || viewer.role === 'admin');
  if (offer.active === 0 && !isOwner) {
    return res.status(404).render('error', { title: 'Offer not available', error: 'This offer is no longer available.', user: viewer });
  }
  res.render('services/show', { title: offer.title, offer });
});

app.post('/services/:id/delete', requireAdmin, (req, res) => {
  deleteOffer(Number(req.params.id));
  res.redirect('/services');
});

/* ---------- Requests ---------- */

app.get('/requests', (req, res) => {
  const q = req.query.q || '';
  const status = req.query.status || null;
  const selectedState = normalizeState(req.query.state || '');
  const selectedCity = (req.query.city || '').trim();
  let requests = q ? searchRequests(q) : getAllRequests(status);
  if (selectedState) {
    requests = requests.filter((r) => normalizeState(r.state) === selectedState);
  }
  if (selectedCity) {
    requests = requests.filter((r) => (r.city || '').toLowerCase() === selectedCity.toLowerCase());
  }
  const allRequests = getAllRequests(status);
  const cities = selectedState
    ? [...new Set(allRequests.filter((r) => normalizeState(r.state) === selectedState).map((r) => r.city).filter(Boolean))].sort()
    : [];
  res.render('requests/index', { title: 'Service requests', requests, q, status, selectedState, selectedCity, cities });
});

app.get('/requests/new', requireAuth, (req, res) => {
  res.render('requests/new', { title: 'Ask for a service' });
});

app.post('/requests', requireAuth, (req, res) => {
  const { title, description, category, city, state, zip } = req.body;
  if (!title || !description) {
    return res.status(400).render('requests/new', { title: 'Ask for a service', error: 'Title and description are required.' });
  }
  createRequest({
    userId: req.session.userId,
    title,
    description,
    category: category || '',
    city: city || '',
    state: normalizeState(state),
    zip: zip || '',
  });
  res.redirect('/requests');
});

app.get('/requests/:id', (req, res) => {
  const id = Number(req.params.id);
  const request = getRequestById(id);
  if (!request) return res.status(404).render('error', { title: 'Request not found', error: 'Request not found', user: req.session.user });
  const professionals = getAllUsers().filter((u) => u.role !== 'admin');
  res.render('requests/show', { title: request.title, request, professionals });
});

app.post('/requests/:id/status', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { status, professional_id } = req.body;
  const request = getRequestById(id);
  if (!request) return res.redirect('/requests');
  // Only the requester or an admin can update
  const user = currentUser(req);
  if (user.role !== 'admin' && request.user_id !== req.session.userId) {
    return res.status(403).render('error', { title: 'Not allowed', error: 'Not allowed', user });
  }
  const profId = professional_id ? Number(professional_id) : null;
  updateRequestStatus(id, status, profId);
  res.redirect(`/requests/${id}`);
});

app.post('/requests/:id/delete', requireAdmin, (req, res) => {
  deleteRequest(Number(req.params.id));
  res.redirect('/requests');
});

/* ---------- Reservations (book a service offer) ---------- */

app.get('/services/:id/book', requireAuth, (req, res) => {
  const offer = getOfferById(Number(req.params.id));
  if (!offer) return res.status(404).render('error', { title: 'Offer not found', error: 'Offer not found', user: req.session.user });
  if (offer.user_id === req.session.userId) return res.redirect(`/services/${offer.id}`);
  res.render('services/book', { title: `Book: ${offer.title}`, offer });
});

app.post('/services/:id/book', requireAuth, (req, res) => {
  const offerId = Number(req.params.id);
  const offer = getOfferById(offerId);
  if (!offer) return res.status(404).render('error', { title: 'Offer not found', error: 'Offer not found', user: req.session.user });
  if (offer.user_id === req.session.userId) return res.redirect(`/services/${offerId}`);
  const { message } = req.body;
  createReservation({ offerId, clientId: req.session.userId, message: message || '' });
  res.redirect('/account#bookings');
});

app.get('/reservations/:id/respond', requireAuth, (req, res) => {
  const reservation = getReservationById(Number(req.params.id));
  if (!reservation) return res.status(404).render('error', { title: 'Reservation not found', error: 'Reservation not found', user: req.session.user });
  const user = currentUser(req);
  if (user.role !== 'admin' && reservation.offer_owner !== req.session.userId) {
    return res.status(403).render('error', { title: 'Not allowed', error: 'Not allowed', user });
  }
  res.render('reservations/show', { title: 'Reservation', reservation });
});

app.post('/reservations/:id/status', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const reservation = getReservationById(id);
  if (!reservation) return res.redirect('/account');
  const user = currentUser(req);
  const allowedStatuses = ['accepted', 'declined', 'completed', 'cancelled'];
  if (!allowedStatuses.includes(status)) return res.redirect('/account');
  // The offer owner (or admin) may accept/decline/complete; the client may cancel.
  const isOwner = user.role === 'admin' || reservation.offer_owner === req.session.userId;
  const isClient = reservation.client_id === req.session.userId;
  const allowed = (status === 'cancelled') ? isClient || isOwner : isOwner;
  if (!allowed) {
    return res.status(403).render('error', { title: 'Not allowed', error: 'Not allowed', user });
  }
  updateReservationStatus(id, status);
  // Notify the other party about the status change.
  const otherId = (reservation.offer_owner === req.session.userId) ? reservation.client_id : reservation.offer_owner;
  const statusText = statusMap[status] || status;
  createNotification({
    userId: otherId,
    actorId: req.session.userId,
    type: 'reservation',
    refId: reservation.id,
    text: `Your booking for "${reservation.offer_title}" was ${statusText}.`,
  });
  res.redirect('/account#bookings');
});

const statusMap = {
  accepted: 'accepted',
  declined: 'declined',
  completed: 'completed',
  cancelled: 'cancelled',
};

/* ---------- Messages ---------- */

app.get('/messages', requireAuth, (req, res) => {
  const conversations = getConversationsForUser(req.session.userId);
  res.render('messages', { title: 'Messages', conversations });
});

app.get('/messages/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const conv = getConversationForUser(id, req.session.userId);
  if (!conv) return res.status(404).render('error', { title: 'Conversation not found', error: 'Conversation not found', user: req.session.user });
  markConversationRead(id, req.session.userId);
  const messages = getMessagesForConversation(id);
  const conversations = getConversationsForUser(req.session.userId);
  const otherId = conv.user_a === req.session.userId ? conv.user_b : conv.user_a;
  const other = getUserById(otherId);
  res.render('messages/show', { title: `Chat with ${other.full_name}`, conv, other, messages, conversations });
});

app.post('/messages/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const conv = getConversationForUser(id, req.session.userId);
  if (!conv) return res.redirect('/messages');
  const { body } = req.body;
  if (body && body.trim()) {
    const otherId = conv.user_a === req.session.userId ? conv.user_b : conv.user_a;
    sendMessage({ senderId: req.session.userId, recipientId: otherId, body: body.trim() });
  }
  res.redirect(`/messages/${id}`);
});

app.get('/messages/start/:userId', requireAuth, (req, res) => {
  const otherId = Number(req.params.userId);
  if (otherId === req.session.userId) return res.redirect('/messages');
  const other = getUserById(otherId);
  if (!other) return res.status(404).render('error', { title: 'Member not found', error: 'Member not found', user: req.session.user });
  const conv = getConversationByIdForUser(req.session.userId, otherId);
  if (conv) return res.redirect(`/messages/${conv.id}`);
  const created = getOrCreateConversationFor(req.session.userId, otherId);
  res.redirect(`/messages/${created.id}`);
});

/* ---------- Notifications ---------- */

app.get('/notifications', requireAuth, (req, res) => {
  const notifications = getNotifications(req.session.userId);
  markAllNotificationsRead(req.session.userId);
  res.render('notifications', { title: 'Notifications', notifications });
});

/* ---------- Reviews ---------- */

app.post('/profiles/:id/reviews', requireAuth, (req, res) => {
  const professionalId = Number(req.params.id);
  const { rating, comment } = req.body;
  const ratingNum = Number(rating);
  if (ratingNum < 1 || ratingNum > 5) {
    return res.redirect(`/profiles/${professionalId}`);
  }
  createReview({
    reviewerId: req.session.userId,
    professionalId,
    rating: ratingNum,
    comment: comment || '',
  });
  res.redirect(`/profiles/${professionalId}`);
});

/* ---------- Auth ---------- */

app.get('/auth/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('auth/register', { title: 'Join Africa KNXION' });
});

app.post('/auth/register', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), (req, res) => {
  const { full_name, email, phone, profession, bio, city, state, zip, username, password, password_confirm } = req.body;
  if (!full_name || !username || !password) {
    return res.status(400).render('auth/register', { title: 'Join Africa KNXION', error: 'Name, username and password are required.' });
  }
  if (password !== password_confirm) {
    return res.status(400).render('auth/register', { title: 'Join Africa KNXION', error: 'Passwords do not match.' });
  }
  try {
    const user = registerUserWithAccount({
      fullName: full_name,
      email: email || '',
      phone: phone || '',
      profession: profession || '',
      bio: bio || '',
      city: city || '',
      state: normalizeState(state),
      zip: zip || '',
      username,
      password,
    });
    req.session.userId = user.id;
    const next = safeNext(req.query.next);
    res.redirect(next);
  } catch (err) {
    return res.status(400).render('auth/register', { title: 'Join Africa KNXION', error: 'Username or email already in use.' });
  }
});

app.get('/auth/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('auth/login', { title: 'Login' });
});

app.post('/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), (req, res) => {
  const { username, password } = req.body;
  const user = authenticateUser(username, password);
  if (!user) {
    return res.status(400).render('auth/login', { title: 'Login', error: 'Invalid username or password.' });
  }
  if (user.active === 0) {
    return res.status(403).render('auth/login', { title: 'Login', error: 'This account has been deactivated. Contact an administrator.' });
  }
  req.session.userId = user.id;
  const next = safeNext(req.query.next);
  res.redirect(next);
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/auth/forgot', (req, res) => {
  res.render('auth/forgot', { title: 'Reset password', error: null, sent: false, requestedEmail: '' });
});

app.post('/auth/forgot', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
  const { username, email } = req.body;
  const account = getAccountByUsername(username || '');
  const user = account ? getUserById(account.user_id) : null;
  // Always answer with the same generic "sent" response to avoid account
  // enumeration, whether or not the account exists.
  if (account && user && (user.email || '').toLowerCase() === (email || '').toLowerCase() && user.active === 1) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    createPasswordReset(user.id, token, expiresAt);
    const host = req.headers.host || '';
    const resetUrl = `${req.protocol}://${host}/auth/reset/token/${token}`;
    sendPasswordResetEmail(user.email || email, resetUrl).catch((err) => {
      console.error('Failed to send password reset email:', err);
    });
  } else {
    // Burn a similar amount of time so responses look alike.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  res.render('auth/forgot', {
    title: 'Reset password', error: null, sent: true,
    requestedEmail: (email || '').toLowerCase(),
  });
});

app.get('/auth/reset/token/:token', (req, res) => {
  const reset = getValidPasswordReset(req.params.token);
  if (!reset) {
    return res.render('auth/reset-form', { title: 'Reset password', invalid: true, error: null, token: '' });
  }
  res.render('auth/reset-form', { title: 'Set new password', invalid: false, error: null, token: req.params.token });
});

app.post('/auth/reset/token', (req, res) => {
  const { token, new_password, new_password_confirm } = req.body;
  const reset = getValidPasswordReset(token || '');
  if (!reset) {
    return res.status(400).render('auth/reset-form', {
      title: 'Reset password', invalid: true,
      error: 'This reset link is invalid or expired (it is valid for 10 minutes).',
      token: '',
    });
  }
  if (!new_password || new_password.length < 6) {
    return res.status(400).render('auth/reset-form', {
      title: 'Set new password', invalid: false,
      error: 'New password must be at least 6 characters.', token,
    });
  }
  if (new_password !== new_password_confirm) {
    return res.status(400).render('auth/reset-form', {
      title: 'Set new password', invalid: false,
      error: 'Passwords do not match.', token,
    });
  }
  changePassword(reset.user_id, new_password);
  markPasswordResetUsed(reset.id);
  res.render('auth/reset-form', { title: 'Password reset', invalid: false, done: true, error: null, token: '' });
});

/* ---------- Account / profile management ---------- */

app.get('/account', requireAuth, (req, res) => {
  const user = currentUser(req);
  const account = getAccountByUserId(req.session.userId);
  const myOffers = getAllOffers().filter((o) => o.user_id === req.session.userId);
  const incomingBookings = getReservationsForOfferOwner(req.session.userId);
  const myBookings = getReservationsForClient(req.session.userId);
  const userok = req.query.userok === '1';
  const passok = req.query.passok === '1';
  const proPrice = getProPriceForOfferCount(myOffers.length);
  const proSavings = getProSavings(myOffers.length);
  const alreadyPro = Boolean(user.featured);
  res.render('account', { title: 'My account', member: user, account, myOffers, incomingBookings, myBookings, userok, passok, proPrice, proSavings, alreadyPro });
});

app.post('/account', requireAuth, (req, res) => {
  const { full_name, email, phone, profession, bio, city, state, zip } = req.body;
  updateUser(req.session.userId, {
    fullName: full_name,
    email: email || '',
    phone: phone || '',
    profession: profession || '',
    bio: bio || '',
    city: city || '',
    state: normalizeState(state),
    zip: zip || '',
  });
  res.redirect('/account');
});

app.post('/account/username', requireAuth, (req, res) => {
  const { current_username, new_username } = req.body;
  const account = getAccountByUserId(req.session.userId);
  const renderAccount = (extras) => res.status(400).render('account', Object.assign({
    title: 'My account', member: currentUser(req), account,
    myOffers: getAllOffers().filter((o) => o.user_id === req.session.userId),
    incomingBookings: getReservationsForOfferOwner(req.session.userId),
    myBookings: getReservationsForClient(req.session.userId),
    userok: false, passok: false,
  }, extras));
  if (!account || account.username !== current_username) {
    return renderAccount({ userError: 'Your current username does not match.' });
  }
  if (getAccountByUsername(new_username)) {
    return renderAccount({ userError: 'That username is already taken.' });
  }
  changeAccountUsername(req.session.userId, new_username);
  res.redirect('/account?userok=1');
});

app.post('/account/password', requireAuth, (req, res) => {
  const { current_password, new_password, new_password_confirm } = req.body;
  const account = getAccountByUserId(req.session.userId);
  const renderAccount = (extras) => res.status(400).render('account', Object.assign({
    title: 'My account', member: currentUser(req), account,
    myOffers: getAllOffers().filter((o) => o.user_id === req.session.userId),
    incomingBookings: getReservationsForOfferOwner(req.session.userId),
    myBookings: getReservationsForClient(req.session.userId),
    userok: false, passok: false,
  }, extras));
  const user = authenticateUser(account ? account.username : '', current_password);
  if (!user) {
    return renderAccount({ passError: 'Current password is incorrect.' });
  }
  if (!new_password || new_password.length < 6) {
    return renderAccount({ passError: 'New password must be at least 6 characters.' });
  }
  if (new_password !== new_password_confirm) {
    return renderAccount({ passError: 'New passwords do not match.' });
  }
  changePassword(req.session.userId, new_password);
  res.redirect(`/account?passok=1&u=${account ? encodeURIComponent(account.username) : ''}`);
});

/* ---------- Admin ---------- */

app.get('/admin', requireAdmin, (req, res) => {
  const user = currentUser(req);
  const stats = getStats();
  const members = getAllUsers().filter((u) => u.role !== 'admin');
  const admins = getAllUsers().filter((u) => u.role === 'admin');
  const recentOffers = getAllOffers().slice(0, 10);
  const usersByState = getUsersByState();
  const categories = getCategoriesCount();
  const proUpgrades = getProUpgrades();
  res.render('admin', { title: 'Admin dashboard', user, stats, members, admins, recentOffers, usersByState, categories, proUpgrades });
});

app.get('/admin/messages', requireAdmin, (req, res) => {
  const messages = getContactMessages();
  res.render('admin/messages', { title: 'Contact messages', messages });
});

app.post('/admin/messages/:id/delete', requireAdmin, (req, res) => {
  deleteContactMessage(Number(req.params.id));
  res.redirect('/admin/messages');
});

app.get('/admin/reviews', requireAdmin, (req, res) => {
  const reviews = getAllReviews();
  res.render('admin/reviews', { title: 'Review moderation', reviews });
});

app.post('/admin/reviews/:id/delete', requireAdmin, (req, res) => {
  deleteReview(Number(req.params.id));
  res.redirect('/admin/reviews');
});

app.post('/admin/users/:id/role', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.session.userId) {
    setUserRole(id, req.body.role === 'admin' ? 'admin' : 'member');
  }
  res.redirect('/admin');
});

app.post('/admin/users/:id/active', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = getUserById(id);
  // Never deactivate another admin via this route; keep self active.
  if (target && target.role !== 'admin') {
    setUserActive(id, req.body.active === '1');
  }
  res.redirect('/admin');
});

app.post('/admin/offers/:id/active', requireAdmin, (req, res) => {
  setOfferActive(Number(req.params.id), req.body.active === '1');
  res.redirect('/admin#offers');
});

app.post('/admin/offers/:id/featured', requireAdmin, (req, res) => {
  setOfferFeatured(Number(req.params.id), req.body.featured === '1');
  res.redirect('/admin#offers');
});

app.post('/admin/users/:id/featured', requireAdmin, (req, res) => {
  setUserFeatured(Number(req.params.id), req.body.featured === '1');
  res.redirect('/admin');
});

app.post('/admin/pro-upgrades/:id/status', requireAdmin, (req, res) => {
  const status = req.body.status === 'approved' ? 'approved' : 'rejected';
  setProUpgradeStatus(Number(req.params.id), status);
  res.redirect('/admin#pro-requests');
});

app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.session.userId) deleteUser(id);
  res.redirect('/admin');
});

app.get('/admin/users/:id/delete-confirm', requireAdmin, (req, res) => {
  const member = getUserById(Number(req.params.id));
  if (!member) return res.redirect('/admin');
  res.render('admin/delete-user', { title: 'Delete member', member });
});

/* ---------- Pricing ---------- */

app.get('/pricing', (req, res) => {
  const tiers = [1, 2, 3, 4, 5].map((count) => ({
    count,
    price: getProPriceForOfferCount(count),
    savings: getProSavings(count),
  }));
  const paypalUrl = process.env.PRO_PAYPAL_URL || '';
  const requestSent = req.query.sent === '1';
  res.render('pricing', { title: 'PRO pricing', tiers, PRO_BASE_PRICE, PRO_ADDITIONAL_PRICE, paypalUrl, requestSent });
});

app.post('/pro/upgrade', requireAuth, rateLimit({ windowMs: 10 * 60 * 1000, max: 5 }), (req, res) => {
  const user = currentUser(req);
  const myOffers = getAllOffers().filter((o) => o.user_id === req.session.userId);
  const offerCount = myOffers.length;
  const price = getProPriceForOfferCount(offerCount);
  const months = Math.max(1, Math.min(12, Number(req.body.months) || 1));
  const note = String(req.body.note || '').trim();

  createProUpgrade({ userId: req.session.userId, offerCount, price, months, note });
  sendProUpgradeNotification({
    memberId: req.session.userId,
    memberName: user.full_name,
    email: user.email,
    offerCount,
    price: price * months,
    months,
    note,
  }).catch((err) => {
    console.error('Failed to send PRO upgrade notification:', err);
  });

  res.redirect('/pricing?sent=1');
});

/* ---------- Contact ---------- */

app.get('/contact', (req, res) => {
  res.render('contact', { title: 'Contact us', sent: !!req.query.sent });
});

app.post('/contact', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).render('contact', { title: 'Contact us', error: 'All fields are required.' });
  }
  addContactMessage(name, email, message);
  // Notify the platform owner by email (falls back to console when SMTP is unset).
  sendContactNotification({ name, email, message }).catch((err) => {
    console.error('Failed to send contact notification:', err);
  });
  res.redirect('/contact?sent=1');
});

/* ---------- About ---------- */

app.get('/about', (req, res) => {
  res.render('about', { title: 'About Africa KNXION' });
});

/* ---------- 404 ---------- */

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', error: 'Page not found', user: req.session.user });
});

/* ---------- Start ---------- */

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  app.listen(PORT, () => {
    console.log(`Africa KNXION running at http://localhost:${PORT}`);
  });
}
