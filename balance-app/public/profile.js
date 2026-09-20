function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

(async function init() {
  const user = await requireAuth();
  if (!user) return;

  const res = await fetch('/api/profile');
  const content = document.getElementById('profileContent');
  if (!res.ok) {
    content.innerHTML = '<p class="text-muted">Could not load profile.</p>';
    return;
  }
  const p = await res.json();
  const joined = new Date(p.memberSince).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  let html = `
    <div class="profile-hero">
      <div class="avatar">${initials(p.name)}</div>
      <div>
        <h2>${escapeHtml(p.name)}</h2>
        <div class="sub">${escapeHtml(p.email)}</div>
        <div class="sub">
          <span class="pill ${p.role === 'teacher' ? 'pill-blue' : 'pill-lime'}">${p.role}</span>
          ${p.className ? `<span class="pill pill-neutral">${escapeHtml(p.className)}</span>` : '<span class="pill pill-neutral">No class assigned</span>'}
        </div>
      </div>
    </div>
  `;

  if (p.role === 'student') {
    html += `
      <div class="lifetime-card">
        <div class="big-number">${p.lifetimeEarned.toLocaleString()}</div>
        <div class="big-label">Total credits earned since ${joined}</div>
      </div>
      <div class="stat-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="stat-tile"><div class="stat-number">${p.currentBalance}</div><div class="stat-label">Spendable balance</div></div>
        <div class="stat-tile"><div class="stat-number blue">${p.lifetimeEarned - p.currentBalance}</div><div class="stat-label">Spent so far</div></div>
      </div>

      <div class="section-label">Recent purchases</div>
      <div class="card">
        ${
          p.recentPurchases.length
            ? p.recentPurchases
                .map(
                  (pu) => `
              <div class="purchase-row">
                <span>${escapeHtml(pu.item_name)}</span>
                <span>
                  <span class="text-muted">-${pu.item_cost} credits</span>
                  <span class="p-date">${new Date(pu.purchased_at).toLocaleDateString()}</span>
                </span>
              </div>`
                )
                .join('')
            : '<p class="text-muted" style="font-size:0.85rem;">No purchases yet — visit the Shop!</p>'
        }
      </div>
    `;
  } else {
    html += `
      <div class="lifetime-card">
        <div class="big-number">${p.studentCount}</div>
        <div class="big-label">Students in ${p.className ? escapeHtml(p.className) : 'your class'}</div>
      </div>
      <p class="text-muted" style="font-size:0.85rem;">
        Member since ${joined}. Use the Homework Hub to manage assignments for this class,
        and Wellness Insights on the dashboard for anonymized class trends.
      </p>
    `;
  }

  content.innerHTML = html;
})();
