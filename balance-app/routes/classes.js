// routes/classes.js — no auth required; the registration page needs this
// before anyone has an account or session yet.
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');

function listClasses(body, req, res) {
  const classes = db.prepare('SELECT class_id, name FROM classes ORDER BY name ASC').all();
  sendJson(res, 200, { classes });
}

module.exports = { listClasses };
