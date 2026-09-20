// db.js — schema + connection, built on Node's native `node:sqlite` (no npm install required)
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('./lib/auth');
const { isDemoMode, resetDemoOnStart, getDemoAccounts } = require('./lib/demo');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'balance.db');

// SQLite will NOT create a missing parent directory for you — it just
// throws "unable to open database file". The data/ folder is normally
// present via data/.gitkeep, but that's a fragile thing to depend on (lost
// in some zip/unzip round-trips, some GitHub upload flows, etc.), so this
// makes the app self-heal regardless of how it got deployed.
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('student','teacher')),
    webauthn_id   TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallets (
    student_id           INTEGER PRIMARY KEY REFERENCES users(user_id),
    balance               INTEGER NOT NULL DEFAULT 0,
    daily_earned_credits  INTEGER NOT NULL DEFAULT 0,
    last_earn_date        TEXT,
    last_monthly_reset    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_wellness (
    log_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id        INTEGER NOT NULL REFERENCES users(user_id),
    log_date          TEXT NOT NULL,
    step_count         INTEGER NOT NULL DEFAULT 0,
    steps_credited      INTEGER NOT NULL DEFAULT 0,
    timer_bonus_count   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(student_id, log_date)
  );

  -- One exercise-camera reward per mission per student per calendar day.
  -- The three-field primary key lets Squats and Push-ups each have their own
  -- daily prize while blocking refresh/retry duplicates for either mission.
  CREATE TABLE IF NOT EXISTS daily_exercise_rewards (
    student_id      INTEGER NOT NULL REFERENCES users(user_id),
    log_date        TEXT NOT NULL,
    exercise_type   TEXT NOT NULL CHECK(exercise_type IN ('squat', 'pushup')),
    reps_completed  INTEGER NOT NULL,
    credits_granted INTEGER NOT NULL,
    awarded_at      TEXT NOT NULL,
    PRIMARY KEY (student_id, log_date, exercise_type)
  );

  -- Camera-counted reps are recorded separately from rewards. A student can
  -- stop before a reward target and their dashboard can still honestly show
  -- today's movement; this table never awards credits on its own.
  CREATE TABLE IF NOT EXISTS daily_exercise_activity (
    student_id      INTEGER NOT NULL REFERENCES users(user_id),
    log_date        TEXT NOT NULL,
    exercise_type   TEXT NOT NULL CHECK(exercise_type IN ('squat', 'pushup')),
    reps_completed  INTEGER NOT NULL DEFAULT 0 CHECK(reps_completed >= 0),
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (student_id, log_date, exercise_type)
  );

  -- A single, optional movement suggestion generated after a student uses
  -- Health Coach.  Keep this deliberately small: sensitive Health Coach
  -- inputs (height, weight, age range, dietary needs and AI text) are never
  -- stored in this database.
  CREATE TABLE IF NOT EXISTS health_movement_plans (
    student_id             INTEGER PRIMARY KEY REFERENCES users(user_id),
    goal                   TEXT NOT NULL CHECK(goal IN ('cut', 'lean bulk', 'maintain', 'get fit')),
    squat_recommendation   INTEGER NOT NULL CHECK(squat_recommendation BETWEEN 5 AND 30),
    pushup_recommendation  INTEGER NOT NULL CHECK(pushup_recommendation BETWEEN 2 AND 12),
    safe_movement_note     TEXT NOT NULL,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assignments (
    assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id     INTEGER NOT NULL REFERENCES users(user_id),
    title          TEXT NOT NULL,
    due_date       TEXT NOT NULL,
    credit_value   INTEGER NOT NULL DEFAULT 10,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submissions (
    submission_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id   INTEGER NOT NULL REFERENCES assignments(assignment_id),
    student_id       INTEGER NOT NULL REFERENCES users(user_id),
    status           TEXT NOT NULL DEFAULT 'submitted',
    on_time           INTEGER NOT NULL DEFAULT 1,
    submitted_at      TEXT NOT NULL,
    credits_awarded   INTEGER NOT NULL DEFAULT 0,
    credit_awarded_at TEXT,
    UNIQUE(assignment_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS activity_pings (
    student_id  INTEGER PRIMARY KEY REFERENCES users(user_id),
    last_seen    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS classes (
    class_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS purchases (
    purchase_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    INTEGER NOT NULL REFERENCES users(user_id),
    item_id        TEXT NOT NULL,
    item_name      TEXT NOT NULL,
    item_cost      INTEGER NOT NULL,
    purchased_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS class_monthly_credits (
    class_id       INTEGER NOT NULL REFERENCES classes(class_id),
    year_month      TEXT NOT NULL,
    total_credits    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (class_id, year_month)
  );
`);

// --- Lightweight migrations -------------------------------------------
// CREATE TABLE IF NOT EXISTS won't add new columns to a table that already
// exists on disk (e.g. someone's existing data/balance.db from before this
// column existed). This adds any column that's missing without touching
// existing rows or requiring the user to delete their database.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Total valid (>=15 min) focus sessions completed, tracked separately from
// timer_bonus_count (which stops incrementing once the daily 3-bonus cap is
// hit) — this one keeps counting every real session, capped or not, so
// students can see their total study effort, not just their credited days.
ensureColumn('daily_wellness', 'sessions_completed', 'INTEGER NOT NULL DEFAULT 0');

// Which class a user belongs to (student) or manages (teacher). Nullable so
// accounts created before this feature existed don't break — the UI treats
// a null class_id as "no class assigned" rather than crashing.
ensureColumn('users', 'class_id', 'INTEGER REFERENCES classes(class_id)');

// Lifetime credits ever earned — unlike wallets.balance (spendable, and
// wiped by shop purchases) or daily_earned_credits (resets every day),
// this number only ever goes up. It's what the Profile page shows as
// "total credits gained since the beginning."
ensureColumn('wallets', 'lifetime_earned', 'INTEGER NOT NULL DEFAULT 0');

// Keep an audit trail of the exact assignment reward that was actually
// granted. Existing submissions safely start at 0 because their historical
// award amount cannot be inferred reliably after the fact.
ensureColumn('submissions', 'credits_awarded', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('submissions', 'credit_awarded_at', 'TEXT');
ensureColumn('submissions', 'submission_url', 'TEXT');
ensureColumn('submissions', 'submission_file_name', 'TEXT');
ensureColumn('submissions', 'submission_file_mime', 'TEXT');
ensureColumn('submissions', 'submission_file_data', 'BLOB');
ensureColumn('submissions', 'grade_score', 'INTEGER');
ensureColumn('submissions', 'graded_at', 'TEXT');

// Older demo builds allowed only one exercise prize across both mission types.
// Preserve their audit rows while upgrading the key so a student can earn the
// stated Squat and Push-up rewards independently.
function migrateExerciseRewardMissions() {
  const primaryKeyColumns = db
    .prepare('PRAGMA table_info(daily_exercise_rewards)')
    .all()
    .filter((column) => column.pk)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
  if (primaryKeyColumns.join(',') === 'student_id,log_date,exercise_type') return;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE daily_exercise_rewards_upgrade (
        student_id      INTEGER NOT NULL REFERENCES users(user_id),
        log_date        TEXT NOT NULL,
        exercise_type   TEXT NOT NULL CHECK(exercise_type IN ('squat', 'pushup')),
        reps_completed  INTEGER NOT NULL,
        credits_granted INTEGER NOT NULL,
        awarded_at      TEXT NOT NULL,
        PRIMARY KEY (student_id, log_date, exercise_type)
      );
      INSERT INTO daily_exercise_rewards_upgrade
        (student_id, log_date, exercise_type, reps_completed, credits_granted, awarded_at)
      SELECT student_id, log_date, exercise_type, reps_completed, credits_granted, awarded_at
      FROM daily_exercise_rewards;
      DROP TABLE daily_exercise_rewards;
      ALTER TABLE daily_exercise_rewards_upgrade RENAME TO daily_exercise_rewards;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
migrateExerciseRewardMissions();

// The Log-off Bonus was removed from the product. Existing disposable demo
// databases can still carry its old table, so remove that obsolete data on
// startup as well as removing its live routes and UI.
db.exec('DROP TABLE IF EXISTS logoff_bonus_periods');

function seedStarterClasses() {
  const classCount = db.prepare('SELECT COUNT(*) AS n FROM classes').get().n;
  if (classCount !== 0) return;
  const insertClass = db.prepare('INSERT INTO classes (name, created_at) VALUES (?, ?)');
  const now = new Date().toISOString();
  ['10A', '10B', '11A', '11B', '12A'].forEach((name) => insertClass.run(name, now));
}

// Demo mode is deliberately disposable. With DEMO_RESET_ON_START=true, every
// new server process starts with only the two configured judge accounts and
// blank activity/credit/homework data. This is safe for a free-hosted demo;
// never enable it for real students.
function clearDemoData() {
  db.exec('BEGIN IMMEDIATE');
  try {
    [
      'activity_pings',
      'class_monthly_credits',
      'purchases',
      'submissions',
      'daily_exercise_rewards',
      'daily_exercise_activity',
      'health_movement_plans',
      'assignments',
      'daily_wellness',
      'wallets',
      'users',
      'classes',
    ].forEach((table) => db.exec(`DELETE FROM ${table}`));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedDemoAccounts() {
  const accounts = getDemoAccounts();
  if (accounts.length === 0) return;

  if (resetDemoOnStart()) clearDemoData();
  seedStarterClasses();

  const demoClass = db.prepare('SELECT class_id FROM classes WHERE name = ?').get('10A');
  const now = new Date().toISOString();
  const findUser = db.prepare('SELECT user_id FROM users WHERE email = ?');
  const insertUser = db.prepare(
    'INSERT INTO users (email, name, password_hash, role, class_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const updateUser = db.prepare(
    'UPDATE users SET name = ?, password_hash = ?, role = ?, class_id = ? WHERE user_id = ?'
  );
  const createWallet = db.prepare(
    'INSERT OR IGNORE INTO wallets (student_id, balance, daily_earned_credits, last_monthly_reset, lifetime_earned) VALUES (?, 0, 0, ?, 0)'
  );

  for (const account of accounts) {
    const existing = findUser.get(account.email);
    const passwordHash = hashPassword(account.password);
    const classId = demoClass ? demoClass.class_id : null;
    const userId = existing
      ? (updateUser.run(account.name, passwordHash, account.role, classId, existing.user_id), existing.user_id)
      : insertUser.run(account.email, account.name, passwordHash, account.role, classId, now).lastInsertRowid;

    if (account.role === 'student') createWallet.run(userId, now);
  }
}

if (isDemoMode()) {
  seedDemoAccounts();
} else {
  seedStarterClasses();
}

module.exports = db;
