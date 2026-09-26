// Create an admin/staff account.
// Usage: node scripts/add-user.js <username> <password>
import { getUserById } from '../db.js';
import { registerUserWithAccount } from '../db.js';

const [, , username = 'admin', password = 'password123', fullName = 'Admin KNXION'] = process.argv;

if (!username || !password) {
  console.log('Usage: npm run add-user -- <username> <password> [full name]');
  process.exit(1);
}

try {
  const user = registerUserWithAccount({
    fullName,
    username,
    password,
    role: 'admin',
  });
  const created = getUserById(user.id);
  console.log(`Created admin user: ${created.full_name} (${username})`);
} catch (err) {
  console.error('Could not create user:', err.message);
  process.exit(1);
}
