// Browser-only MediaPipe helpers. Webcam frames stay on the student's device;
// only the MediaPipe runtime/model files are downloaded when the feature is
// first enabled.
(function () {
  // Keep this pinned to an actual published package. Version 0.10.22 was
  // never published to the CDN, so loading it made the camera start and then
  // immediately stop when the Face/Pose AI runtime failed to import.
  const TASKS_VERSION = '0.10.21';
  const TASKS_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
  const WASM_ROOT = `${TASKS_BASE}/wasm`;
  const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
  const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

  let visionPromise;

  async function getVisionRuntime() {
    if (!visionPromise) {
      visionPromise = import(`${TASKS_BASE}/vision_bundle.mjs`)
        .then(async (tasks) => ({
          ...tasks,
          vision: await tasks.FilesetResolver.forVisionTasks(WASM_ROOT),
        }))
        .catch((error) => {
          // Do not permanently cache a failed network import. A student can
          // fix their connection and press Enable camera again without a
          // full page reload.
          visionPromise = null;
          throw error;
        });
    }
    return visionPromise;
  }

  async function createFaceLandmarker() {
    const { FaceLandmarker, vision } = await getVisionRuntime();
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
  }

  async function createPoseLandmarker() {
    const { PoseLandmarker, vision } = await getVisionRuntime();
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
  }

  function stopStream(stream) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }

  function angleBetween(first, middle, last) {
    if (!first || !middle || !last) return null;
    const firstVector = { x: first.x - middle.x, y: first.y - middle.y };
    const lastVector = { x: last.x - middle.x, y: last.y - middle.y };
    const firstLength = Math.hypot(firstVector.x, firstVector.y);
    const lastLength = Math.hypot(lastVector.x, lastVector.y);
    if (!firstLength || !lastLength) return null;
    const cosine = Math.max(-1, Math.min(1, (firstVector.x * lastVector.x + firstVector.y * lastVector.y) / (firstLength * lastLength)));
    return Math.acos(cosine) * (180 / Math.PI);
  }

  window.BalanceVision = { createFaceLandmarker, createPoseLandmarker, stopStream, angleBetween };
})();
