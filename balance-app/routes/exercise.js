// routes/exercise.js — one server-authoritative daily reward for camera-tracked exercise.
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');
const { awardCredits, todayStr, getOrCreateWallet, DAILY_CAP } = require('../lib/credits');

const REWARD_CREDITS = 5;
const EXERCISE_TARGETS = Object.freeze({
  squat: 40,
  pushup: 20,
});

function previousDate(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function completedBothMissionStreak(studentId, today) {
  const completedDays = db
    .prepare(
      `SELECT log_date
       FROM daily_exercise_rewards
       WHERE student_id = ?
       GROUP BY log_date
       HAVING COUNT(DISTINCT exercise_type) = ?`
    )
    .all(studentId, Object.keys(EXERCISE_TARGETS).length)
    .map((row) => row.log_date);
  const completeSet = new Set(completedDays);
  let date = today;
  let streak = 0;
  while (completeSet.has(date)) {
    streak += 1;
    date = previousDate(date);
  }
  return streak;
}

function withImmediateTransaction(work) {
  let open = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    open = true;
    const result = work();
    db.exec('COMMIT');
    open = false;
    return result;
  } catch (error) {
    if (open) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {
        // Preserve the original error if the transaction has already closed.
      }
    }
    throw error;
  }
}

function validateClaim(body = {}) {
  const exerciseType = body.exercise_type;
  const target = EXERCISE_TARGETS[exerciseType];
  if (!target) return { error: 'exercise_type must be squat or pushup' };

  const reps = Number(body.reps);
  if (!Number.isSafeInteger(reps) || reps < 0 || reps > 1000) {
    return { error: 'reps must be a whole number from 0 to 1000' };
  }
  if (reps < target) {
    return { error: `${exerciseType === 'pushup' ? 'Push-ups' : 'Squats'} need ${target} completed repetitions before claiming a reward` };
  }
  return { exerciseType, reps, target };
}

function validateActivityRep(body = {}) {
  const exerciseType = body.exercise_type;
  if (!EXERCISE_TARGETS[exerciseType]) return { error: 'exercise_type must be squat or pushup' };
  // The camera sends exactly one locally counted repetition. This endpoint is
  // deliberately separate from the credit-claim endpoint, so activity data
  // can never grant rewards by itself.
  if (Number(body.reps_delta) !== 1) return { error: 'reps_delta must be 1' };
  return { exerciseType };
}

function recordExerciseActivity(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') {
    return sendJson(res, 403, { error: 'Students only' });
  }

  const activity = validateActivityRep(body);
  if (activity.error) return sendJson(res, 400, { error: activity.error });

  const logDate = todayStr();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO daily_exercise_activity
       (student_id, log_date, exercise_type, reps_completed, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(student_id, log_date, exercise_type) DO UPDATE SET
       reps_completed = daily_exercise_activity.reps_completed + 1,
       updated_at = excluded.updated_at`
  ).run(ctx.session.userId, logDate, activity.exerciseType, now);

  const row = db.prepare(
    `SELECT reps_completed FROM daily_exercise_activity
     WHERE student_id = ? AND log_date = ? AND exercise_type = ?`
  ).get(ctx.session.userId, logDate, activity.exerciseType);
  sendJson(res, 200, {
    exercise_type: activity.exerciseType,
    reps_completed: row ? row.reps_completed : 0,
  });
}

function claimDailyExerciseReward(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') {
    return sendJson(res, 403, { error: 'Students only' });
  }

  const claim = validateClaim(body);
  if (claim.error) return sendJson(res, 400, { error: claim.error });

  const outcome = withImmediateTransaction(() => {
    const logDate = todayStr();
    const existing = db
      .prepare('SELECT exercise_type, reps_completed, credits_granted FROM daily_exercise_rewards WHERE student_id = ? AND log_date = ? AND exercise_type = ?')
      .get(ctx.session.userId, logDate, claim.exerciseType);

    // The primary key and IMMEDIATE transaction make this safe even if two
    // tabs reach the goal at the same time or a request is retried after a
    // refresh. A student can earn each listed exercise mission once per day.
    if (existing) {
      return {
        already_rewarded: true,
        credits_granted: 0,
        reward_credits: existing.credits_granted,
        exercise_type: existing.exercise_type,
        reps_completed: existing.reps_completed,
        reason: `Today's ${existing.credits_granted}-credit ${existing.exercise_type === 'pushup' ? 'push-up' : 'squat'} mission was already completed.`,
      };
    }

    // Exercise prizes respect the 100-credit daily wallet limit. Do not issue
    // a partial 5-credit mission reward or mark it complete when there is not
    // enough room for the whole prize.
    const wallet = getOrCreateWallet(ctx.session.userId);
    const creditsRemaining = Math.max(0, DAILY_CAP - wallet.daily_earned_credits);
    if (creditsRemaining < REWARD_CREDITS) {
      return {
        daily_cap_reached: true,
        credits_granted: 0,
        credits_remaining: creditsRemaining,
        reason: creditsRemaining === 0
          ? 'Your 100-credit daily limit has been reached. Exercise missions reset tomorrow.'
          : `You need room for all ${REWARD_CREDITS} mission credits. Earned credits reset tomorrow.`,
      };
    }
    const granted = awardCredits(ctx.session.userId, REWARD_CREDITS, 'exercise_camera');
    if (granted !== REWARD_CREDITS) throw new Error('Could not grant the full exercise reward');

    db.prepare(
      `INSERT INTO daily_exercise_rewards
        (student_id, log_date, exercise_type, reps_completed, credits_granted, awarded_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(ctx.session.userId, logDate, claim.exerciseType, claim.reps, granted, new Date().toISOString());

    return {
      already_rewarded: false,
      credits_granted: granted,
      reward_credits: granted,
      exercise_type: claim.exerciseType,
      reps_completed: claim.reps,
      target: claim.target,
    };
  });

  sendJson(res, 200, outcome);
}

function getDailyExerciseMissions(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') {
    return sendJson(res, 403, { error: 'Students only' });
  }
  const logDate = todayStr();
  const completed = db
    .prepare('SELECT exercise_type, reps_completed, credits_granted FROM daily_exercise_rewards WHERE student_id = ? AND log_date = ?')
    .all(ctx.session.userId, logDate);
  const wallet = getOrCreateWallet(ctx.session.userId);
  const creditsRemaining = Math.max(0, DAILY_CAP - wallet.daily_earned_credits);
  sendJson(res, 200, {
    log_date: logDate,
    daily_credit_limit: DAILY_CAP,
    daily_credits_earned: wallet.daily_earned_credits,
    credits_remaining: creditsRemaining,
    both_missions_streak: completedBothMissionStreak(ctx.session.userId, logDate),
    missions: Object.entries(EXERCISE_TARGETS).map(([exercise_type, target]) => {
      const reward = completed.find((entry) => entry.exercise_type === exercise_type);
      return {
        exercise_type,
        target,
        reward_credits: REWARD_CREDITS,
        completed: Boolean(reward),
        reps_completed: reward ? reward.reps_completed : 0,
      };
    }),
  });
}

module.exports = {
  claimDailyExerciseReward,
  getDailyExerciseMissions,
  recordExerciseActivity,
  EXERCISE_TARGETS,
  REWARD_CREDITS,
};
