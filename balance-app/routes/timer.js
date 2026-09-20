// routes/timer.js
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');
const { awardCredits, todayStr } = require('../lib/credits');

const MIN_FOCUS_MINUTES = 15; // session must be at least this long to count
const BONUS_PER_SESSION = 5;
const MAX_BONUSES_PER_DAY = 3;

function completeSession(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });

  const focusMinutes = Number(body.focusMinutes) || 0;
  if (focusMinutes < MIN_FOCUS_MINUTES) {
    return sendJson(res, 200, { credits_granted: 0, reason: `Sessions must be at least ${MIN_FOCUS_MINUTES} minutes` });
  }

  const today = todayStr();
  let row = db.prepare('SELECT * FROM daily_wellness WHERE student_id = ? AND log_date = ?').get(ctx.session.userId, today);
  if (!row) {
    db.prepare(
      `INSERT INTO daily_wellness (student_id, log_date, step_count, steps_credited, timer_bonus_count, sessions_completed)
       VALUES (?, ?, 0, 0, 0, 0)`
    ).run(ctx.session.userId, today);
    row = db.prepare('SELECT * FROM daily_wellness WHERE student_id = ? AND log_date = ?').get(ctx.session.userId, today);
  }

  // sessions_completed tracks every valid session, capped or not, so a
  // student's all-time progress reflects actual study effort rather than
  // just the days they happened to earn a bonus.
  db.prepare('UPDATE daily_wellness SET sessions_completed = sessions_completed + 1 WHERE student_id = ? AND log_date = ?').run(
    ctx.session.userId,
    today
  );

  if (row.timer_bonus_count >= MAX_BONUSES_PER_DAY) {
    return sendJson(res, 200, { credits_granted: 0, reason: 'Daily focus bonus limit reached', session_recorded: true });
  }

  const granted = awardCredits(ctx.session.userId, BONUS_PER_SESSION, 'focus_timer');
  db.prepare('UPDATE daily_wellness SET timer_bonus_count = timer_bonus_count + 1 WHERE student_id = ? AND log_date = ?').run(
    ctx.session.userId,
    today
  );

  sendJson(res, 200, {
    credits_granted: granted,
    bonuses_used_today: row.timer_bonus_count + 1,
    bonuses_allowed: MAX_BONUSES_PER_DAY,
    session_recorded: true,
  });
}

module.exports = { completeSession };
