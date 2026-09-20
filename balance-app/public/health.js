const healthForm = document.getElementById('healthForm');
const healthSubmit = document.getElementById('healthSubmit');
const healthOutput = document.getElementById('healthOutput');
const openExercisePlan = document.getElementById('openExercisePlan');
const exercisePlanNote = document.getElementById('exercisePlanNote');
const savedMovementPlan = document.getElementById('savedMovementPlan');

function showHealthOutput(text, placeholder = false) {
  if (placeholder) {
    healthOutput.textContent = text;
  } else {
    healthOutput.innerHTML = renderSafeMarkdown(text);
    renderAiMath(healthOutput);
  }
  healthOutput.classList.toggle('placeholder', placeholder);
}

function showSavedMovementPlan(plan) {
  const squat = Number(plan?.squatRecommendation);
  const pushup = Number(plan?.pushupRecommendation);
  const note = String(plan?.safeMovementNote || '').trim();
  if (!Number.isInteger(squat) || !Number.isInteger(pushup) || squat < 1 || pushup < 1 || !note) {
    savedMovementPlan.hidden = true;
    openExercisePlan.hidden = true;
    exercisePlanNote.hidden = true;
    return;
  }

  savedMovementPlan.textContent = `Saved optional movement plan: ${squat} squats and ${pushup} push-ups at a comfortable pace. ${note}`;
  savedMovementPlan.hidden = false;
  openExercisePlan.hidden = false;
  exercisePlanNote.hidden = false;
}

async function loadSavedMovementPlan() {
  try {
    const response = await fetch('/api/health/movement-plan');
    if (!response.ok) return;
    const data = await response.json();
    if (data.movementPlan) showSavedMovementPlan(data.movementPlan);
  } catch (error) {
    // The current Health page still works if a transient network error stops
    // the saved-plan preview from loading.
  }
}

healthForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!healthForm.reportValidity()) return;

  healthSubmit.disabled = true;
  showHealthOutput('Building your starter plan…', true);

  const profile = {
    ageRange: document.getElementById('ageRange').value,
    goal: document.getElementById('goal').value,
    heightCm: document.getElementById('heightCm').value,
    weightKg: document.getElementById('weightKg').value,
    activity: document.getElementById('activity').value,
    foodStyle: document.getElementById('foodStyle').value,
    dietaryNeeds: document.getElementById('dietaryNeeds').value.trim(),
  };
  try {
    const response = await fetch('/api/ai/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The Health Coach could not respond right now.');
    showHealthOutput(data.answer);
    showSavedMovementPlan(data.movementPlan);
  } catch (error) {
    showHealthOutput(error.message || 'The Health Coach could not respond right now.', true);
  } finally {
    healthSubmit.disabled = false;
  }
});

openExercisePlan.addEventListener('click', () => {
  window.location.href = 'steptracker.html?from=health';
});

(async function init() {
  const user = await requireAuth();
  if (!user) return;
  if (user.role !== 'student') {
    alert('Health Coach is available to student accounts.');
    window.location.href = 'dashboard.html';
    return;
  }
  await loadSavedMovementPlan();
})();
