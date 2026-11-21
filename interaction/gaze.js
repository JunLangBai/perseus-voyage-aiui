export const GAZE_CONFIG = Object.freeze({
  frequency: 30,
  horizontalFieldOfViewDegrees: 30,
  verticalFieldOfViewDegrees: 20,
  smoothing: 0.32,
  hysteresis: 0.045,
  rapidPitchDegreesPerSecond: 35,
  focusFreezeMilliseconds: 220,
  spatialUpdateMilliseconds: 70,
});

export const GAZE_CENTER = Object.freeze({ x: 0.5, y: 0.5 });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteQuaternion(value) {
  if (!value || value.length < 4) return null;
  const quaternion = [
    Number(value[0]),
    Number(value[1]),
    Number(value[2]),
    Number(value[3]),
  ];
  if (!quaternion.every(Number.isFinite)) return null;
  const length = Math.hypot(...quaternion);
  if (length < 1e-9) return null;
  return quaternion.map((component) => component / length);
}

function multiplyQuaternion(left, right) {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;
  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ];
}

function rotateVector(quaternion, vector) {
  const [qx, qy, qz, qw] = quaternion;
  const [vx, vy, vz] = vector;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ];
}

export function relativeGazeAngles(referenceQuaternion, currentQuaternion) {
  const reference = finiteQuaternion(referenceQuaternion);
  let current = finiteQuaternion(currentQuaternion);
  if (!reference || !current) return null;

  const conjugateReference = [
    -reference[0],
    -reference[1],
    -reference[2],
    reference[3],
  ];
  let relative = finiteQuaternion(multiplyQuaternion(conjugateReference, current));
  if (!relative) return null;
  if (relative[3] < 0) relative = relative.map((component) => -component);

  const forward = rotateVector(relative, [0, 0, -1]);
  return {
    yaw: Math.atan2(forward[0], -forward[2]),
    pitch: Math.asin(clamp(forward[1], -1, 1)),
  };
}

export function projectGazePoint(yaw, pitch, options = {}) {
  const horizontalFov = Number(options.horizontalFieldOfViewDegrees)
    || GAZE_CONFIG.horizontalFieldOfViewDegrees;
  const verticalFov = Number(options.verticalFieldOfViewDegrees)
    || GAZE_CONFIG.verticalFieldOfViewDegrees;
  const yawRadians = Number.isFinite(yaw) ? yaw : 0;
  const pitchRadians = Number.isFinite(pitch) ? pitch : 0;
  const halfYaw = (horizontalFov * Math.PI) / 360;
  const halfPitch = (verticalFov * Math.PI) / 360;

  return {
    x: clamp(0.5 + (yawRadians / halfYaw) * 0.5, 0.01, 0.99),
    y: clamp(0.5 - (pitchRadians / halfPitch) * 0.5, 0.01, 0.99),
  };
}

export function smoothGazeAngles(previous, next, alpha = GAZE_CONFIG.smoothing) {
  if (!next) return previous || null;
  if (!previous) return { yaw: next.yaw, pitch: next.pitch };
  const amount = clamp(Number(alpha) || GAZE_CONFIG.smoothing, 0.01, 1);
  return {
    yaw: previous.yaw + (next.yaw - previous.yaw) * amount,
    pitch: previous.pitch + (next.pitch - previous.pitch) * amount,
  };
}

export function isRapidPitchMotion(previous, next, elapsedMs, options = {}) {
  if (!previous || !next) return false;
  const elapsed = Math.max(1, Number(elapsedMs) || 1) / 1000;
  const pitchRate = Math.abs(next.pitch - previous.pitch) / elapsed;
  const yawRate = Math.abs(next.yaw - previous.yaw) / elapsed;
  const thresholdDegrees = Number(options.rapidPitchDegreesPerSecond)
    || GAZE_CONFIG.rapidPitchDegreesPerSecond;
  return pitchRate >= (thresholdDegrees * Math.PI) / 180 && pitchRate >= yawRate * 0.8;
}

function roundMotion(value, precision = 2) {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function spatialMotionFromAngles(yaw, pitch, options = {}) {
  const horizontalFov = Number(options.horizontalFieldOfViewDegrees)
    || GAZE_CONFIG.horizontalFieldOfViewDegrees;
  const verticalFov = Number(options.verticalFieldOfViewDegrees)
    || GAZE_CONFIG.verticalFieldOfViewDegrees;
  const normalizedX = clamp(
    (Number.isFinite(yaw) ? yaw : 0) / ((horizontalFov * Math.PI) / 360),
    -1,
    1,
  );
  const normalizedY = clamp(
    -(Number.isFinite(pitch) ? pitch : 0) / ((verticalFov * Math.PI) / 360),
    -1,
    1,
  );

  return {
    backX: roundMotion(-normalizedX * 6.5),
    backY: roundMotion(-normalizedY * 4.5),
    backRotate: roundMotion(-normalizedX * 1.1),
    viewX: roundMotion(normalizedX * 2.4),
    viewY: roundMotion(normalizedY * 1.7),
    viewRotate: roundMotion(-normalizedX * 0.55),
    viewScale: roundMotion(1 + Math.abs(normalizedY) * 0.004, 3),
    controlX: roundMotion(-normalizedX * 1.1),
  };
}

export function distanceToGazeTarget(target, point) {
  if (!target || !target.gaze || !point) return Number.POSITIVE_INFINITY;
  const dx = Number(target.gaze.x) - Number(point.x);
  const dy = Number(target.gaze.y) - Number(point.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return Number.POSITIVE_INFINITY;
  return Math.hypot(dx, dy);
}

export function findGazeTarget(
  targets,
  point,
  currentTargetId = '',
  hysteresis = GAZE_CONFIG.hysteresis,
) {
  if (!Array.isArray(targets) || targets.length === 0 || !point) return null;

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let current = null;
  let currentDistance = Number.POSITIVE_INFINITY;

  targets.forEach((target) => {
    const distance = distanceToGazeTarget(target, point);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
    if (target.id === currentTargetId) {
      current = target;
      currentDistance = distance;
    }
  });

  if (!best) return null;
  const threshold = Math.max(0, Number(hysteresis) || 0);
  if (current && best.id !== current.id && bestDistance >= currentDistance - threshold) {
    return current;
  }
  return best;
}
