// register.js
const STUDENT_DOMAIN = '@nguyensieuschool.edu.com';
const TEACHER_DOMAIN = '@nguyensieuschool.com';

const emailInput = document.getElementById('regEmail');
const rolePreview = document.getElementById('rolePreview');
const errorEl = document.getElementById('formError');

function previewRole() {
  const e = emailInput.value.trim().toLowerCase();
  if (e.endsWith(STUDENT_DOMAIN)) {
    rolePreview.textContent = 'Sẽ đăng ký với vai trò: Học sinh';
    rolePreview.style.color = '#d6ff3f';
  } else if (e.endsWith(TEACHER_DOMAIN)) {
    rolePreview.textContent = 'Sẽ đăng ký với vai trò: Giáo viên';
    rolePreview.style.color = '#4c8dff';
  } else {
    rolePreview.textContent = 'Học sinh: @nguyensieuschool.edu.com  •  Giáo viên: @nguyensieuschool.com';
    rolePreview.style.color = '';
  }
}
emailInput.addEventListener('input', previewRole);

// Populate the class dropdown from the server so it always reflects
// whatever classes actually exist, rather than being hardcoded in HTML.
(async function loadClasses() {
  const classSelect = document.getElementById('regClass');
  try {
    const res = await fetch('/api/classes');
    const data = await res.json();
    classSelect.innerHTML =
      '<option value="" disabled selected>Chọn lớp…</option>' +
      data.classes.map((c) => `<option value="${c.class_id}">${c.name}</option>`).join('');
  } catch (err) {
    classSelect.innerHTML = '<option value="" disabled selected>Không tải được danh sách lớp</option>';
  }
})();

document.getElementById('registerForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  errorEl.style.display = 'none';

  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const class_id = document.getElementById('regClass').value;

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, class_id }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Đăng ký thất bại.';
      errorEl.style.display = 'block';
      return;
    }
    window.location.href = 'dashboard.html';
  } catch (err) {
    errorEl.textContent = 'Không thể kết nối tới máy chủ.';
    errorEl.style.display = 'block';
  }
});
