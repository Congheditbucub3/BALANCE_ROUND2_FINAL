// lib/shop.js — the shop catalog lives here once, so the purchase endpoint
// validates against the exact same prices the UI displays. Never trust a
// price sent from the client — /api/shop/buy only ever charges what's here.
const CATALOG = [
  { id: 'pencil', name: 'Pencil', icon: 'pencil.png', cost: 20 },
  { id: 'pencil_case', name: 'Pencil Case', icon: 'pencilcase.png', cost: 50 },
  { id: 'pen', name: 'Pen', icon: 'pen.png', cost: 25 },
];

const CLASS_MONTHLY_GOAL = 500; // credits the whole class needs to earn this month for a pizza party

function findItem(itemId) {
  return CATALOG.find((i) => i.id === itemId) || null;
}

module.exports = { CATALOG, CLASS_MONTHLY_GOAL, findItem };
