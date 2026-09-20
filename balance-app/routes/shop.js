// routes/shop.js
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');
const { CATALOG, CLASS_MONTHLY_GOAL, findItem } = require('../lib/shop');
const { getOrCreateWallet, monthStr } = require('../lib/credits');

function getCatalog(body, req, res, ctx) {
  if (!ctx.session) return sendJson(res, 401, { error: 'Not logged in' });
  sendJson(res, 200, { catalog: CATALOG });
}

function getClassProgress(body, req, res, ctx) {
  if (!ctx.session) return sendJson(res, 401, { error: 'Not logged in' });

  const user = db.prepare('SELECT class_id FROM users WHERE user_id = ?').get(ctx.session.userId);
  if (!user || !user.class_id) {
    return sendJson(res, 200, { hasClass: false, goal: CLASS_MONTHLY_GOAL });
  }

  const cls = db.prepare('SELECT name FROM classes WHERE class_id = ?').get(user.class_id);
  const ym = monthStr();
  const row = db
    .prepare('SELECT total_credits FROM class_monthly_credits WHERE class_id = ? AND year_month = ?')
    .get(user.class_id, ym);
  const total = row ? row.total_credits : 0;

  sendJson(res, 200, {
    hasClass: true,
    className: cls ? cls.name : null,
    month: ym,
    totalCredits: total,
    goal: CLASS_MONTHLY_GOAL,
    percent: Math.min(100, Math.round((total / CLASS_MONTHLY_GOAL) * 100)),
    goalReached: total >= CLASS_MONTHLY_GOAL,
  });
}

function buyItem(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });

  const item = findItem(body.itemId);
  if (!item) return sendJson(res, 400, { error: 'Unknown item' });

  const wallet = getOrCreateWallet(ctx.session.userId);
  if (wallet.balance < item.cost) {
    return sendJson(res, 400, { error: `Not enough credits — ${item.name} costs ${item.cost}, you have ${wallet.balance}` });
  }

  // Spending only ever touches the spendable balance, never lifetime_earned
  // — lifetime_earned is a permanent record of credits gained, unaffected
  // by what you later choose to spend them on.
  db.prepare('UPDATE wallets SET balance = balance - ? WHERE student_id = ?').run(item.cost, ctx.session.userId);
  db.prepare(
    `INSERT INTO purchases (student_id, item_id, item_name, item_cost, purchased_at) VALUES (?, ?, ?, ?, ?)`
  ).run(ctx.session.userId, item.id, item.name, item.cost, new Date().toISOString());

  const updated = getOrCreateWallet(ctx.session.userId);
  sendJson(res, 200, { ok: true, item, newBalance: updated.balance });
}

module.exports = { getCatalog, getClassProgress, buyItem };
