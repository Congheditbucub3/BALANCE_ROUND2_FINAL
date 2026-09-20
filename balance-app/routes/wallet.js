// routes/wallet.js
const { sendJson } = require('../lib/http-helpers');
const { getOrCreateWallet, DAILY_CAP } = require('../lib/credits');

function getWallet(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });
  const wallet = getOrCreateWallet(ctx.session.userId);
  sendJson(res, 200, {
    balance: wallet.balance,
    daily_earned_credits: wallet.daily_earned_credits,
    daily_cap: DAILY_CAP,
  });
}

module.exports = { getWallet };
