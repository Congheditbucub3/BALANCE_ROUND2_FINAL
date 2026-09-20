const GOAL = 10000;
const MIN_THRESHOLD = 1.2;
const MAX_THRESHOLD = 15.0;
let steps = 0;
let isTracking = false;
let lastAcc = 0;
let lastStepTime = 0;

// Client-side cadence check (kept from the original prototype — catches
// obviously-spoofed motion events fast, in the UI, before we even bother
// the server). The server re-checks every batch independently in
// lib/anticheat.js, so a modified/bypassed client can't just fake a total.
let stepTimestamps = [];

// --- server sync state ---
let stepsSinceSync = 0;
let lastSyncTime = Date.now();
const SYNC_EVERY_N_STEPS = 5;
const SYNC_INTERVAL_MS = 4000;

const stepCountEl = document.getElementById('stepCount');
const startBtn = document.getElementById('startBtn');
const statusMsg = document.getElementById('statusMsg');
const creditMsg = document.getElementById('creditMsg');
const pendingMsg = document.getElementById('pendingMsg');
const progressRing = document.getElementById('progressRing');
const exerciseTypeSelect = document.getElementById('exerciseType');
const startExerciseCameraBtn = document.getElementById('startExerciseCamera');
const stopExerciseCameraBtn = document.getElementById('stopExerciseCamera');
const exerciseCountEl = document.getElementById('exerciseCount');
const exerciseCountLabel = document.getElementById('exerciseCountLabel');
const exerciseStatus = document.getElementById('exerciseStatus');
const exercisePill = document.getElementById('exercisePill');
const exerciseVideo = document.getElementById('exerciseVideo');
const exerciseVideoWrap = document.getElementById('exerciseVideoWrap');

async function renderOptionalMovementPlan() {
    const planEl = document.getElementById('optionalMovementPlan');
    if (!planEl) return;
    try {
        const response = await fetch('/api/health/movement-plan');
        if (!response.ok) return;
        const data = await response.json();
        const plan = data.movementPlan;
        const squat = Number(plan?.squatRecommendation);
        const pushup = Number(plan?.pushupRecommendation);
        const note = String(plan?.safeMovementNote || '').trim();
        if (!Number.isInteger(squat) || !Number.isInteger(pushup) || squat < 1 || pushup < 1 || !note) return;
        planEl.textContent = `Optional plan from Health: ${squat} squats and ${pushup} push-ups at a comfortable pace. ${note} This is guidance only; the credit missions stay 40 squats and 20 push-ups.`;
        planEl.hidden = false;
    } catch (error) {
        // A temporary network problem must never leave an old client-side
        // health plan on screen. The server remains the only source of truth.
    }
}

const radius = progressRing.r.baseVal.value;
const circumference = radius * 2 * Math.PI;
const EXERCISE_REWARD_TARGETS = Object.freeze({ squat: 40, pushup: 20 });

const exerciseCamera = {
    stream: null,
    detector: null,
    frameId: null,
    enabled: false,
    processing: false,
    reps: 0,
    phase: 'ready',
    lastMessageAt: 0,
    rewardClaimInFlight: false,
    rewardClaimedDate: null,
    rewardClaimedTypes: new Set(),
    creditsRemaining: null,
    dailyCreditLimit: 100,
    bothMissionsStreak: 0,
};

function setExerciseStatus(message, state = 'off') {
    exerciseStatus.textContent = message;
    exercisePill.textContent = state;
    exercisePill.className = `pill ${state === 'ready' ? 'pill-lime' : state === 'tracking' ? 'pill-blue' : state === 'needs-body' ? 'pill-red' : 'pill-neutral'}`;
}

function renderExerciseMissions() {
    const selectedType = exerciseTypeSelect.value;
    const missionNote = document.getElementById('missionNote');
    const missionBlocked = Number.isFinite(exerciseCamera.creditsRemaining)
        && exerciseCamera.creditsRemaining < 5;
    document.querySelectorAll('[data-exercise-mission]').forEach((card) => {
        const type = card.dataset.exerciseMission;
        const target = EXERCISE_REWARD_TARGETS[type];
        const isSelected = type === selectedType;
        const isComplete = exerciseCamera.rewardClaimedTypes.has(type) && exerciseCamera.rewardClaimedDate === serverDay();
        const progress = document.querySelector(`[data-mission-progress="${type}"]`);
        card.classList.toggle('is-active', isSelected);
        card.classList.toggle('is-complete', isComplete);
        card.disabled = missionBlocked && !isComplete;
        if (!progress) return;
        if (isComplete) progress.textContent = 'Completed today';
        else if (isSelected) progress.textContent = `${Math.min(exerciseCamera.reps, target)} / ${target} reps`;
        else progress.textContent = `Target: ${target}`;
    });
    if (missionNote) {
        if (missionBlocked) {
            missionNote.textContent = `Daily credit limit reached or fewer than 5 credits remain. Missions reset tomorrow.`;
        } else if (exerciseCamera.bothMissionsStreak > 0) {
            const dayLabel = exerciseCamera.bothMissionsStreak === 1 ? 'day' : 'days';
            missionNote.textContent = `${exerciseCamera.bothMissionsStreak}-day complete-both streak. Finish both missions for 10 credits today.`;
        } else {
            missionNote.textContent = 'Complete both missions to earn 10 credits today.';
        }
    }
}

function resetExerciseCounter() {
    exerciseCamera.reps = 0;
    exerciseCamera.phase = 'ready';
    exerciseCountEl.textContent = '0';
    const label = exerciseTypeSelect.value === 'pushup' ? 'push-ups completed' : 'squats completed';
    exerciseCountLabel.textContent = label;
    renderExerciseMissions();
    if (exerciseCamera.enabled) setExerciseStatus(`Ready to count ${label}.`, 'ready');
}

function serverDay() {
    // Match the server's YYYY-MM-DD boundary, so keeping the page open past
    // midnight does not suppress the next day's available reward.
    return new Date().toISOString().slice(0, 10);
}

function hasClaimedExerciseRewardToday(exerciseType) {
    const today = serverDay();
    if (exerciseCamera.rewardClaimedDate && exerciseCamera.rewardClaimedDate !== today) {
        exerciseCamera.rewardClaimedDate = null;
        exerciseCamera.rewardClaimedTypes.clear();
    }
    return exerciseCamera.rewardClaimedDate === today && exerciseCamera.rewardClaimedTypes.has(exerciseType);
}

async function recordExerciseActivity(exerciseType) {
    try {
        // This is an activity log only. Credits continue to be awarded only
        // by the separate, target-checked reward endpoint.
        await fetch('/api/exercise/activity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exercise_type: exerciseType, reps_delta: 1 }),
        });
    } catch (error) {
        // A failed activity update must not interrupt camera counting or a
        // later reward claim. The dashboard will simply omit that rep if the
        // browser was offline at the moment it was counted.
    }
}

async function claimExerciseReward(exerciseType, reps) {
    const target = EXERCISE_REWARD_TARGETS[exerciseType];
    if (!target || reps < target || exerciseCamera.rewardClaimInFlight || hasClaimedExerciseRewardToday(exerciseType)) return;

    exerciseCamera.rewardClaimInFlight = true;
    setExerciseStatus(`${target} ${exerciseType === 'pushup' ? 'push-ups' : 'squats'} reached — saving your 5-credit mission…`, 'tracking');
    try {
        const res = await fetch('/api/exercise/reward', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exercise_type: exerciseType, reps }),
        });
        const data = await res.json();
        if (!res.ok) {
            setExerciseStatus(data.error || 'Could not save the exercise reward. Complete one more rep to retry.', 'needs-body');
            return;
        }

        if (data.daily_cap_reached) {
            exerciseCamera.creditsRemaining = Number(data.credits_remaining) || 0;
            renderExerciseMissions();
            setExerciseStatus(data.reason || 'Your daily credit limit has been reached. Missions reset tomorrow.', 'needs-body');
            return;
        }

        if (data.credits_granted === 5) {
            exerciseCamera.rewardClaimedDate = serverDay();
            exerciseCamera.rewardClaimedTypes.add(exerciseType);
            await loadExerciseMissionState();
            creditMsg.innerText = '+5 credits earned for your exercise mission!';
            setExerciseStatus(`Mission complete — +5 credits for ${exerciseType === 'pushup' ? 'push-ups' : 'squats'}!`, 'ready');
            return;
        }

        if (data.already_rewarded) {
            exerciseCamera.rewardClaimedDate = serverDay();
            exerciseCamera.rewardClaimedTypes.add(exerciseType);
            await loadExerciseMissionState();
            setExerciseStatus('Today\'s 5-credit exercise mission was already completed.', 'ready');
        }
    } catch (error) {
        // Do not mark the reward as claimed locally. A later counted rep can
        // retry safely, and the server's unique daily record prevents a
        // duplicate if the first request actually reached it.
        setExerciseStatus('Could not reach the server. Complete one more rep to retry your reward.', 'needs-body');
    } finally {
        exerciseCamera.rewardClaimInFlight = false;
    }
}

async function loadExerciseMissionState() {
    try {
        const res = await fetch('/api/exercise/missions');
        if (!res.ok) return;
        const data = await res.json();
        const completedTypes = (data.missions || [])
            .filter((mission) => mission.completed)
            .map((mission) => mission.exercise_type);
        exerciseCamera.rewardClaimedDate = data.log_date || serverDay();
        exerciseCamera.rewardClaimedTypes = new Set(completedTypes);
        exerciseCamera.creditsRemaining = Number(data.credits_remaining);
        exerciseCamera.dailyCreditLimit = Number(data.daily_credit_limit) || 100;
        exerciseCamera.bothMissionsStreak = Number(data.both_missions_streak) || 0;
    } catch (error) {
        // The live counter still works if the status request is temporarily
        // offline; a successful reward call will update the cards directly.
    } finally {
        renderExerciseMissions();
    }
}

function landmarkVisibility(point) {
    return Number.isFinite(point?.visibility) ? point.visibility : 1;
}

function chooseVisibleAngle(landmarks, leftIndices, rightIndices) {
    const left = leftIndices.map((index) => landmarks[index]);
    const right = rightIndices.map((index) => landmarks[index]);
    const leftVisibility = left.reduce((sum, point) => sum + landmarkVisibility(point), 0);
    const rightVisibility = right.reduce((sum, point) => sum + landmarkVisibility(point), 0);
    const selected = leftVisibility >= rightVisibility ? left : right;
    if (selected.some((point) => !point) || selected.some((point) => landmarkVisibility(point) < 0.45)) return null;
    return window.BalanceVision.angleBetween(selected[0], selected[1], selected[2]);
}

function assessExercisePose(landmarks) {
    const type = exerciseTypeSelect.value;
    const angle = type === 'squat'
        ? chooseVisibleAngle(landmarks, [23, 25, 27], [24, 26, 28]) // hip, knee, ankle
        : chooseVisibleAngle(landmarks, [11, 13, 15], [12, 14, 16]); // shoulder, elbow, wrist
    if (angle === null) {
        setExerciseStatus('We cannot see the full movement clearly. Step back and improve the lighting.', 'needs-body');
        return;
    }

    const downAngle = type === 'squat' ? 110 : 100;
    const upAngle = type === 'squat' ? 160 : 155;
    if (exerciseCamera.phase === 'ready' && angle <= downAngle) {
        exerciseCamera.phase = 'down';
        setExerciseStatus('Great depth — return to the start position to count it.', 'tracking');
    } else if (exerciseCamera.phase === 'down' && angle >= upAngle) {
        exerciseCamera.reps += 1;
        exerciseCamera.phase = 'ready';
        exerciseCountEl.textContent = String(exerciseCamera.reps);
        renderExerciseMissions();
        setExerciseStatus(`Nice! ${exerciseCamera.reps} ${type === 'pushup' ? 'push-up' : 'squat'}${exerciseCamera.reps === 1 ? '' : 's'} counted.`, 'ready');
        void recordExerciseActivity(type);
        void claimExerciseReward(type, exerciseCamera.reps);
    } else if (Date.now() - exerciseCamera.lastMessageAt > 1200) {
        setExerciseStatus(exerciseCamera.phase === 'down' ? 'Finish the movement to count the repetition.' : 'Lower with control to begin a repetition.', 'tracking');
        exerciseCamera.lastMessageAt = Date.now();
    }
}

function trackExercisePose() {
    if (!exerciseCamera.enabled) return;
    if (exerciseVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !exerciseCamera.processing) {
        exerciseCamera.processing = true;
        try {
            const result = exerciseCamera.detector.detectForVideo(exerciseVideo, performance.now());
            const landmarks = result.landmarks && result.landmarks[0];
            if (landmarks) assessExercisePose(landmarks);
            else setExerciseStatus('Step into the camera so we can see your full body.', 'needs-body');
        } catch (error) {
            setExerciseStatus('We could not read the camera. Try turning it off and on again.', 'needs-body');
        } finally {
            exerciseCamera.processing = false;
        }
    }
    exerciseCamera.frameId = requestAnimationFrame(trackExercisePose);
}

async function startExerciseCamera() {
    if (exerciseCamera.enabled) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.BalanceVision) {
        setExerciseStatus('Camera movement tracking is not supported in this browser.', 'off');
        return;
    }
    await loadExerciseMissionState();
    if (Number.isFinite(exerciseCamera.creditsRemaining) && exerciseCamera.creditsRemaining < 5) {
        setExerciseStatus('Your daily credit limit has been reached. Exercise missions reset tomorrow.', 'off');
        return;
    }
    startExerciseCameraBtn.disabled = true;
    setExerciseStatus('Requesting camera access…', 'tracking');
    try {
        exerciseCamera.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        exerciseVideo.srcObject = exerciseCamera.stream;
        await exerciseVideo.play();
        exerciseCamera.detector = await window.BalanceVision.createPoseLandmarker();
        exerciseCamera.enabled = true;
        exerciseVideoWrap.hidden = false;
        startExerciseCameraBtn.hidden = true;
        stopExerciseCameraBtn.hidden = false;
        resetExerciseCounter();
        trackExercisePose();
    } catch (error) {
        window.BalanceVision?.stopStream(exerciseCamera.stream);
        exerciseCamera.stream = null;
        startExerciseCameraBtn.disabled = false;
        setExerciseStatus('Camera was not enabled. Check permission and try again.', 'off');
    }
}

function stopExerciseCamera() {
    exerciseCamera.enabled = false;
    if (exerciseCamera.frameId) cancelAnimationFrame(exerciseCamera.frameId);
    exerciseCamera.frameId = null;
    exerciseCamera.detector?.close?.();
    exerciseCamera.detector = null;
    window.BalanceVision?.stopStream(exerciseCamera.stream);
    exerciseCamera.stream = null;
    exerciseVideo.srcObject = null;
    exerciseVideoWrap.hidden = true;
    startExerciseCameraBtn.hidden = false;
    startExerciseCameraBtn.disabled = false;
    stopExerciseCameraBtn.hidden = true;
    setExerciseStatus('Camera is off.', 'off');
}

function updateProgress(currentSteps) {
    const percentage = Math.min(currentSteps / GOAL, 1);
    const offset = circumference - (percentage * circumference);
    progressRing.style.strokeDashoffset = offset;
}

async function syncToServer(force) {
    const now = Date.now();
    const elapsedMs = now - lastSyncTime;
    if (!force && stepsSinceSync < SYNC_EVERY_N_STEPS && elapsedMs < SYNC_INTERVAL_MS) return;
    if (stepsSinceSync === 0) return;

    const delta = stepsSinceSync;
    stepsSinceSync = 0;
    lastSyncTime = now;

    try {
        const res = await fetch('/api/steps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta, elapsedMs }),
        });
        const data = await res.json();
        if (!res.ok) {
            // server disagrees with the client's step reading — trust the server,
            // don't queue it for retry (retrying a rejected batch would just
            // fail again).
            statusMsg.innerText = data.reason ? `Sync rejected: ${data.reason}` : 'Sync rejected';
            return;
        }
        if (data.credits_granted > 0) {
            creditMsg.innerText = `+${data.credits_granted} credits earned today`;
        }
    } catch (err) {
        // Offline / server unreachable. Persist the batch to IndexedDB rather
        // than just holding it in memory — that way it survives a refresh or
        // a closed tab, and gets replayed by flushQueue() once connectivity
        // is back (see offline-queue.js).
        await enqueueStepBatch(delta, elapsedMs);
        await updatePendingIndicator();
    }
}

async function flushQueue() {
    const batches = await getPendingBatches();
    if (!batches.length) return;

    for (const batch of batches) {
        try {
            const res = await fetch('/api/steps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delta: batch.delta, elapsedMs: batch.elapsedMs }),
            });
            if (res.ok) {
                const data = await res.json();
                await removeBatch(batch.id);
                if (data.credits_granted > 0) {
                    creditMsg.innerText = `+${data.credits_granted} credits earned today (synced)`;
                }
            } else {
                // Server actively rejected this batch (e.g. anti-cheat) — no
                // point retrying it forever, so drop it rather than blocking
                // every batch queued after it.
                await removeBatch(batch.id);
            }
        } catch (err) {
            // Still offline — stop here, leave remaining batches queued for
            // the next flush attempt.
            break;
        }
    }
    await updatePendingIndicator();

    // The server is now the source of truth again — refresh today's total
    // in case it drifted while we were replaying queued batches.
    try {
        const res = await fetch('/api/steps/today');
        if (res.ok) {
            const data = await res.json();
            steps = data.step_count;
            stepCountEl.innerText = steps;
            updateProgress(steps);
        }
    } catch (err) { /* still offline, ignore */ }
}

async function updatePendingIndicator() {
    const n = await pendingCount();
    pendingMsg.innerText = n > 0 ? `${n} batch${n === 1 ? '' : 'es'} waiting to sync (offline)` : '';
}

function handleMotion(event) {
    if (!isTracking) return;

    const acc = event.accelerationIncludingGravity;
    if (!acc) return;

    const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
    const delta = Math.abs(magnitude - lastAcc);
    lastAcc = magnitude;

    const currentTime = Date.now();

    if (delta > MIN_THRESHOLD && delta < MAX_THRESHOLD && (currentTime - lastStepTime) > 300) {
        steps++;
        stepsSinceSync++;
        stepCountEl.innerText = steps;
        updateProgress(steps);
        lastStepTime = currentTime;

        stepTimestamps.push(currentTime);
        if (stepTimestamps.length > 19) {
            stepTimestamps.shift();
            const timeForLastSteps = currentTime - stepTimestamps[0];
            const currentSPM = (19 / timeForLastSteps) * 60000;
            if (currentSPM > 260) {
                triggerAntiCheat();
                return;
            }
        }
        syncToServer(false);
    }
}

function triggerAntiCheat() {
    isTracking = false;
    window.removeEventListener('devicemotion', handleMotion);

    startBtn.innerText = 'Start Walking';
    startBtn.classList.remove('is-tracking');

    statusMsg.innerText = 'TOUCH SOME GRASS';
    statusMsg.style.color = 'limegreen';
    statusMsg.style.fontWeight = 'bold';
    statusMsg.style.fontSize = '1.2rem';

    // Only the client-side display resets — steps already confirmed by the
    // server this session were already credited and stay credited.
    steps = 0;
    stepCountEl.innerText = steps;
    updateProgress(steps);
    stepTimestamps = [];
    stepsSinceSync = 0;
}

async function toggleTracking() {
    if (isTracking) {
        isTracking = false;
        startBtn.innerText = 'Resume Walking';
        startBtn.classList.remove('is-tracking');

        statusMsg.innerText = 'Tracking paused.';
        statusMsg.style.color = '';
        statusMsg.style.fontWeight = 'normal';
        statusMsg.style.fontSize = '';

        window.removeEventListener('devicemotion', handleMotion);
        await syncToServer(true);
        return;
    }

    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const permissionState = await DeviceMotionEvent.requestPermission();
            if (permissionState === 'granted') {
                start();
            } else {
                statusMsg.innerText = 'Sensor permission denied.';
            }
        } catch (error) {
            statusMsg.innerText = 'Error requesting permissions. Ensure connection is HTTPS.';
        }
    } else {
        start();
    }
}

function start() {
    isTracking = true;
    startBtn.innerText = 'Pause Tracker';
    startBtn.classList.add('is-tracking');

    statusMsg.innerText = 'Tracking... Keep phone unlocked in your pocket.';
    statusMsg.style.color = '#888';
    statusMsg.style.fontWeight = 'normal';
    statusMsg.style.fontSize = '0.9rem';

    stepTimestamps = [];
    lastSyncTime = Date.now();
    window.addEventListener('devicemotion', handleMotion);
}

startBtn.addEventListener('click', toggleTracking);
exerciseTypeSelect.addEventListener('change', resetExerciseCounter);
document.querySelectorAll('[data-exercise-mission]').forEach((mission) => {
    mission.addEventListener('click', () => {
        exerciseTypeSelect.value = mission.dataset.exerciseMission;
        resetExerciseCounter();
    });
});
startExerciseCameraBtn.addEventListener('click', startExerciseCamera);
stopExerciseCameraBtn.addEventListener('click', stopExerciseCamera);
window.addEventListener('pagehide', stopExerciseCamera);

// Desktop browsers have no accelerometer, so devicemotion never fires there.
// This button exists purely so the prototype is testable without a phone —
// it still goes through the exact same server-side sync + anti-cheat path.
document.getElementById('demoBtn').addEventListener('click', async () => {
    steps += 100;
    stepCountEl.innerText = steps;
    updateProgress(steps);
    // Simulated at a plausible ~2.5 steps/sec so it passes anti-cheat, rather
    // than reporting 100 steps in ~0ms (which the real cadence check — the
    // same one guarding real submissions — would correctly reject).
    // Goes through the same fetch-or-queue path as real motion events, so
    // toggling devtools' "Offline" mode and clicking this button is the
    // easiest way to see the offline queue in action.
    try {
        const res = await fetch('/api/steps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: 100, elapsedMs: 40000 }),
        });
        const data = await res.json();
        if (res.ok && data.credits_granted > 0) creditMsg.innerText = `+${data.credits_granted} credits earned today`;
    } catch (err) {
        await enqueueStepBatch(100, 40000);
        await updatePendingIndicator();
    }
});

// Periodic sync fallback even if step cadence is slow, and periodic retry
// of anything still queued from a previous offline stretch.
setInterval(() => { if (isTracking) syncToServer(false); }, SYNC_INTERVAL_MS);
setInterval(() => { flushQueue(); }, SYNC_INTERVAL_MS);

// The browser tells us the moment connectivity comes back — no need to wait
// for the next poll.
window.addEventListener('online', () => { flushQueue(); });

// Load today's progress on page open (auth guard lives in app.js)
(async function init() {
    const user = await requireAuth();
    if (!user || user.role !== 'student') {
        if (user) { alert('Step tracking is for student accounts.'); window.location.href = 'dashboard.html'; }
        return;
    }
    // Replay anything queued from before this page load (e.g. the tab was
    // closed mid-walk while offline) before trusting the server's total.
    await flushQueue();
    try {
        const res = await fetch('/api/steps/today');
        if (res.ok) {
            const data = await res.json();
            steps = data.step_count;
            stepCountEl.innerText = steps;
            updateProgress(steps);
        }
    } catch (err) { /* still offline — show queued indicator, try again on next flush */ }
    await updatePendingIndicator();
    await loadExerciseMissionState();
    await renderOptionalMovementPlan();
})();
