// Basic tests for Africa KNXION DB functions.
// Usage: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import db, {
  registerUserWithAccount,
  authenticateUser,
  getUserById,
  createOffer,
  getAllOffers,
  createRequest,
  getAllRequests,
  createReview,
  getReviewsForProfessional,
  getAverageRating,
  setOfferFeatured,
  setUserFeatured,
  searchOffers,
  searchUsers,
} from '../db.js';

test('register user and authenticate', () => {
  const username = `tuser_${Date.now()}`;
  const user = registerUserWithAccount({
    fullName: 'Test User',
    email: `test_${Date.now()}@example.com`,
    phone: '+111',
    profession: 'Carpenter',
    city: 'Test City',
    state: 'CA',
    zip: '90210',
    username,
    password: 'secret123',
  });

  const fetched = getUserById(user.id);
  assert.ok(fetched);
  assert.equal(fetched.full_name, 'Test User');
  assert.equal(fetched.profession, 'Carpenter');
  assert.equal(fetched.city, 'Test City');
  assert.equal(fetched.state, 'CA');

  const authed = authenticateUser(username, 'secret123');
  assert.ok(authed);
  assert.equal(authed.id, user.id);

  const bad = authenticateUser(username, 'wrong');
  assert.equal(bad, null);
});

test('create and list offers', () => {
  const user = registerUserWithAccount({
    fullName: 'Offer Maker',
    username: `offer_${Date.now()}`,
    password: 'secret123',
  });

  createOffer({ userId: user.id, title: 'Painting service', description: 'Quality painting', category: 'Renovation', city: 'Sacramento', state: 'CA', zip: '95814', price: 'From 1000' });
  const offers = getAllOffers();
  assert.ok(offers.some((o) => o.title === 'Painting service'));
});

test('create and list requests', () => {
  const user = registerUserWithAccount({
    fullName: 'Request Maker',
    username: `req_${Date.now()}`,
    password: 'secret123',
  });

  createRequest({ userId: user.id, title: 'Need a painter', description: 'For my house', category: 'Renovation' });
  const requests = getAllRequests();
  assert.ok(requests.some((r) => r.title === 'Need a painter'));
});

test('create reviews and compute rating', () => {
  const reviewer = registerUserWithAccount({ fullName: 'Reviewer', username: `rev_${Date.now()}`, password: 'secret123' });
  const pro = registerUserWithAccount({ fullName: 'Pro', profession: 'Painter', username: `pro_${Date.now()}`, password: 'secret123' });

  createReview({ reviewerId: reviewer.id, professionalId: pro.id, rating: 5, comment: 'Great' });
  createReview({ reviewerId: reviewer.id, professionalId: pro.id, rating: 3, comment: 'Ok' });

  const reviews = getReviewsForProfessional(pro.id);
  assert.equal(reviews.length, 2);

  const rating = getAverageRating(pro.id);
  assert.equal(rating.avg, 4);
  assert.equal(rating.count, 2);
});

test('promoted ordering: offer boost beats PRO, and both beat regular', () => {
  const pro = registerUserWithAccount({ fullName: 'Feature A', username: `featA_${Date.now()}`, password: 'secret123' });
  const regular = registerUserWithAccount({ fullName: 'Feature B', username: `featB_${Date.now()}`, password: 'secret123' });
  const booster = registerUserWithAccount({ fullName: 'Offer Booster', username: `booster_${Date.now()}`, password: 'secret123' });

  // 0 = offer promoted via PRO membership (promo_kind 2)
  setUserFeatured(pro.id, true);
  const proOffer = createOffer({ userId: pro.id, title: 'PRO offer', description: 'from a PRO member' }).lastInsertRowid;

  // offer with an active boost (promo_kind 1)
  const boostOffer = createOffer({ userId: booster.id, title: 'Boosted offer', description: 'boosted to top' }).lastInsertRowid;
  setOfferFeatured(boostOffer, true);

  // regular offer (no promotion at all)
  createOffer({ userId: regular.id, title: 'Regular offer', description: 'not promoted' });

  const offers = getAllOffers();
  assert.equal(offers[0].id, Number(boostOffer));
  assert.equal(offers[0].promo_kind, 1);
  assert.equal(offers[0].featured, 1);

  assert.equal(offers[1].id, Number(proOffer));
  assert.equal(offers[1].promo_kind, 2);

  // removing the boost keeps the order driven by PRO only
  setOfferFeatured(boostOffer, false);
  const after = getAllOffers();
  assert.equal(after[0].id, Number(proOffer));
  assert.equal(after[0].promo_kind, 2);

  // regular users sort after promoted ones
  assert.ok(after.findIndex((o) => o.title === 'Regular offer') > after.findIndex((o) => o.title === 'PRO offer'));

  // search also promotes
  const hit = searchOffers('offer');
  assert.ok(hit);
  assert.equal(hit[0].promo_kind, 2);

  // user featured toggle drives searchUsers ordering
  setUserFeatured(pro.id, true);
  assert.equal(searchUsers('Feature')[0].id, pro.id);
  setUserFeatured(pro.id, false);
  assert.equal(searchUsers('Feature B')[0].id, regular.id);
});
