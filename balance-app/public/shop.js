let currentUser = null;

async function loadCatalog() {
  const res = await fetch('/api/shop/catalog');
  const data = await res.json();
  renderCatalog(data.catalog);
}

function renderCatalog(catalog) {
  const grid = document.getElementById('itemGrid');
  const canBuy = currentUser.role === 'student';

  grid.innerHTML = catalog
    .map(
      (item) => `
    <div class="item-card">
      <img class="item-icon" src="assets/icons/${escapeHtml(item.icon)}" alt="">
      <div class="item-name">${item.name}</div>
      <div class="item-cost">${item.cost} credits</div>
      ${
        canBuy
          ? `<button class="btn btn-primary buyBtn" data-item="${item.id}" data-cost="${item.cost}">Buy</button>`
          : `<div class="pill pill-neutral">View only</div>`
      }
    </div>
  `
    )
    .join('');

  if (canBuy) {
    grid.querySelectorAll('.buyBtn').forEach((btn) =>
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await fetch('/api/shop/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: btn.dataset.item }),
          });
          const data = await res.json();
          if (!res.ok) {
            alert(data.error || 'Purchase failed.');
            btn.disabled = false;
            return;
          }
          document.getElementById('balanceLine').textContent = `Balance: ${data.newBalance} credits`;
          alert(`Purchased ${data.item.name}! New balance: ${data.newBalance} credits`);
        } catch (err) {
          alert('Could not reach the server.');
        }
        btn.disabled = false;
      })
    );
  }
}

async function loadProgress() {
  const res = await fetch('/api/shop/progress');
  const data = await res.json();
  const card = document.getElementById('pizzaCard');

  if (!data.hasClass) {
    card.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">No class assigned — join a class to see the group pizza-party goal.</p>';
    return;
  }

  card.innerHTML = `
    <div class="pizza-header">
      <div class="pizza-title"><img class="item-icon" src="assets/icons/pizza.png" alt="">${escapeHtml(data.className)}'s Pizza Party Goal</div>
      <div class="pizza-numbers">${data.totalCredits} / ${data.goal} credits this month</div>
    </div>
    <div class="progress-track pizza-track">
      <div class="progress-fill" style="width:${data.percent}%;"></div>
    </div>
    <p class="pizza-goal-msg ${data.goalReached ? 'reached' : ''}">
      ${
        data.goalReached
          ? 'Goal reached — time to plan the pizza party!'
          : `${data.goal - data.totalCredits} more credits earned by the class this month unlocks the pizza party.`
      }
    </p>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

(async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  if (currentUser.role === 'student' && currentUser.wallet) {
    document.getElementById('balanceLine').textContent = `Balance: ${currentUser.wallet.balance} credits`;
  } else {
    document.getElementById('balanceLine').textContent = 'Viewing as teacher — purchases are student-only.';
  }

  await Promise.all([loadCatalog(), loadProgress()]);
})();
