// lib/demo.js — configuration for the intentionally disposable judge demo.
// All credentials stay in host environment variables; none are bundled into
// the browser or committed to the repository.
const { roleForEmail, passwordError } = require('./auth');

function isDemoMode() {
  return process.env.DEMO_MODE === 'true';
}

function resetDemoOnStart() {
  return process.env.DEMO_RESET_ON_START === 'true';
}

function required(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`Demo mode requires the ${name} environment variable`);
  return value;
}

function getDemoAccounts() {
  if (!isDemoMode()) return [];

  const accounts = [
    {
      email: required('DEMO_TEACHER_EMAIL').toLowerCase(),
      password: required('DEMO_TEACHER_PASSWORD'),
      name: (process.env.DEMO_TEACHER_NAME || 'Demo Teacher').trim(),
      role: 'teacher',
    },
    {
      email: required('DEMO_STUDENT_EMAIL').toLowerCase(),
      password: required('DEMO_STUDENT_PASSWORD'),
      name: (process.env.DEMO_STUDENT_NAME || 'Demo Student').trim(),
      role: 'student',
    },
  ];

  if (accounts[0].email === accounts[1].email) {
    throw new Error('Demo teacher and student emails must be different');
  }
  for (const account of accounts) {
    if (roleForEmail(account.email) !== account.role) {
      throw new Error(
        `Demo ${account.role} email must use the matching school domain`
      );
    }
    const error = passwordError(account.password);
    if (error) throw new Error(`Demo ${account.role} password: ${error}`);
  }

  return accounts;
}

function isAllowedDemoEmail(email) {
  if (!isDemoMode()) return true;
  const normalized = String(email || '').trim().toLowerCase();
  return getDemoAccounts().some((account) => account.email === normalized);
}

module.exports = { isDemoMode, resetDemoOnStart, getDemoAccounts, isAllowedDemoEmail };
