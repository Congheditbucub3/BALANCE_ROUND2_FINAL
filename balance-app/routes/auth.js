// routes/auth.js
const db = require('../db');
const { roleForEmail, passwordError, hashPassword, verifyPassword, createSession, destroySession } = require('../lib/auth');
const { sendJson, setCookie, clearCookie } = require('../lib/http-helpers');
const { getOrCreateWallet, todayStr } = require('../lib/credits');
const { isDemoMode, isAllowedDemoEmail } = require('../lib/demo');

function register(body, req, res) {
  if (isDemoMode()) {
    return sendJson(res, 403, { error: 'Registration is disabled for this two-account demo.' });
  }
  const { name, email, password, class_id } = body;
  if (!name || !email || !password) {
    return sendJson(res, 400, { error: 'name, email and password are required' });
  }
  const passwordValidationError = passwordError(password);
  if (passwordValidationError) return sendJson(res, 400, { error: passwordValidationError });
  const role = roleForEmail(email);
  if (!role) {
    return sendJson(res, 400, {
      error: 'Email must be a school address (student: @nguyensieuschool.edu.com, teacher: @nguyensieuschool.com)',
    });
  }
  const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return sendJson(res, 409, { error: 'An account with that email already exists' });

  let classId = null;
  if (class_id !== undefined && class_id !== null && class_id !== '') {
    const cls = db.prepare('SELECT class_id FROM classes WHERE class_id = ?').get(Number(class_id));
    if (!cls) return sendJson(res, 400, { error: 'Selected class does not exist' });
    classId = cls.class_id;
  }

  const info = db
    .prepare(`INSERT INTO users (email, name, password_hash, role, class_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(email.toLowerCase(), name, hashPassword(password), role, classId, new Date().toISOString());

  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(info.lastInsertRowid);
  if (role === 'student') getOrCreateWallet(user.user_id);

  const token = createSession(user);
  setCookie(res, 'sid', token, { maxAge: 60 * 60 * 24 * 7 });
  sendJson(res, 201, { user: publicUser(user) });
}

function login(body, req, res) {
  const { email, password } = body;
  if (!email || !password) return sendJson(res, 400, { error: 'email and password are required' });
  if (isDemoMode() && !isAllowedDemoEmail(email)) {
    return sendJson(res, 401, { error: 'This demo is limited to the presenter accounts.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return sendJson(res, 401, { error: 'Invalid email or password' });
  }

  const token = createSession(user);
  setCookie(res, 'sid', token, { maxAge: 60 * 60 * 24 * 7 });
  sendJson(res, 200, { user: publicUser(user) });
}

function logout(body, req, res, ctx) {
  if (ctx.cookies.sid) destroySession(ctx.cookies.sid);
  clearCookie(res, 'sid');
  sendJson(res, 200, { ok: true });
}

function me(body, req, res, ctx) {
  if (!ctx.session) return sendJson(res, 401, { error: 'Not logged in' });
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(ctx.session.userId);
  const out = publicUser(user);
  if (user.role === 'student') {
    const wallet = getOrCreateWallet(user.user_id);
    out.wallet = { balance: wallet.balance, daily_earned_credits: wallet.daily_earned_credits, lifetime_earned: wallet.lifetime_earned };
    const today = db
      .prepare('SELECT step_count FROM daily_wellness WHERE student_id = ? AND log_date = ?')
      .get(user.user_id, todayStr());
    out.stepsToday = today ? today.step_count : 0;
  }
  sendJson(res, 200, { user: out });
}

function publicUser(user) {
  const cls = user.class_id ? db.prepare('SELECT name FROM classes WHERE class_id = ?').get(user.class_id) : null;
  return {
    user_id: user.user_id,
    email: user.email,
    name: user.name,
    role: user.role,
    class_id: user.class_id || null,
    class_name: cls ? cls.name : null,
  };
}

module.exports = { register, login, logout, me };
