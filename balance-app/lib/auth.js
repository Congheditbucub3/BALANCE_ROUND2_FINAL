// lib/auth.js
const crypto = require('node:crypto');

// --- Domain -> role assignment -------------------------------------------
// Order matters only conceptually; because "...edu.com" never ends with the
// bare "nguyensieuschool.com" suffix, checking student first is sufficient
// and unambiguous either way.
const STUDENT_DOMAIN = '@nguyensieuschool.edu.com';
const TEACHER_DOMAIN = '@nguyensieuschool.com';

function roleForEmail(email) {
  const e = email.trim().toLowerCase();
  if (e.endsWith(STUDENT_DOMAIN)) return 'student';
  if (e.endsWith(TEACHER_DOMAIN)) return 'teacher';
  return null; // reject registration — not a school domain
}

// Password policy is enforced on the server. Browser validation is only a
// convenience; it can be bypassed, so this is the authoritative check.
function passwordError(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least 1 uppercase letter.';
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    return 'Password must include at least 1 special character.';
  }
  return null;
}

// --- Password hashing (scrypt, built into Node — no bcrypt dependency) ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  // timing-safe compare
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Sessions --------------------------------------------------------------
// In-memory token -> {userId, role, email}. Fine for a prototype / single
// process. Swap for a DB-backed or Redis session store before deploying for
// real, or for running with more than one server process.
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId: user.user_id, role: user.role, email: user.email, name: user.name });
  return token;
}

function getSession(token) {
  return sessions.get(token) || null;
}

function destroySession(token) {
  sessions.delete(token);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

module.exports = {
  roleForEmail,
  passwordError,
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  parseCookies,
};
