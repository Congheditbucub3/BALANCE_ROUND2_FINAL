// routes/teacher.js — Teacher Wellness Insights Dashboard (anonymized, aggregate only)
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');
const { todayStr } = require('../lib/credits');

function wellnessSummary(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'teacher') return sendJson(res, 403, { error: 'Teachers only' });

  const totalStudents = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student'").get().n;
  if (totalStudents === 0) {
    return sendJson(res, 200, { totalStudents: 0, avgStepsToday: 0, pctMetStepGoalToday: 0 });
  }

  const today = todayStr();
  const rows = db.prepare('SELECT step_count FROM daily_wellness WHERE log_date = ?').all(today);

  const avgSteps = rows.length ? Math.round(rows.reduce((sum, r) => sum + r.step_count, 0) / rows.length) : 0;
  const metGoal = rows.filter((r) => r.step_count >= 10000).length;

  sendJson(res, 200, {
    totalStudents,
    studentsWithDataToday: rows.length,
    avgStepsToday: avgSteps,
    pctMetStepGoalToday: Math.round((metGoal / totalStudents) * 100),
  });
}

module.exports = { wellnessSummary };
