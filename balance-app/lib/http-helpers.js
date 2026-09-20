// lib/http-helpers.js — tiny hand-rolled helpers so the whole app runs on
// Node's built-in `http` module with zero npm dependencies.
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy(); // 1MB body cap
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readBufferBody(req, maxBytes) {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return Promise.reject(httpError('The upload is too large. Choose a file smaller than 5 MB.', 413));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        // Keep consuming the request so the server can return a useful error
        // instead of abruptly closing the browser connection.
        req.resume();
        reject(httpError('The upload is too large. Choose a file smaller than 5 MB.', 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function getMultipartBoundary(contentType) {
  const value = String(contentType || '');
  const match = value.match(/multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;,\s]+))/i);
  const boundary = match && (match[1] || match[2]);
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) {
    throw httpError('The upload form is invalid. Please choose the file again.');
  }
  return boundary;
}

function parseMultipartHeaders(headerBytes) {
  const headerText = headerBytes.toString('utf8');
  const headers = {};
  for (const line of headerText.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw httpError('The upload form is invalid. Please try again.');
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!name || !value || headers[name]) throw httpError('The upload form is invalid. Please try again.');
    headers[name] = value;
  }
  return headers;
}

function parseContentDisposition(value) {
  if (!/^form-data(?:;|$)/i.test(value || '')) {
    throw httpError('The upload form is invalid. Please try again.');
  }
  const nameMatch = String(value).match(/(?:^|;)\s*name="([^"]*)"/i);
  const filenameMatch = String(value).match(/(?:^|;)\s*filename="([^"]*)"/i);
  if (!nameMatch || !/^[a-zA-Z0-9_-]{1,64}$/.test(nameMatch[1])) {
    throw httpError('The upload form is invalid. Please try again.');
  }
  return { name: nameMatch[1], filename: filenameMatch ? filenameMatch[1] : null };
}

// Minimal, bounded multipart parser for the one Homework AI attachment. It
// keeps bytes in memory only for the duration of the API request; it never
// writes student files to disk.
function parseMultipartBuffer(buffer, boundary, options = {}) {
  const maxFileBytes = options.maxFileBytes || 5 * 1024 * 1024;
  const maxFieldBytes = options.maxFieldBytes || 32 * 1024;
  const openingBoundary = Buffer.from(`--${boundary}`);
  const nextBoundary = Buffer.from(`\r\n--${boundary}`);
  const crlf = Buffer.from('\r\n');
  const headerSeparator = Buffer.from('\r\n\r\n');
  // Null-prototype maps keep multipart field names such as "__proto__" from
  // changing object behaviour before the route validates the expected names.
  const fields = Object.create(null);
  const files = Object.create(null);

  if (buffer.length < openingBoundary.length + 2 || !buffer.subarray(0, openingBoundary.length).equals(openingBoundary)) {
    throw httpError('The upload form is invalid. Please choose the file again.');
  }

  let cursor = openingBoundary.length;
  if (buffer.subarray(cursor, cursor + 2).toString('ascii') === '--') return { fields, files };
  if (!buffer.subarray(cursor, cursor + 2).equals(crlf)) {
    throw httpError('The upload form is invalid. Please choose the file again.');
  }
  cursor += 2;

  while (cursor < buffer.length) {
    const headerEnd = buffer.indexOf(headerSeparator, cursor);
    if (headerEnd === -1 || headerEnd - cursor > 16 * 1024) {
      throw httpError('The upload form is invalid. Please choose the file again.');
    }

    const headers = parseMultipartHeaders(buffer.subarray(cursor, headerEnd));
    const disposition = parseContentDisposition(headers['content-disposition']);
    const dataStart = headerEnd + headerSeparator.length;
    const boundaryStart = buffer.indexOf(nextBoundary, dataStart);
    if (boundaryStart === -1) {
      throw httpError('The upload form is incomplete. Please choose the file again.');
    }
    const data = buffer.subarray(dataStart, boundaryStart);

    if (disposition.filename !== null) {
      // Browsers can send an empty part when a file chooser is left blank.
      if (disposition.filename || data.length) {
        if (data.length > maxFileBytes) {
          throw httpError('The file is too large. Choose a file smaller than 5 MB.', 413);
        }
        if (Object.prototype.hasOwnProperty.call(files, disposition.name)) {
          throw httpError('Please attach only one file at a time.');
        }
        files[disposition.name] = {
          filename: disposition.filename,
          contentType: headers['content-type'] || '',
          buffer: data,
          size: data.length,
        };
      }
    } else {
      if (data.length > maxFieldBytes || Object.prototype.hasOwnProperty.call(fields, disposition.name)) {
        throw httpError('The upload form is invalid. Please try again.');
      }
      fields[disposition.name] = data.toString('utf8');
    }

    cursor = boundaryStart + nextBoundary.length;
    const boundarySuffix = buffer.subarray(cursor, cursor + 2).toString('ascii');
    if (boundarySuffix === '--') {
      cursor += 2;
      // A final CRLF is optional in multipart bodies. Do not accept arbitrary
      // bytes after the terminator, which helps catch malformed requests.
      if (cursor !== buffer.length && !buffer.subarray(cursor).equals(crlf)) {
        throw httpError('The upload form is invalid. Please try again.');
      }
      return { fields, files };
    }
    if (boundarySuffix !== '\r\n') {
      throw httpError('The upload form is invalid. Please try again.');
    }
    cursor += 2;
  }

  throw httpError('The upload form is incomplete. Please choose the file again.');
}

async function readMultipartBody(req, options = {}) {
  const maxFileBytes = options.maxFileBytes || 5 * 1024 * 1024;
  const maxBodyBytes = options.maxBodyBytes || maxFileBytes + 128 * 1024;
  const boundary = getMultipartBoundary(req.headers['content-type']);
  const buffer = await readBufferBody(req, maxBodyBytes);
  return parseMultipartBuffer(buffer, boundary, { maxFileBytes, maxFieldBytes: options.maxFieldBytes });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; Max-Age=0`);
}

function serveStatic(req, res, publicDir) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(publicDir, urlPath);

  // prevent path traversal outside publicDir
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

module.exports = {
  readJsonBody,
  readMultipartBody,
  parseMultipartBuffer,
  sendJson,
  setCookie,
  clearCookie,
  serveStatic,
};
