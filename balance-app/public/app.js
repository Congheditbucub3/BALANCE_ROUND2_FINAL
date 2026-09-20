// app.js — shared across dashboard/steptracker/timer/homework pages.
// Renders a small top nav with the user's name, role, wallet balance
// (students only) and a logout button; redirects to login if not authed.

const CACHED_USER_KEY = 'balance_cached_user';

async function requireAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      // Server reached us and said "not logged in" — this is a real signal,
      // unlike a network failure below, so it's the one case that redirects.
      localStorage.removeItem(CACHED_USER_KEY);
      window.location.href = 'index.html';
      return null;
    }
    const { user } = await res.json();
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    renderNav(user);
    return user;
  } catch (err) {
    // Network failure, not an auth failure — e.g. offline mid-walk. Bouncing
    // to the login page here would throw away in-progress tracking for no
    // reason. Fall back to the last confirmed session instead, so the page
    // keeps working (queuing to IndexedDB, etc.) until connectivity returns.
    const cached = localStorage.getItem(CACHED_USER_KEY);
    if (cached) {
      const user = JSON.parse(cached);
      renderNav(user, /* offline */ true);
      return user;
    }
    // No prior session to fall back on — we genuinely don't know if this
    // person is logged in, so send them to log in once connectivity allows.
    window.location.href = 'index.html';
    return null;
  }
}

function renderNav(user, offline) {
  renderSidebar(user);

  const nav = document.createElement('div');
  nav.id = 'balanceNav';
  nav.className = 'balance-nav';

  const left = document.createElement('div');
  left.style.display = 'flex';
  left.style.alignItems = 'center';
  left.style.gap = '4px';

  const menuBtn = document.createElement('button');
  menuBtn.className = 'menu-btn';
  menuBtn.setAttribute('aria-label', 'Open menu');
  menuBtn.innerHTML = '☰';
  menuBtn.onclick = () => toggleSidebar(true);
  left.appendChild(menuBtn);

  const brandWrap = document.createElement('div');
  brandWrap.innerHTML = `
    <a href="dashboard.html" class="brand">
      <img class="brand-logo" src="assets/icons/balance-logo.png" alt="">
      Balance
    </a>
    <span class="name name-role">${escapeHtml(user.name)} · ${user.role}${user.class_name ? ' · ' + escapeHtml(user.class_name) : ''}</span>
    ${offline ? '<span class="offline-flag">offline — cached session</span>' : ''}
  `;
  brandWrap.style.display = 'flex';
  brandWrap.style.alignItems = 'center';
  brandWrap.style.gap = '4px';
  left.appendChild(brandWrap);

  const right = document.createElement('div');
  right.className = 'right';

  if (user.role === 'student' && user.wallet) {
    const bal = document.createElement('span');
    bal.className = 'credit-badge';
    bal.innerHTML = `<img class="nav-credit-icon" src="assets/icons/coin.png" alt=""> ${Number(user.wallet.balance) || 0}`;
    right.appendChild(bal);
  } else if (user.role === 'teacher') {
    const badge = document.createElement('span');
    badge.className = 'pill pill-blue';
    badge.textContent = 'Teacher';
    right.appendChild(badge);
  }

  const logoutBtn = document.createElement('button');
  logoutBtn.textContent = 'Log out';
  logoutBtn.className = 'logout-btn';
  logoutBtn.onclick = async () => {
    await fetch('/api/logout', { method: 'POST' });
    localStorage.removeItem(CACHED_USER_KEY);
    window.location.href = 'index.html';
  };
  right.appendChild(logoutBtn);

  nav.appendChild(left);
  nav.appendChild(right);
  document.body.prepend(nav);
  document.body.classList.add('has-balance-nav');
}

// The sidebar is the same three links (Home / Profile / Shop) on every
// authenticated page — built once here in the shared nav module so every
// page that includes app.js gets it automatically, rather than each page
// re-implementing its own copy.
function renderSidebar(user) {
  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.id = 'sidebarBackdrop';
  backdrop.onclick = () => toggleSidebar(false);

  const sidebar = document.createElement('div');
  sidebar.className = 'sidebar';
  sidebar.id = 'sidebarPanel';

  const links = [
    { href: 'dashboard.html', label: 'Home' },
    { href: 'profile.html', label: 'Profile' },
  ];
  // Spending only makes sense for students, but teachers can still see the
  // catalog and the class's pizza-party progress (view-only — the buy
  // endpoint itself is student-only regardless of what the UI shows).
  links.push({ href: 'shop.html', iconPath: 'assets/icons/shopping.png', label: 'Shop' });

  sidebar.innerHTML = `
    <button class="sidebar-close" id="sidebarCloseBtn" aria-label="Close menu">✕</button>
    <div class="sidebar-brand">
      <img class="brand-logo" src="assets/icons/balance-logo.png" alt="">
      Balance
    </div>
    ${links
      .map(
        (l) => `<a href="${l.href}" class="sidebar-link${currentPage === l.href ? ' active' : ''}">
          ${l.iconPath ? `<img class="nav-link-icon" src="${l.iconPath}" alt="">` : ''}<span>${l.label}</span>
        </a>`
      )
      .join('')}
    <div class="sidebar-footer">${escapeHtml(user.name)}<br>${escapeHtml(user.class_name || 'No class assigned')}</div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sidebar);
  document.getElementById('sidebarCloseBtn').onclick = () => toggleSidebar(false);

  // Esc closes it too
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleSidebar(false);
  });
}

function toggleSidebar(open) {
  const backdrop = document.getElementById('sidebarBackdrop');
  const sidebar = document.getElementById('sidebarPanel');
  if (!backdrop || !sidebar) return;
  backdrop.classList.toggle('open', open);
  sidebar.classList.toggle('open', open);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
