// routes/stats.js — all-time progress stats for a student, shown on the dashboard.
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');
const { todayStr } = require('../lib/credits');

// These are intentionally broad, non-personal activity estimates. Balance
// does not store weight or medical data, so the dashboard must never present
// this as an exact calorie measurement.
const CALORIES_PER_STEP = 0.04;
const CALORIES_PER_SQUAT = 0.32;
const CALORIES_PER_PUSHUP = 0.4;
const DAILY_ACTIVITY_REFERENCE_CALORIES = Math.round(
  (10_000 * CALORIES_PER_STEP) + (40 * CALORIES_PER_SQUAT) + (20 * CALORIES_PER_PUSHUP)
);

function isoDateDaysAgo(daysAgo) {
  const date = new Date(`${todayStr()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function studentProgress(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });
  const studentId = ctx.session.userId;

  const homework = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(on_time) AS onTime
       FROM submissions WHERE student_id = ?`
    )
    .get(studentId);

  const sessions = db
    .prepare(`SELECT COALESCE(SUM(sessions_completed), 0) AS total FROM daily_wellness WHERE student_id = ?`)
    .get(studentId);

  const steps = db
    .prepare(`SELECT COALESCE(SUM(step_count), 0) AS total, COUNT(*) AS daysLogged FROM daily_wellness WHERE student_id = ?`)
    .get(studentId);

  const today = todayStr();
  const todaySteps = db
    .prepare(
      `SELECT COALESCE(step_count, 0) AS total
       FROM daily_wellness WHERE student_id = ? AND log_date = ?`
    )
    .get(studentId, today);
  const todayExercise = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN exercise_type = 'squat' THEN reps_completed ELSE 0 END), 0) AS squats,
         COALESCE(SUM(CASE WHEN exercise_type = 'pushup' THEN reps_completed ELSE 0 END), 0) AS pushups
       FROM daily_exercise_activity
       WHERE student_id = ? AND log_date = ?`
    )
    .get(studentId, today);
  const activitySteps = todaySteps ? todaySteps.total : 0;
  const activitySquats = todayExercise ? todayExercise.squats : 0;
  const activityPushups = todayExercise ? todayExercise.pushups : 0;
  const estimatedCalories = Math.round(
    (activitySteps * CALORIES_PER_STEP)
    + (activitySquats * CALORIES_PER_SQUAT)
    + (activityPushups * CALORIES_PER_PUSHUP)
  );

  const historyStart = isoDateDaysAgo(6);
  const historyRows = db
    .prepare(
      `SELECT log_date, step_count
       FROM daily_wellness
       WHERE student_id = ? AND log_date >= ?
       ORDER BY log_date ASC`
    )
    .all(studentId, historyStart);
  const historyByDate = new Map(historyRows.map((row) => [row.log_date, row.step_count]));
  const stepHistory = Array.from({ length: 7 }, (_, index) => {
    const date = isoDateDaysAgo(6 - index);
    return { date, steps: historyByDate.get(date) || 0 };
  });
  const stepsYesterday = stepHistory[5].steps;

  sendJson(res, 200, {
    homeworkCompleted: homework.total || 0,
    homeworkOnTime: homework.onTime || 0,
    focusSessionsCompleted: sessions.total || 0,
    stepsAllTime: steps.total || 0,
    daysLogged: steps.daysLogged || 0,
    stepHistory,
    stepsYesterday,
    activityToday: {
      steps: activitySteps,
      squats: activitySquats,
      pushups: activityPushups,
      estimatedCalories,
      referenceCalories: DAILY_ACTIVITY_REFERENCE_CALORIES,
    },
  });
}

module.exports = { studentProgress };
