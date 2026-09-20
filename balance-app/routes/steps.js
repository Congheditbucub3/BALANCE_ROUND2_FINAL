// routes/steps.js
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');
const { isPlausible } = require('../lib/anticheat');
const { awardCredits, todayStr } = require('../lib/credits');

const GOAL = 10000;
const CREDITS_PER_GOAL = 50; // 50 credits per 10,000 steps

function getRow(studentId) {
  const today = todayStr();
  let row = db.prepare('SELECT * FROM daily_wellness WHERE student_id = ? AND log_date = ?').get(studentId, today);
  if (!row) {
    db.prepare(
      `INSERT INTO daily_wellness (student_id, log_date, step_count, steps_credited, timer_bonus_count)
       VALUES (?, ?, 0, 0, 0)`
    ).run(studentId, today);
    row = db.prepare('SELECT * FROM daily_wellness WHERE student_id = ? AND log_date = ?').get(studentId, today);
  }
  return row;
}

function submitSteps(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });

  const delta = Number(body.delta) || 0;
  const elapsedMs = Number(body.elapsedMs) || 0;

  const check = isPlausible(delta, elapsedMs);
  if (!check.ok) {
    return sendJson(res, 422, { error: 'Rejected by anti-cheat', reason: check.reason });
  }

  const row = getRow(ctx.session.userId);
  const newStepCount = row.step_count + check.delta;

  // Total credits owed for today's cumulative steps, minus what's already
  // been granted today for steps specifically (independent of other sources).
  const totalOwed = Math.floor((newStepCount / GOAL) * CREDITS_PER_GOAL);
  const owedNow = Math.max(0, totalOwed - row.steps_credited);
  const granted = owedNow > 0 ? awardCredits(ctx.session.userId, owedNow, 'steps') : 0;

  db.prepare(
    `UPDATE daily_wellness SET step_count = ?, steps_credited = steps_credited + ? WHERE student_id = ? AND log_date = ?`
  ).run(newStepCount, granted, ctx.session.userId, todayStr());

  sendJson(res, 200, { step_count: newStepCount, goal: GOAL, credits_granted: granted });
}

function todaySteps(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });
  const row = getRow(ctx.session.userId);
  sendJson(res, 200, { step_count: row.step_count, goal: GOAL });
}

module.exports = { submitSteps, todaySteps };
