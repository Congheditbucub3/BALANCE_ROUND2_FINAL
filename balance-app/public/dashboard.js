// dashboard.js — dashboard-only presentation. Data remains server-owned;
// this file only renders the student/teacher dashboard from existing APIs.

const DAILY_QUOTES = [
  '“How long are you going to wait before you demand the best for yourself?” — Epictetus',
  '“It is not that we have a short time to live, but that we waste a lot of it.” — Seneca',
  '“Knowing is not enough, we must apply. Willing is not enough, we must do.” — Bruce Lee',
  '“Without commitment, you’ll never start. But more importantly, without consistency, you’ll never finish.” — Denzel Washington (Actor)',
  '“I have nothing in common with lazy people who blame others for their lack of success. Great things come from hard work and perseverance. No excuses.” — Kobe Bryant',
];

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setCalendarAndQuote() {
  const today = new Date();
  const dayText = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(today);
  const fullDate = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  }).format(today);
  const quoteDay = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000);
  const quote = DAILY_QUOTES[((quoteDay % DAILY_QUOTES.length) + DAILY_QUOTES.length) % DAILY_QUOTES.length];

  document.getElementById('calendarEyebrow').textContent = `Calendar · ${fullDate}`;
  document.getElementById('calendarDate').textContent = dayText;
  document.getElementById('subGreeting').textContent = quote;
}

async function fetchJson(url, fallback) {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : fallback;
  } catch (error) {
    return fallback;
  }
}

function sevenDayHistory(progress, todaySteps) {
  const serverHistory = Array.isArray(progress?.stepHistory) ? progress.stepHistory : [];
  const historyByDate = new Map(
    serverHistory.map((entry) => [
      entry?.date || entry?.log_date,
      nonNegativeInteger(entry?.steps ?? entry?.step_count),
    ])
  );
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6 + index);
    const dateKey = localDateKey(date);
    return {
      date: dateKey,
      label: new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date),
      steps: index === 6 ? todaySteps : (historyByDate.get(dateKey) || 0),
    };
  });
}

function renderStepsChart(history) {
  const values = history.map((entry) => nonNegativeInteger(entry.steps));
  const left = 20;
  const right = 540;
  const top = 14;
  const bottom = 116;
  const width = right - left;
  const height = bottom - top;
  const maximum = Math.max(1000, ...values);
  const points = values.map((value, index) => {
    const x = left + (width * index) / Math.max(1, values.length - 1);
    const y = bottom - (value / maximum) * height;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  });
  const pointText = points.map((point) => `${point.x},${point.y}`).join(' ');
  const line = document.getElementById('stepsChartLine');
  const area = document.getElementById('stepsChartArea');
  const dots = document.getElementById('stepsChartDots');
  const labels = document.getElementById('stepsChartLabels');
  if (!line || !area || !dots || !labels) return;

  line.setAttribute('points', pointText);
  area.setAttribute('points', `${left},${bottom} ${pointText} ${right},${bottom}`);
  dots.replaceChildren();
  labels.replaceChildren();

  const svgNamespace = 'http://www.w3.org/2000/svg';
  points.forEach((point, index) => {
    const dot = document.createElementNS(svgNamespace, 'circle');
    dot.setAttribute('class', 'chart-dot');
    dot.setAttribute('cx', String(point.x));
    dot.setAttribute('cy', String(point.y));
    dot.setAttribute('r', index === points.length - 1 ? '4.8' : '3.2');
    dots.appendChild(dot);

    const label = document.createElementNS(svgNamespace, 'text');
    label.setAttribute('x', String(point.x));
    label.setAttribute('y', '143');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = history[index].label;
    labels.appendChild(label);
  });
}

function renderDailyActivityBar(progress) {
  const activity = progress?.activityToday || {};
  const steps = nonNegativeInteger(activity.steps);
  const squats = nonNegativeInteger(activity.squats);
  const pushups = nonNegativeInteger(activity.pushups);
  const calories = nonNegativeInteger(activity.estimatedCalories);
  const referenceCalories = Math.max(1, nonNegativeInteger(activity.referenceCalories) || 421);
  const progressPercent = Math.min(100, Math.round((calories / referenceCalories) * 100));
  const bar = document.getElementById('dailyActivityBar');
  if (!bar) return;

  bar.innerHTML = `
    <article class="daily-activity-bar" aria-label="Today's movement: approximately ${calories} estimated activity calories, ${steps} steps, ${squats} squats, and ${pushups} push-ups.">
      <div>
        <div class="activity-kicker">Today's movement</div>
        <div class="activity-calories">≈ ${calories.toLocaleString()} <span>kcal</span></div>
        <p class="activity-estimate">Activity estimate, not a medical measurement.</p>
      </div>
      <div>
        <div class="activity-progress-copy"><span>Daily movement scale</span><span>${progressPercent}%</span></div>
        <div class="progress-track activity-progress" aria-label="${progressPercent}% of the daily activity reference">
          <div class="progress-fill" style="width:${progressPercent}%"></div>
        </div>
      </div>
      <div class="activity-counts" aria-label="Today's activity counts">
        <span class="activity-count"><strong>${steps.toLocaleString()}</strong> steps</span>
        <span class="activity-count"><strong>${squats.toLocaleString()}</strong> squats</span>
        <span class="activity-count"><strong>${pushups.toLocaleString()}</strong> push-ups</span>
      </div>
    </article>
  `;
}

function renderStudentProgress(user, stepsData, progress) {
  const stepsToday = nonNegativeInteger(stepsData?.step_count);
  const goal = Math.max(1, nonNegativeInteger(stepsData?.goal) || 10000);
  const history = sevenDayHistory(progress, stepsToday);
  const yesterdaySteps = nonNegativeInteger(progress?.stepsYesterday ?? history[history.length - 2]?.steps);
  const wallet = nonNegativeInteger(user?.wallet?.balance);
  const dailyEarned = nonNegativeInteger(user?.wallet?.daily_earned_credits);
  const focusSessions = nonNegativeInteger(progress?.focusSessionsCompleted);
  const homeworkDone = nonNegativeInteger(progress?.homeworkCompleted);
  const progressPercent = Math.min(100, Math.round((stepsToday / goal) * 100));
  const container = document.getElementById('progressDashboard');

  renderDailyActivityBar(progress);

  container.innerHTML = `
    <article class="steps-overview" aria-labelledby="stepsTodayTitle">
      <div class="steps-topline">
        <span class="steps-label health" id="stepsTodayTitle">Steps today</span>
        <span class="steps-goal">Goal ${goal.toLocaleString()}</span>
      </div>
      <div class="steps-number" id="stepsTodayNumber">${stepsToday.toLocaleString()}</div>
      <div class="progress-track steps-goal-progress" aria-label="${progressPercent}% of your step goal complete">
        <div class="progress-fill" style="width:${progressPercent}%"></div>
      </div>
      <div class="steps-chart-wrap">
        <svg class="steps-chart" viewBox="0 0 560 150" role="img" aria-label="Steps taken across the last seven days">
          <defs>
            <linearGradient id="stepsChartFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="#23D821" stop-opacity="0.28"></stop>
              <stop offset="100%" stop-color="#23D821" stop-opacity="0"></stop>
            </linearGradient>
          </defs>
          <line class="chart-grid" x1="20" y1="32" x2="540" y2="32"></line>
          <line class="chart-grid" x1="20" y1="74" x2="540" y2="74"></line>
          <line class="chart-grid" x1="20" y1="116" x2="540" y2="116"></line>
          <polygon class="chart-area" id="stepsChartArea"></polygon>
          <polyline class="chart-line" id="stepsChartLine"></polyline>
          <g id="stepsChartDots"></g>
          <g id="stepsChartLabels"></g>
        </svg>
      </div>
      <div class="steps-footer">
        <span class="step-change" id="stepsChange"></span>
        <span class="step-comparison">Compared with yesterday</span>
      </div>
    </article>
    <div class="metrics-stack">
      <article class="metric-card" aria-label="Credit balance">
        <div class="metric-topline">
          <span class="metric-label credit">Credit balance</span>
          <span class="icon-badge credit"><img src="assets/icons/coin.png" alt=""></span>
        </div>
        <div class="metric-number credit">${wallet.toLocaleString()}</div>
        <div class="metric-sub">${dailyEarned} earned today</div>
      </article>
      <article class="metric-card" aria-label="Focus sessions completed all time">
        <div class="metric-topline">
          <span class="metric-label education">Focus sessions</span>
          <span class="icon-badge education"><img src="assets/icons/timer.png" alt=""></span>
        </div>
        <div class="metric-number education">${focusSessions.toLocaleString()}</div>
        <div class="metric-sub">All-time completed</div>
      </article>
      <article class="metric-card" aria-label="Homework completed all time">
        <div class="metric-topline">
          <span class="metric-label education">Homework done</span>
          <span class="icon-badge education"><img src="assets/icons/homework.png" alt=""></span>
        </div>
        <div class="metric-number education">${homeworkDone.toLocaleString()}</div>
        <div class="metric-sub">All-time completed</div>
      </article>
    </div>
  `;

  const changeEl = document.getElementById('stepsChange');
  if (yesterdaySteps === 0 && stepsToday === 0) {
    changeEl.textContent = '0% change';
    changeEl.className = 'step-change neutral';
  } else if (yesterdaySteps === 0) {
    changeEl.textContent = 'New progress today';
    changeEl.className = 'step-change';
  } else {
    const change = Math.round(((stepsToday - yesterdaySteps) / yesterdaySteps) * 100);
    changeEl.textContent = `${change > 0 ? '+' : ''}${change}% change`;
    changeEl.className = `step-change${change < 0 ? ' negative' : change === 0 ? ' neutral' : ''}`;
  }
  renderStepsChart(history);
}

function renderStudentCards() {
  document.getElementById('cardGrid').innerHTML = `
    <a class="nav-card" href="steptracker.html">
      <span class="icon-badge health"><img src="assets/icons/exercise.png" alt=""></span>
      <div class="nc-title">Multi-Exercise</div>
      <div class="nc-sub">Steps, squats &amp; push-ups</div>
    </a>
    <a class="nav-card" href="timer.html">
      <span class="icon-badge education"><img src="assets/icons/timer.png" alt=""></span>
      <div class="nc-title">Focus Timer</div>
      <div class="nc-sub">+5 credits / session, up to 3/day</div>
    </a>
    <a class="nav-card" href="homework.html">
      <span class="icon-badge education"><img src="assets/icons/homework.png" alt=""></span>
      <div class="nc-title">Homework Hub</div>
      <div class="nc-sub">Submit work &amp; earn credits</div>
    </a>
    <a class="nav-card" href="health.html">
      <span class="icon-badge health"><img src="assets/icons/heart.png" alt=""></span>
      <div class="nc-title">Health</div>
      <div class="nc-sub">Food, movement &amp; recovery guidance</div>
    </a>
  `;
}

function renderTeacherCards() {
  document.getElementById('cardGrid').innerHTML = `
    <a class="nav-card" href="homework.html">
      <span class="icon-badge education"><img src="assets/icons/homework.png" alt=""></span>
      <div class="nc-title">Homework Hub</div>
      <div class="nc-sub">Create &amp; grade assignments</div>
    </a>
    <a class="nav-card" href="#" id="viewInsights">
      <span class="icon-badge health"><img src="assets/icons/heart.png" alt=""></span>
      <div class="nc-title">Wellness Insights</div>
      <div class="nc-sub">Anonymized class trends</div>
    </a>
  `;

  document.getElementById('viewInsights').addEventListener('click', async (event) => {
    event.preventDefault();
    const data = await fetchJson('/api/teacher/wellness-summary', {
      totalStudents: 0, avgStepsToday: 0, pctMetStepGoalToday: 0,
    });
    const box = document.getElementById('teacherStats');
    box.innerHTML = `
      <h2 class="section-label">Class wellness (today)</h2>
      <div class="stat-grid">
        <div class="stat-tile"><div class="stat-number">${nonNegativeInteger(data.totalStudents)}</div><div class="stat-label">Students</div></div>
        <div class="stat-tile"><div class="stat-number">${nonNegativeInteger(data.avgStepsToday)}</div><div class="stat-label">Avg steps today</div></div>
        <div class="stat-tile"><div class="stat-number blue">${nonNegativeInteger(data.pctMetStepGoalToday)}%</div><div class="stat-label">Met step goal</div></div>
      </div>
    `;
    box.hidden = false;
  });
}

(async function initialiseDashboard() {
  const user = await requireAuth();
  if (!user) return;

  setCalendarAndQuote();
  if (user.role !== 'student') {
    renderTeacherCards();
    return;
  }

  renderStudentCards();
  const [stepsData, progress] = await Promise.all([
    fetchJson('/api/steps/today', { step_count: 0, goal: 10000 }),
    fetchJson('/api/stats/progress', null),
  ]);
  renderStudentProgress(user, stepsData, progress);
  document.getElementById('statsSection').hidden = false;
})();
