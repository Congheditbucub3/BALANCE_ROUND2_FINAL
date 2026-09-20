// routes/profile.js
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');
const { getOrCreateWallet } = require('../lib/credits');

function getProfile(body, req, res, ctx) {
  if (!ctx.session) return sendJson(res, 401, { error: 'Not logged in' });

  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(ctx.session.userId);
  const cls = user.class_id ? db.prepare('SELECT name FROM classes WHERE class_id = ?').get(user.class_id) : null;

  const base = {
    name: user.name,
    email: user.email,
    role: user.role,
    className: cls ? cls.name : null,
    memberSince: user.created_at,
  };

  if (user.role === 'student') {
    const wallet = getOrCreateWallet(user.user_id);
    const recentPurchases = db
      .prepare('SELECT item_name, item_cost, purchased_at FROM purchases WHERE student_id = ? ORDER BY purchased_at DESC LIMIT 10')
      .all(user.user_id);

    return sendJson(res, 200, {
      ...base,
      lifetimeEarned: wallet.lifetime_earned,
      currentBalance: wallet.balance,
      recentPurchases,
    });
  }

  // Teacher: show the class they manage and how many students are in it.
  const studentCount = user.class_id
    ? db.prepare("SELECT COUNT(*) AS n FROM users WHERE class_id = ? AND role = 'student'").get(user.class_id).n
    : 0;

  sendJson(res, 200, { ...base, studentCount });
}

module.exports = { getProfile };
