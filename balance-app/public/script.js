// script.js — login page, wired to the real backend (no more fake alert()s)
const form = document.getElementById('loginForm');
const errorEl = document.getElementById('formError');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  errorEl.style.display = 'none';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error || 'Đăng nhập thất bại.');
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError('Không thể kết nối tới máy chủ.');
  }
});

document.getElementById('btnGoogle').addEventListener('click', function () {
  alert('Đăng nhập Google/WebAuthn sinh trắc học chưa được cài đặt trong bản demo này — dùng email/mật khẩu ở trên nhé.');
});
