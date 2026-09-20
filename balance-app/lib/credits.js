// lib/credits.js — wallet rules: non-transferable, monthly wipe, daily cap
const db = require('../db');

const DAILY_CAP = 100; // hard daily earning cap per student, across all sources

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function monthStr() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getOrCreateWallet(studentId) {
  let wallet = db.prepare('SELECT * FROM wallets WHERE student_id = ?').get(studentId);
  if (!wallet) {
    db.prepare(
      `INSERT INTO wallets (student_id, balance, daily_earned_credits, last_earn_date, last_monthly_reset)
       VALUES (?, 0, 0, ?, ?)`
    ).run(studentId, todayStr(), monthStr());
    wallet = db.prepare('SELECT * FROM wallets WHERE student_id = ?').get(studentId);
  }
  return normalizeWallet(wallet);
}

// Applies daily-earn-counter reset (new day) and monthly balance wipe (new month)
// lazily, the first time the wallet is touched after the boundary passes.
function normalizeWallet(wallet) {
  const today = todayStr();
  const month = monthStr();
  let changed = false;

  if (wallet.last_earn_date !== today) {
    wallet.daily_earned_credits = 0;
    wallet.last_earn_date = today;
    changed = true;
  }
  if (wallet.last_monthly_reset !== month) {
    wallet.balance = 0;
    wallet.last_monthly_reset = month;
    changed = true;
  }
  if (changed) {
    db.prepare(
      `UPDATE wallets SET balance=?, daily_earned_credits=?, last_earn_date=?, last_monthly_reset=?
       WHERE student_id=?`
    ).run(wallet.balance, wallet.daily_earned_credits, wallet.last_earn_date, wallet.last_monthly_reset, wallet.student_id);
  }
  return wallet;
}

// Award `amount` credits, normally clamped by the remaining daily cap.
// Teacher-defined homework rewards are contractual, so callers may opt out of
// that clamp with `bypassDailyCap`; the earnings are still recorded in the
// daily total so other capped rewards cannot bypass the limit afterwards.
// Returns the number of credits actually awarded (may be less than requested,
// or 0 for normal capped rewards).
// Every credit actually granted also (a) permanently bumps lifetime_earned,
// which nothing ever resets or spends down — that's what Profile shows as
// "total gained since the beginning" — and (b) adds to the student's
// class's running monthly total, which the Shop page's pizza-party
// progress bar reads.
function awardCredits(studentId, amount, reason, { bypassDailyCap = false } = {}) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return 0;
  const wallet = getOrCreateWallet(studentId);
  const room = Math.max(0, DAILY_CAP - wallet.daily_earned_credits);
  const granted = bypassDailyCap ? amount : Math.min(amount, room);
  if (granted > 0) {
    db.prepare(
      `UPDATE wallets SET balance = balance + ?, daily_earned_credits = daily_earned_credits + ?, lifetime_earned = lifetime_earned + ? WHERE student_id = ?`
    ).run(granted, granted, granted, studentId);
    addToClassMonthlyPool(studentId, granted);
  }
  return granted;
}

function addToClassMonthlyPool(studentId, amount) {
  if (amount <= 0) return;
  const user = db.prepare('SELECT class_id FROM users WHERE user_id = ?').get(studentId);
  if (!user || !user.class_id) return; // no class assigned — nothing to credit
  const ym = monthStr();
  const existing = db
    .prepare('SELECT 1 FROM class_monthly_credits WHERE class_id = ? AND year_month = ?')
    .get(user.class_id, ym);
  if (existing) {
    db.prepare('UPDATE class_monthly_credits SET total_credits = total_credits + ? WHERE class_id = ? AND year_month = ?').run(
      amount,
      user.class_id,
      ym
    );
  } else {
    db.prepare('INSERT INTO class_monthly_credits (class_id, year_month, total_credits) VALUES (?, ?, ?)').run(
      user.class_id,
      ym,
      amount
    );
  }
}

module.exports = { getOrCreateWallet, awardCredits, DAILY_CAP, todayStr, monthStr };
