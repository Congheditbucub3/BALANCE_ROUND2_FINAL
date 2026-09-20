let currentUser = null;

function renderHomeworkCoach() {
  const panel = document.getElementById('coachPanel');
  panel.innerHTML = `
    <section class="card coach-card" aria-labelledby="coachTitle">
      <span class="eyebrow">Homework AI Coach</span>
      <h2 id="coachTitle">Work through it, one step at a time</h2>
      <p>This is a strict study coach, not an answer generator. It helps you work, but it will not write a finished answer for you.</p>
      <form id="homeworkCoachForm">
        <label class="field coach-mode-field">
          <span class="coach-field-label">How should the coach help?</span>
          <select id="coachSupportMode" class="input-field">
            <option value="first_hint">Give me the first hint</option>
            <option value="review_attempt">Review my attempt</option>
            <option value="teach_method">Teach the method, not the answer</option>
          </select>
          <span class="coach-mode-guidance" id="coachModeGuidance"></span>
        </label>
        <label class="field" style="margin-bottom:12px;">
          <span class="coach-field-label">Your question</span>
          <textarea id="coachQuestion" class="input-field coach-question" maxlength="8000" placeholder="Paste your homework question here, or attach the question below…"></textarea>
        </label>
        <label class="field coach-attempt-field" id="coachAttemptField" hidden>
          <span class="coach-field-label">What have you tried?</span>
          <textarea id="coachAttempt" class="input-field coach-question" maxlength="4000" placeholder="Show your working, your idea, or the part that confused you…"></textarea>
        </label>
        <div class="coach-attachment">
          <span class="coach-attachment-label">Attach homework (optional)</span>
          <label class="coach-file-picker">
            <span>Choose a file or picture</span>
            <input id="coachAttachment" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,.doc,.docx,.rtf,.odt,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx">
          </label>
          <p class="coach-file-help" id="coachFileHelp">Images, PDFs, Word documents, text files, spreadsheets, or presentations — up to 5 MB.</p>
          <div class="coach-file-selected" id="coachFileSelected" hidden>
            <span class="coach-file-name" id="coachFileName"></span>
            <button class="coach-file-clear" id="coachFileClear" type="button" aria-label="Remove attached file">Remove</button>
          </div>
        </div>
        <button class="btn btn-primary" id="coachAskButton" type="submit">Explain this with me</button>
      </form>
      <p class="coach-status" id="coachStatus" aria-live="polite"></p>
      <div class="coach-answer" id="coachAnswer" hidden aria-live="polite"></div>
    </section>
  `;

  const form = document.getElementById('homeworkCoachForm');
  const question = document.getElementById('coachQuestion');
  const button = document.getElementById('coachAskButton');
  const status = document.getElementById('coachStatus');
  const answer = document.getElementById('coachAnswer');
  const supportMode = document.getElementById('coachSupportMode');
  const attemptField = document.getElementById('coachAttemptField');
  const attempt = document.getElementById('coachAttempt');
  const modeGuidance = document.getElementById('coachModeGuidance');
  const attachmentInput = document.getElementById('coachAttachment');
  const attachmentSelected = document.getElementById('coachFileSelected');
  const attachmentName = document.getElementById('coachFileName');
  const attachmentClear = document.getElementById('coachFileClear');
  const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
  const MIN_ATTEMPT_CHARACTERS = 8;
  const ACCEPTED_EXTENSIONS = new Set([
    '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.doc', '.docx',
    '.rtf', '.odt', '.txt', '.md', '.csv', '.xls', '.xlsx', '.ppt', '.pptx',
  ]);

  function updateSupportMode() {
    const needsAttempt = supportMode.value === 'review_attempt';
    attemptField.hidden = !needsAttempt;
    attempt.required = needsAttempt;
    if (!needsAttempt) attempt.value = '';
    const modeHelp = {
      first_hint: 'The coach explains what the question asks, gives one first move, then asks you a question.',
      review_attempt: 'Show your working first. The coach will point out one strength, one important correction, and your next move.',
      teach_method: 'The coach teaches a general method and may use a different example. It will not finish your exact question.',
    };
    modeGuidance.textContent = modeHelp[supportMode.value];
  }
  supportMode.addEventListener('change', updateSupportMode);
  updateSupportMode();

  function extensionFor(fileName) {
    const match = String(fileName || '').toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
  }

  function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function validateSelectedFile(file) {
    if (!file) return '';
    if (!ACCEPTED_EXTENSIONS.has(extensionFor(file.name))) {
      return 'Choose an image, PDF, Word document, text file, spreadsheet, or presentation.';
    }
    if (!file.size) return 'The attached file is empty. Please choose another file.';
    if (file.size > MAX_ATTACHMENT_BYTES) return 'Choose a file smaller than 5 MB.';
    return '';
  }

  function hasMeaningfulAttempt(value) {
    return Array.from(String(value || '').replace(/\s+/g, '')).length >= MIN_ATTEMPT_CHARACTERS;
  }

  function updateAttachmentDisplay() {
    const file = attachmentInput.files && attachmentInput.files[0];
    if (!file) {
      attachmentSelected.hidden = true;
      attachmentName.textContent = '';
      return;
    }
    attachmentName.textContent = `${file.name} (${formatFileSize(file.size)})`;
    attachmentSelected.hidden = false;
  }

  attachmentInput.addEventListener('change', () => {
    const file = attachmentInput.files && attachmentInput.files[0];
    const validationError = validateSelectedFile(file);
    if (validationError) {
      attachmentInput.value = '';
      updateAttachmentDisplay();
      status.textContent = validationError;
      return;
    }
    updateAttachmentDisplay();
    status.textContent = file ? 'Attachment ready. Add a question if you want to give the coach extra context.' : '';
  });

  attachmentClear.addEventListener('click', () => {
    attachmentInput.value = '';
    updateAttachmentDisplay();
    status.textContent = 'Attachment removed.';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = question.value.trim();
    const attemptedWork = attempt.value.trim();
    const file = attachmentInput.files && attachmentInput.files[0];
    const validationError = validateSelectedFile(file);
    if (validationError) {
      status.textContent = validationError;
      return;
    }
    if (!text && !file) {
      status.textContent = 'Enter a question or attach a homework file first.';
      return;
    }
    if (supportMode.value === 'review_attempt' && !hasMeaningfulAttempt(attemptedWork)) {
      status.textContent = 'Show at least a short piece of working so the coach can review your attempt.';
      return;
    }

    button.disabled = true;
    status.textContent = file ? 'Reading your attachment and preparing a study step…' : 'Preparing a study step…';
    answer.hidden = true;
    answer.textContent = '';

    try {
      const formData = new FormData();
      if (text) formData.append('question', text);
      formData.append('supportMode', supportMode.value);
      if (attemptedWork) formData.append('studentAttempt', attemptedWork);
      if (file) formData.append('attachment', file, file.name);
      const response = await fetch('/api/ai/homework', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The Homework Coach could not answer right now.');
      answer.innerHTML = renderSafeMarkdown(data.answer);
      renderAiMath(answer);
      answer.hidden = false;
      status.textContent = 'Here is your next study step.';
    } catch (error) {
      status.textContent = error.message || 'The Homework Coach could not answer right now.';
    } finally {
      button.disabled = false;
    }
  });
}

async function loadAssignments() {
  const res = await fetch('/api/assignments');
  const data = await res.json();
  renderAssignments(data.assignments || []);
}

function renderAssignments(assignments) {
  const listEl = document.getElementById('assignmentList');
  if (!assignments.length) {
    listEl.innerHTML = '<p class="empty-msg">No assignments yet.</p>';
    return;
  }

  listEl.innerHTML = '';
  assignments.forEach((a) => {
    const card = document.createElement('div');
    card.className = 'assignment-card';
    const due = new Date(a.due_date).toLocaleString();

    if (currentUser.role === 'student') {
      const sub = a.mySubmission;
      let statusHtml = '';
      let actionHtml = '';
      if (sub) {
        statusHtml = sub.on_time
          ? '<span class="pill pill-lime">on time</span>'
          : '<span class="pill pill-red">late</span>';
        const gradeHtml = Number.isInteger(sub.grade_score)
          ? `<div class="grade-result">Grade: ${sub.grade_score}/100 &middot; ${sub.credits_awarded}/${a.credit_value} credits earned</div>`
          : '<div class="a-meta" style="margin:10px 0 0;">Awaiting teacher grade. Credits are awarded only after grading.</div>';
        const workLinks = [];
        if (sub.submission_file_name) {
          workLinks.push(`<a href="/api/submissions/${sub.submission_id}/file" target="_blank" rel="noopener">View uploaded file: ${escapeHtml(sub.submission_file_name)}</a>`);
        }
        if (sub.submission_url) {
          workLinks.push(`<a href="${escapeHtml(sub.submission_url)}" target="_blank" rel="noopener">Open shared work link</a>`);
        }
        actionHtml = `${workLinks.length ? `<div class="submission-links">${workLinks.join('')}</div>` : ''}${gradeHtml}`;
      } else {
        actionHtml = `
          <form class="submission-form submitWorkForm" data-id="${a.assignment_id}">
            <span class="form-label">Submit your work for grading</span>
            <input name="attachment" type="file" accept="application/pdf,.pdf,.doc,.docx,.rtf,.odt,.txt,image/png,image/jpeg,image/webp,image/gif" aria-label="Work file">
            <input name="work_link" type="url" placeholder="Or paste a Teams/shared work link (https://...)" maxlength="2000" aria-label="Shared work link">
            <button class="btn btn-primary" type="submit">Send for grading</button>
            <p class="submit-status">Attach a PDF, document, text file, or image up to 5 MB, or add a shared-work link. No credits are awarded until grading.</p>
          </form>`;
      }
      card.innerHTML = `
        <div class="a-title">${escapeHtml(a.title)} ${statusHtml}</div>
        <div class="a-meta">Due ${due} &middot; worth ${a.credit_value} credits</div>
        ${actionHtml}
      `;
    } else {
      card.innerHTML = `
        <div class="a-title">${escapeHtml(a.title)}</div>
        <div class="a-meta">Due ${due} &middot; worth ${a.credit_value} credits</div>
        <button data-id="${a.assignment_id}" class="btn btn-ghost viewSubsBtn">View submissions</button>
        <div class="subsContainer" id="subs-${a.assignment_id}"></div>
      `;
    }
    listEl.appendChild(card);
  });

  listEl.querySelectorAll('.submitWorkForm').forEach((form) =>
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fileInput = form.querySelector('[name="attachment"]');
      const linkInput = form.querySelector('[name="work_link"]');
      const status = form.querySelector('.submit-status');
      const file = fileInput.files && fileInput.files[0];
      const link = linkInput.value.trim();
      const allowedExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.doc', '.docx', '.rtf', '.odt', '.txt']);
      const extension = file ? ((file.name.toLowerCase().match(/\.[a-z0-9]+$/) || [])[0] || '') : '';
      if (!file && !link) {
        status.textContent = 'Attach a work file or paste a shared-work link first.';
        return;
      }
      if (file && (!allowedExtensions.has(extension) || !file.size || file.size > 5 * 1024 * 1024)) {
        status.textContent = 'Use a non-empty PDF, document, text file, or image smaller than 5 MB.';
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      status.textContent = 'Uploading your work for teacher grading…';
      try {
        const formData = new FormData();
        if (file) formData.append('attachment', file, file.name);
        if (link) formData.append('work_link', link);
        const res = await fetch(`/api/assignments/${form.dataset.id}/submit`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not submit your work.');
        alert(data.message || 'Work submitted. Your teacher will grade it before credits are awarded.');
        loadAssignments();
      } catch (error) {
        status.textContent = error.message || 'Could not submit your work.';
        button.disabled = false;
      }
    })
  );

  listEl.querySelectorAll('.viewSubsBtn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const res = await fetch(`/api/assignments/${id}/submissions`);
      const data = await res.json();
      const container = document.getElementById(`subs-${id}`);
      if (!data.submissions || !data.submissions.length) {
        container.innerHTML = '<p class="empty-msg" style="font-size:0.8rem;margin-top:10px;">No submissions yet.</p>';
        return;
      }
      container.innerHTML = data.submissions
        .map(
          (s) => {
            const workLinks = [];
            if (s.submission_file_name) {
              workLinks.push(`<a href="/api/submissions/${s.submission_id}/file" target="_blank" rel="noopener">View file: ${escapeHtml(s.submission_file_name)}</a>`);
            }
            if (s.submission_url) {
              workLinks.push(`<a href="${escapeHtml(s.submission_url)}" target="_blank" rel="noopener">Open shared work link</a>`);
            }
            const result = Number.isInteger(s.grade_score)
              ? `<div class="grade-result">Grade ${s.grade_score}/100 &middot; ${s.credits_awarded} credits awarded</div>`
              : `<form class="grade-form" data-sub="${s.submission_id}">
                  <label>Grade <input type="number" name="grade_score" min="0" max="100" required></label>
                  <button class="btn btn-primary" type="submit">Grade /100</button>
                </form>`;
            return `
              <div class="sub-row">
                <div>
                  <span>${escapeHtml(s.student_name)} ${s.on_time ? '<span class="pill pill-lime">on time</span>' : '<span class="pill pill-red">late</span>'}</span>
                  ${workLinks.length ? `<div class="submission-links">${workLinks.join('')}</div>` : '<div class="a-meta" style="margin:6px 0 0;">No work file or shared link.</div>'}
                </div>
                ${result}
              </div>`;
          }
        )
        .join('');
      container.querySelectorAll('.grade-form').forEach((form) =>
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const gradeScore = form.querySelector('[name="grade_score"]').value;
          const button = form.querySelector('button');
          button.disabled = true;
          const res = await fetch(`/api/submissions/${form.dataset.sub}/grade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grade_score: gradeScore }),
          });
          const result = await res.json();
          if (!res.ok) {
            alert(result.error || 'Could not save this grade.');
            button.disabled = false;
            return;
          }
          alert(`Graded ${result.grade_score}/100. ${result.credits_granted} credits awarded.`);
          loadAssignments();
        })
      );
    })
  );
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

(async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  if (currentUser.role === 'teacher') {
    document.getElementById('teacherForm').innerHTML = `
      <form class="new-assignment" id="newAssignmentForm">
        <div class="eyebrow" style="margin-bottom:14px;">New assignment</div>
        <div class="field-row">
          <div class="field" style="margin-bottom:0;">
            <label>Title</label>
            <input type="text" id="newTitle" class="input-field" required>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Due date</label>
            <input type="datetime-local" id="newDue" class="input-field" required>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Credits</label>
            <input type="number" id="newCredits" class="input-field" value="10" min="1">
          </div>
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:16px;">Create assignment</button>
      </form>
    `;
    document.getElementById('newAssignmentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('newTitle').value;
      const due_date = new Date(document.getElementById('newDue').value).toISOString();
      const credit_value = document.getElementById('newCredits').value;
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, due_date, credit_value }),
      });
      if (res.ok) {
        e.target.reset();
        document.getElementById('newCredits').value = 10;
        loadAssignments();
      }
    });
  }

  if (currentUser.role === 'student') renderHomeworkCoach();

  loadAssignments();
})();
