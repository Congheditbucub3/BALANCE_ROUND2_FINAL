// server.js — entry point. Zero npm dependencies: pure Node `http` + `node:sqlite`.
const http = require('node:http');
const path = require('node:path');
const { readJsonBody, readMultipartBody, sendJson, serveStatic } = require('./lib/http-helpers');
const { getSession, parseCookies } = require('./lib/auth');

const authRoutes = require('./routes/auth');
const stepRoutes = require('./routes/steps');
const exerciseRoutes = require('./routes/exercise');
const timerRoutes = require('./routes/timer');
const walletRoutes = require('./routes/wallet');
const assignmentRoutes = require('./routes/assignments');
const teacherRoutes = require('./routes/teacher');
const statsRoutes = require('./routes/stats');
const classRoutes = require('./routes/classes');
const profileRoutes = require('./routes/profile');
const shopRoutes = require('./routes/shop');
const aiRoutes = require('./routes/ai');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// Route table: [method, path-pattern, handler]. Patterns support a single
// `:id` segment; everything else must match exactly.
const routes = [
  ['POST', '/api/register', authRoutes.register],
  ['POST', '/api/login', authRoutes.login],
  ['POST', '/api/logout', authRoutes.logout],
  ['GET', '/api/me', authRoutes.me],

  ['POST', '/api/steps', stepRoutes.submitSteps],
  ['GET', '/api/steps/today', stepRoutes.todaySteps],
  ['GET', '/api/exercise/missions', exerciseRoutes.getDailyExerciseMissions],
  ['POST', '/api/exercise/reward', exerciseRoutes.claimDailyExerciseReward],
  ['POST', '/api/exercise/activity', exerciseRoutes.recordExerciseActivity],

  ['POST', '/api/timer/complete', timerRoutes.completeSession],

  ['POST', '/api/ai/homework', aiRoutes.homeworkCoach],
  ['POST', '/api/ai/health', aiRoutes.healthCoach],
  ['GET', '/api/health/movement-plan', aiRoutes.getHealthMovementPlan],

  ['GET', '/api/wallet', walletRoutes.getWallet],

  ['POST', '/api/assignments', assignmentRoutes.createAssignment],
  ['GET', '/api/assignments', assignmentRoutes.listAssignments],
  ['POST', '/api/assignments/:id/submit', assignmentRoutes.submitAssignment],
  ['GET', '/api/assignments/:id/submissions', assignmentRoutes.listSubmissions],
  ['POST', '/api/submissions/:id/grade', assignmentRoutes.gradeSubmission],
  ['GET', '/api/submissions/:id/file', assignmentRoutes.getSubmissionFile],
  ['POST', '/api/submissions/:id/status', assignmentRoutes.updateSubmissionStatus],

  ['GET', '/api/teacher/wellness-summary', teacherRoutes.wellnessSummary],

  ['GET', '/api/stats/progress', statsRoutes.studentProgress],

  ['GET', '/api/classes', classRoutes.listClasses],

  ['GET', '/api/profile', profileRoutes.getProfile],

  ['GET', '/api/shop/catalog', shopRoutes.getCatalog],
  ['GET', '/api/shop/progress', shopRoutes.getClassProgress],
  ['POST', '/api/shop/buy', shopRoutes.buyItem],
];

function matchRoute(method, urlPath) {
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const patternParts = pattern.split('/').filter(Boolean);
    const urlParts = urlPath.split('/').filter(Boolean);
    if (patternParts.length !== urlParts.length) continue;

    const params = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = urlParts[i];
      } else if (patternParts[i] !== urlParts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler, params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  if (!urlPath.startsWith('/api/')) {
    return serveStatic(req, res, PUBLIC_DIR);
  }

  const match = matchRoute(req.method, urlPath);
  if (!match) return sendJson(res, 404, { error: 'Not found' });

  const cookies = parseCookies(req.headers.cookie);
  const session = cookies.sid ? getSession(cookies.sid) : null;
  const ctx = { cookies, session };

  try {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const isHomeworkUpload = req.method === 'POST'
      && urlPath === '/api/ai/homework'
      && contentType.startsWith('multipart/form-data');
    const isAssignmentSubmissionUpload = req.method === 'POST'
      && /^\/api\/assignments\/\d+\/submit$/.test(urlPath)
      && contentType.startsWith('multipart/form-data');
    // Reject unknown callers before buffering a multi-megabyte upload. The
    // coach route checks this again; this early guard only protects the free
    // demo server's memory from unauthenticated upload traffic.
    if (isHomeworkUpload && !session) {
      return sendJson(res, 401, { error: 'Please log in first.' });
    }
    if (isHomeworkUpload && session.role !== 'student') {
      return sendJson(res, 403, { error: 'These coaches are available to student accounts.' });
    }
    if (isAssignmentSubmissionUpload && !session) {
      return sendJson(res, 401, { error: 'Please log in first.' });
    }
    if (isAssignmentSubmissionUpload && session.role !== 'student') {
      return sendJson(res, 403, { error: 'Students only' });
    }
    let body = {};
    if (req.method === 'POST') {
      if (isHomeworkUpload || isAssignmentSubmissionUpload) {
        const form = await readMultipartBody(req);
        body = { ...form.fields, files: form.files };
      } else {
        body = await readJsonBody(req);
      }
    }
    await match.handler(body, req, res, ctx, match.params);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message || 'Bad request' });
  }
});

server.listen(PORT, () => {
  console.log(`Balance app running at http://localhost:${PORT}`);
});
