const start = document.getElementById('start');
const pause = document.getElementById('pause');
const reset = document.getElementById('reset');
const seconds = document.getElementById('seconds');
const minutes = document.getElementById('minutes');
const hours = document.getElementById('hours');
const creditMsg = document.getElementById('timerCreditMsg');
const enableFocusCameraBtn = document.getElementById('enableFocusCamera');
const disableFocusCameraBtn = document.getElementById('disableFocusCamera');
const focusCameraVideo = document.getElementById('focusCameraVideo');
const focusVideoWrap = document.getElementById('focusVideoWrap');
const focusCameraStatus = document.getElementById('focusCameraStatus');
const focusCameraPill = document.getElementById('focusCameraPill');

let timeLeft = 0;
let originalDurationSeconds = 0; // for reporting focusMinutes on completion
let interval = null;

// A short grace period avoids an alert for one missed camera frame, while
// still responding quickly when the student actually leaves the camera.
const ABSENCE_REMINDER_MS = 8_000;
const reminderAudio = new Audio('assets/locked-in-bro.mp3');
reminderAudio.preload = 'auto';
// Once it starts, continue the downloaded ElevenLabs reminder until the
// camera sees the student again. This is deliberately not a 90-second
// cooldown: an absent student should keep hearing the reminder.
reminderAudio.loop = true;
const focusCamera = {
  stream: null,
  detector: null,
  frameId: null,
  absenceStartedAt: null,
  reminderActive: false,
  lastReminderAttemptAt: 0,
  reminderRequestId: 0,
  enabled: false,
  processing: false,
  lastStatusUpdateAt: 0,
};

const enforceMax59 = (inputElement) => {
  if (parseInt(inputElement.value, 10) > 59) {
    inputElement.value = 59;
  }
};
minutes.addEventListener('input', () => enforceMax59(minutes));
seconds.addEventListener('input', () => enforceMax59(seconds));

const calculateTotalSeconds = () => {
  const h = parseInt(hours.value, 10) || 0;
  const m = parseInt(minutes.value, 10) || 0;
  const s = parseInt(seconds.value, 10) || 0;
  return h * 3600 + m * 60 + s;
};

const updateTimer = () => {
  const hoursLeft = Math.floor(timeLeft / 3600);
  const minutesLeft = Math.floor((timeLeft % 3600) / 60);
  const secondsLeft = timeLeft % 60;
  hours.value = hoursLeft.toString().padStart(2, '0');
  minutes.value = minutesLeft.toString().padStart(2, '0');
  seconds.value = secondsLeft.toString().padStart(2, '0');
};

async function reportCompletion() {
  const focusMinutes = Math.round(originalDurationSeconds / 60);
  try {
    const res = await fetch('/api/timer/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focusMinutes }),
    });
    const data = await res.json();
    if (data.credits_granted > 0) {
      creditMsg.textContent = `+${data.credits_granted} focus credits earned (${data.bonuses_used_today}/${data.bonuses_allowed} today)`;
    } else {
      creditMsg.textContent = data.reason || 'Session complete.';
    }
  } catch (err) {
    creditMsg.textContent = 'Session complete (offline — credit not synced).';
  }
}

const startTimer = () => {
  if (interval) return;

  if (timeLeft <= 0) {
    timeLeft = calculateTotalSeconds();
    originalDurationSeconds = timeLeft;
  }
  if (timeLeft <= 0) return;

  interval = setInterval(() => {
    timeLeft--;
    updateTimer();

    if (timeLeft <= 0) {
      clearInterval(interval);
      interval = null;
      alert('Time is up!');
      reportCompletion();
    }
  }, 1000);
};

const stopTimer = () => {
  clearInterval(interval);
  interval = null;
};

const resetTimer = () => {
  stopTimer();
  timeLeft = 0;
  originalDurationSeconds = 0;
  hours.value = '';
  minutes.value = '';
  seconds.value = '';
  creditMsg.textContent = '';
};

function setFocusCameraStatus(message, state = 'off') {
  focusCameraStatus.textContent = message;
  focusCameraPill.textContent = state;
  focusCameraPill.className = `pill ${state === 'present' ? 'pill-lime' : state === 'away' ? 'pill-red' : state === 'on' ? 'pill-blue' : 'pill-neutral'}`;
}

async function unlockReminderAudio() {
  // This silent play happens directly after the student's button click so a
  // later, useful reminder is allowed by browsers with strict audio policies.
  try {
    reminderAudio.muted = true;
    await reminderAudio.play();
    reminderAudio.pause();
    reminderAudio.currentTime = 0;
  } catch (error) {
    // We try again when an actual reminder is needed.
  } finally {
    reminderAudio.muted = false;
  }
}

function stopAbsenceReminder() {
  // Invalidate a pending audio.play() promise as well as pausing currently
  // audible audio. Without this, a slow play promise could resolve after a
  // face has returned and restart the reminder.
  if (focusCamera.reminderActive || !reminderAudio.paused || focusCamera.lastReminderAttemptAt) {
    focusCamera.reminderRequestId += 1;
  }
  focusCamera.reminderActive = false;
  focusCamera.lastReminderAttemptAt = 0;
  reminderAudio.pause();
  reminderAudio.currentTime = 0;
}

function playAbsenceReminder() {
  // Do not restart an audio file that is already looping. If a browser pauses
  // it in the background, allow a new attempt after a short backoff instead
  // of issuing a play() request on every camera frame.
  if (focusCamera.reminderActive && !reminderAudio.paused) return;

  const now = Date.now();
  if (now - focusCamera.lastReminderAttemptAt < 4_000) return;
  focusCamera.lastReminderAttemptAt = now;
  const requestId = ++focusCamera.reminderRequestId;
  reminderAudio.currentTime = 0;
  reminderAudio.play().then(() => {
    if (requestId !== focusCamera.reminderRequestId || !focusCamera.enabled || !focusCamera.absenceStartedAt) {
      reminderAudio.pause();
      reminderAudio.currentTime = 0;
      return;
    }
    focusCamera.reminderActive = true;
    if (focusCamera.enabled && focusCamera.absenceStartedAt) {
      setFocusCameraStatus('No person detected. The voice reminder is playing until you return.', 'away');
    }
  }).catch(() => {
    if (requestId !== focusCamera.reminderRequestId || !focusCamera.enabled || !focusCamera.absenceStartedAt) return;
    focusCamera.reminderActive = false;
    setFocusCameraStatus('We cannot play the reminder yet. Enable the camera again, then keep this tab open.', 'away');
  });
}

function updatePresence(isPresent) {
  const now = Date.now();
  if (isPresent) {
    focusCamera.absenceStartedAt = null;
    // Stop the looping reminder in the same camera frame that detects a face.
    stopAbsenceReminder();
    if (now - focusCamera.lastStatusUpdateAt > 1000) {
      setFocusCameraStatus(interval ? 'You are present — keep going.' : 'Camera is on. We can see you.', 'present');
      focusCamera.lastStatusUpdateAt = now;
    }
    return;
  }

  if (!focusCamera.absenceStartedAt) focusCamera.absenceStartedAt = now;
  const absentFor = now - focusCamera.absenceStartedAt;
  if (now - focusCamera.lastStatusUpdateAt > 1000) {
    const secondsAway = Math.floor(absentFor / 1000);
    const reminderMessage = absentFor >= ABSENCE_REMINDER_MS
      ? 'No person detected. The voice reminder is playing until you return.'
      : `No person detected (${secondsAway}s). The voice reminder starts after 8 seconds.`;
    setFocusCameraStatus(reminderMessage, 'away');
    focusCamera.lastStatusUpdateAt = now;
  }
  if (absentFor >= ABSENCE_REMINDER_MS) playAbsenceReminder();
}

function monitorFocusCamera() {
  if (!focusCamera.enabled) return;
  if (focusCameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !focusCamera.processing) {
    focusCamera.processing = true;
    try {
      const result = focusCamera.detector.detectForVideo(focusCameraVideo, performance.now());
      updatePresence(Boolean(result.faceLandmarks && result.faceLandmarks.length));
    } catch (error) {
      setFocusCameraStatus('We could not read the camera. Check lighting and try again.', 'away');
    } finally {
      focusCamera.processing = false;
    }
  }
  focusCamera.frameId = requestAnimationFrame(monitorFocusCamera);
}

async function enableFocusCamera() {
  if (focusCamera.enabled) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setFocusCameraStatus('Camera access is not supported in this browser.', 'off');
    return;
  }

  enableFocusCameraBtn.disabled = true;
  setFocusCameraStatus('Requesting camera access…', 'on');
  await unlockReminderAudio();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    focusCamera.stream = stream;
    focusCameraVideo.srcObject = stream;
    // Show the live preview before the AI model finishes downloading. This
    // first load can take a few seconds on a new browser or slower network.
    focusVideoWrap.hidden = false;
    setFocusCameraStatus('Camera is on. Loading camera AI…', 'on');
    await focusCameraVideo.play();
    focusCamera.detector = await window.BalanceVision.createFaceLandmarker();
    focusCamera.enabled = true;
    disableFocusCameraBtn.hidden = false;
    enableFocusCameraBtn.hidden = true;
    focusCamera.absenceStartedAt = null;
    stopAbsenceReminder();
    setFocusCameraStatus('Camera is on. Your video stays on this device.', 'on');
    monitorFocusCamera();
  } catch (error) {
    window.BalanceVision?.stopStream(focusCamera.stream);
    focusCamera.stream = null;
    focusCameraVideo.srcObject = null;
    focusVideoWrap.hidden = true;
    setFocusCameraStatus('Camera AI could not start. Check camera permission and internet, then try again.', 'off');
    enableFocusCameraBtn.disabled = false;
  }
}

function disableFocusCamera() {
  focusCamera.enabled = false;
  stopAbsenceReminder();
  if (focusCamera.frameId) cancelAnimationFrame(focusCamera.frameId);
  focusCamera.frameId = null;
  focusCamera.detector?.close?.();
  focusCamera.detector = null;
  window.BalanceVision?.stopStream(focusCamera.stream);
  focusCamera.stream = null;
  focusCameraVideo.srcObject = null;
  focusCamera.absenceStartedAt = null;
  focusVideoWrap.hidden = true;
  disableFocusCameraBtn.hidden = true;
  enableFocusCameraBtn.hidden = false;
  enableFocusCameraBtn.disabled = false;
  setFocusCameraStatus('Camera is off.', 'off');
}

start.addEventListener('click', startTimer);
pause.addEventListener('click', stopTimer);
reset.addEventListener('click', resetTimer);
enableFocusCameraBtn.addEventListener('click', enableFocusCamera);
disableFocusCameraBtn.addEventListener('click', disableFocusCamera);
window.addEventListener('pagehide', disableFocusCamera);

(async function init() {
  const user = await requireAuth();
  if (user && user.role !== 'student') {
    alert('The focus timer credit bonus is for student accounts.');
  }
})();
