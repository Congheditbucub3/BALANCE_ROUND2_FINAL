// routes/assignments.js
const db = require('../db');
const path = require('node:path');
const { sendJson } = require('../lib/http-helpers');
const { awardCredits } = require('../lib/credits');

const DEFAULT_CREDIT_VALUE = 10;
const MAX_CREDIT_VALUE = 1000;
const MAX_SUBMISSION_FILE_BYTES = 5 * 1024 * 1024;
const SUBMISSION_FILE_TYPES = {
  '.pdf': { mimeType: 'application/pdf', acceptedMimes: ['application/pdf', 'application/x-pdf'] },
  '.png': { mimeType: 'image/png', acceptedMimes: ['image/png'] },
  '.jpg': { mimeType: 'image/jpeg', acceptedMimes: ['image/jpeg', 'image/pjpeg'] },
  '.jpeg': { mimeType: 'image/jpeg', acceptedMimes: ['image/jpeg', 'image/pjpeg'] },
  '.webp': { mimeType: 'image/webp', acceptedMimes: ['image/webp'] },
  '.gif': { mimeType: 'image/gif', acceptedMimes: ['image/gif'] },
  '.doc': { mimeType: 'application/msword', acceptedMimes: ['application/msword', 'application/vnd.ms-word'] },
  '.docx': { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', acceptedMimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  '.rtf': { mimeType: 'application/rtf', acceptedMimes: ['application/rtf', 'text/rtf', 'application/x-rtf'] },
  '.odt': { mimeType: 'application/vnd.oasis.opendocument.text', acceptedMimes: ['application/vnd.oasis.opendocument.text'] },
  '.txt': { mimeType: 'text/plain', acceptedMimes: ['text/plain'] },
};
const GENERIC_UPLOAD_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const SUBMISSION_COLUMNS = `
  submission_id, assignment_id, student_id, status, on_time, submitted_at,
  credits_awarded, credit_awarded_at, submission_url, submission_file_name,
  submission_file_mime, grade_score, graded_at
`;

function parseCreditValue(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_CREDIT_VALUE;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_CREDIT_VALUE) return null;
  return parsed;
}

function submissionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeSubmissionFilename(value) {
  const filename = String(value || '')
    .replace(/^.*[\\/]/, '')
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .trim();
  if (!filename || filename.length > 120) throw submissionError('Choose a file with a valid name.');
  return filename;
}

function hasExpectedFileSignature(extension, buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (extension === '.pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extension === '.png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === '.gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (extension === '.webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return true;
}

function validateSubmissionWork(body = {}) {
  const rawLink = String(body.work_link || '').trim();
  let workLink = null;
  if (rawLink) {
    if (rawLink.length > 2000) throw submissionError('Keep the work link under 2,000 characters.');
    let parsed;
    try {
      parsed = new URL(rawLink);
    } catch (_) {
      throw submissionError('Enter a valid https:// shared-work link.');
    }
    if (parsed.protocol !== 'https:') {
      throw submissionError('Work links must start with https://.');
    }
    workLink = parsed.toString();
  }

  const files = body.files && typeof body.files === 'object' ? body.files : {};
  if (Object.keys(files).some((name) => name !== 'attachment')) {
    throw submissionError('Attach only one homework file.');
  }
  const upload = files.attachment;
  let file = null;
  if (upload) {
    if (!Buffer.isBuffer(upload.buffer) || !Number.isFinite(upload.size) || !upload.size) {
      throw submissionError('The attached file could not be read. Choose it again.');
    }
    if (upload.size > MAX_SUBMISSION_FILE_BYTES) {
      throw submissionError('Choose a work file smaller than 5 MB.', 413);
    }
    const filename = safeSubmissionFilename(upload.filename);
    const extension = path.extname(filename).toLowerCase();
    const definition = SUBMISSION_FILE_TYPES[extension];
    if (!definition) {
      throw submissionError('Attach a PDF, document, text file, or image under 5 MB.');
    }
    const declaredMime = String(upload.contentType || '').split(';')[0].trim().toLowerCase();
    if (!GENERIC_UPLOAD_MIME_TYPES.has(declaredMime) && !definition.acceptedMimes.includes(declaredMime)) {
      throw submissionError(`The file type does not match “${filename}”. Choose the original file again.`);
    }
    if (!hasExpectedFileSignature(extension, upload.buffer)) {
      throw submissionError('That file appears to be invalid. Choose the original PDF or image again.');
    }
    file = { filename, mimeType: definition.mimeType, data: upload.buffer };
  }

  if (!workLink && !file) throw submissionError('Attach your work file or add a Teams/shared work link before submitting.');
  return { workLink, file };
}

function createAssignment(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'teacher') return sendJson(res, 403, { error: 'Teachers only' });
  const { title, due_date, credit_value } = body;
  if (!title || !due_date) return sendJson(res, 400, { error: 'title and due_date are required' });

  const creditValue = parseCreditValue(credit_value);
  if (creditValue === null) {
    return sendJson(res, 400, { error: `credit_value must be a whole number from 1 to ${MAX_CREDIT_VALUE}` });
  }

  const info = db
    .prepare(`INSERT INTO assignments (teacher_id, title, due_date, credit_value, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(ctx.session.userId, title, due_date, creditValue, new Date().toISOString());

  sendJson(res, 201, { assignment_id: info.lastInsertRowid, credit_value: creditValue });
}

function listAssignments(body, req, res, ctx) {
  if (!ctx.session) return sendJson(res, 401, { error: 'Not logged in' });
  const rows = db.prepare('SELECT * FROM assignments ORDER BY due_date ASC').all();

  if (ctx.session.role === 'student') {
    const mySubs = db.prepare(`SELECT ${SUBMISSION_COLUMNS} FROM submissions WHERE student_id = ?`).all(ctx.session.userId);
    const byAssignment = Object.fromEntries(mySubs.map((s) => [s.assignment_id, s]));
    return sendJson(res, 200, {
      assignments: rows.map((a) => ({ ...a, mySubmission: byAssignment[a.assignment_id] || null })),
    });
  }
  sendJson(res, 200, { assignments: rows });
}

function submitAssignment(body, req, res, ctx, params) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });
  const assignmentId = Number(params.id);
  if (!Number.isSafeInteger(assignmentId) || assignmentId < 1) {
    return sendJson(res, 400, { error: 'Invalid assignment id' });
  }

  let work;
  try {
    work = validateSubmissionWork(body);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message || 'The work could not be submitted.' });
  }

  // A submission is only evidence for the teacher to grade. Credits are not
  // granted here; grading is the one place that calculates and awards them.
  let transactionOpen = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionOpen = true;

    const assignment = db.prepare('SELECT * FROM assignments WHERE assignment_id = ?').get(assignmentId);
    if (!assignment) {
      db.exec('ROLLBACK');
      transactionOpen = false;
      return sendJson(res, 404, { error: 'Assignment not found' });
    }

    const existing = db
      .prepare('SELECT submission_id FROM submissions WHERE assignment_id = ? AND student_id = ?')
      .get(assignmentId, ctx.session.userId);
    if (existing) {
      db.exec('ROLLBACK');
      transactionOpen = false;
      return sendJson(res, 409, { error: 'Already submitted' });
    }

    const now = new Date();
    const onTime = now <= new Date(assignment.due_date) ? 1 : 0;
    const submittedAt = now.toISOString();
    db.prepare(
      `INSERT INTO submissions
        (assignment_id, student_id, status, on_time, submitted_at, credits_awarded, credit_awarded_at,
         submission_url, submission_file_name, submission_file_mime, submission_file_data, grade_score, graded_at)
       VALUES (?, ?, 'submitted', ?, ?, 0, NULL, ?, ?, ?, ?, NULL, NULL)`
    ).run(
      assignmentId,
      ctx.session.userId,
      onTime,
      submittedAt,
      work.workLink,
      work.file ? work.file.filename : null,
      work.file ? work.file.mimeType : null,
      work.file ? work.file.data : null
    );

    db.exec('COMMIT');
    transactionOpen = false;
    sendJson(res, 201, {
      on_time: !!onTime,
      credits_granted: 0,
      message: 'Work submitted. Your teacher will grade it before credits are awarded.',
    });
  } catch (err) {
    if (transactionOpen) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {
        // The original error is more useful to callers than a rollback error.
      }
    }
    console.error('Unable to submit assignment:', err);
    sendJson(res, 500, { error: 'Unable to submit assignment. Please try again.' });
  }
}

function listSubmissions(body, req, res, ctx, params) {
  if (!ctx.session || ctx.session.role !== 'teacher') return sendJson(res, 403, { error: 'Teachers only' });
  const assignmentId = Number(params.id);
  const assignment = db.prepare('SELECT * FROM assignments WHERE assignment_id = ?').get(assignmentId);
  if (!assignment || assignment.teacher_id !== ctx.session.userId) {
    return sendJson(res, 404, { error: 'Assignment not found' });
  }
  const rows = db
    .prepare(
      `SELECT ${SUBMISSION_COLUMNS.split(',').map((column) => `s.${column.trim()}`).join(', ')},
              u.name AS student_name, u.email AS student_email
       FROM submissions s JOIN users u ON u.user_id = s.student_id
       WHERE s.assignment_id = ?`
    )
    .all(assignmentId);
  sendJson(res, 200, { submissions: rows });
}

function gradeSubmission(body, req, res, ctx, params) {
  if (!ctx.session || ctx.session.role !== 'teacher') return sendJson(res, 403, { error: 'Teachers only' });
  const submissionId = Number(params.id);
  const gradeScore = Number(body.grade_score);
  if (!Number.isSafeInteger(submissionId) || submissionId < 1) return sendJson(res, 400, { error: 'Invalid submission id' });
  if (!Number.isSafeInteger(gradeScore) || gradeScore < 0 || gradeScore > 100) {
    return sendJson(res, 400, { error: 'Grade must be a whole number from 0 to 100.' });
  }

  let transactionOpen = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    const sub = db
      .prepare(
        `SELECT s.*, a.teacher_id, a.credit_value
         FROM submissions s JOIN assignments a ON a.assignment_id = s.assignment_id
         WHERE s.submission_id = ?`
      )
      .get(submissionId);
    if (!sub || sub.teacher_id !== ctx.session.userId) {
      db.exec('ROLLBACK');
      transactionOpen = false;
      return sendJson(res, 404, { error: 'Submission not found' });
    }
    if (sub.graded_at || sub.status === 'graded' || sub.credit_awarded_at) {
      db.exec('ROLLBACK');
      transactionOpen = false;
      return sendJson(res, 409, { error: 'This submission has already been graded.' });
    }

    // Credits are integer values. Round down so the teacher-defined maximum
    // is never exceeded (for example, 90/100 on a 5-credit task earns 4).
    const earnedCredits = Math.floor((sub.credit_value * gradeScore) / 100);
    const gradedAt = new Date().toISOString();
    const granted = earnedCredits > 0
      ? awardCredits(sub.student_id, earnedCredits, 'homework_grade', { bypassDailyCap: true })
      : 0;
    if (granted !== earnedCredits) throw new Error('Could not award the graded credits.');

    db.prepare(
      `UPDATE submissions
       SET status = 'graded', grade_score = ?, graded_at = ?, credits_awarded = ?, credit_awarded_at = ?
       WHERE submission_id = ?`
    ).run(gradeScore, gradedAt, granted, granted > 0 ? gradedAt : null, submissionId);

    db.exec('COMMIT');
    transactionOpen = false;
    sendJson(res, 200, {
      grade_score: gradeScore,
      credits_granted: granted,
      credit_value: sub.credit_value,
    });
  } catch (error) {
    if (transactionOpen) {
      try { db.exec('ROLLBACK'); } catch (_) { /* preserve the first error */ }
    }
    console.error('Unable to grade submission:', error);
    sendJson(res, 500, { error: 'Unable to grade this submission. Please try again.' });
  }
}

function getSubmissionFile(body, req, res, ctx, params) {
  if (!ctx.session) return sendJson(res, 401, { error: 'Please log in first.' });
  const submissionId = Number(params.id);
  if (!Number.isSafeInteger(submissionId) || submissionId < 1) return sendJson(res, 400, { error: 'Invalid submission id' });
  const sub = db
    .prepare(
      `SELECT s.student_id, s.submission_file_name, s.submission_file_mime, s.submission_file_data, a.teacher_id
       FROM submissions s JOIN assignments a ON a.assignment_id = s.assignment_id
       WHERE s.submission_id = ?`
    )
    .get(submissionId);
  if (!sub || (ctx.session.userId !== sub.student_id && ctx.session.userId !== sub.teacher_id)) {
    return sendJson(res, 404, { error: 'Submission file not found' });
  }
  if (!sub.submission_file_data || !sub.submission_file_name || !sub.submission_file_mime) {
    return sendJson(res, 404, { error: 'This submission has no uploaded file.' });
  }
  const filename = safeSubmissionFilename(sub.submission_file_name).replace(/"/g, '');
  res.writeHead(200, {
    'Content-Type': sub.submission_file_mime,
    'Content-Length': sub.submission_file_data.length,
    'Content-Disposition': `inline; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(sub.submission_file_data);
}

function updateSubmissionStatus(body, req, res, ctx, params) {
  if (!ctx.session || ctx.session.role !== 'teacher') return sendJson(res, 403, { error: 'Teachers only' });
  const submissionId = Number(params.id);
  const { status } = body;
  if (!status) return sendJson(res, 400, { error: 'status is required' });

  const sub = db
    .prepare(
      `SELECT s.*, a.teacher_id FROM submissions s JOIN assignments a ON a.assignment_id = s.assignment_id WHERE s.submission_id = ?`
    )
    .get(submissionId);
  if (!sub || sub.teacher_id !== ctx.session.userId) return sendJson(res, 404, { error: 'Submission not found' });

  db.prepare('UPDATE submissions SET status = ? WHERE submission_id = ?').run(status, submissionId);
  sendJson(res, 200, { ok: true });
}

module.exports = {
  createAssignment,
  listAssignments,
  submitAssignment,
  listSubmissions,
  updateSubmissionStatus,
  gradeSubmission,
  getSubmissionFile,
};
