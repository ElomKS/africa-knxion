// Populate the database with sample data.
// Usage: npm run seed
import { seedDatabase } from '../db.js';

const seeded = seedDatabase();
if (seeded) {
  console.log('Database seeded with sample members, offers, requests and reviews.');
  console.log('Demo admin:');
  console.log('  username: admin');
  console.log('  password: password123');
  console.log('Demo members (user1..user5):');
  console.log('  username: user1 .. user5');
  console.log('  password: password123');
} else {
  console.log('Database already has data. Nothing seeded.');
}
