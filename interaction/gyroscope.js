export const GYRO_CONFIG = Object.freeze({
  frequency: 60,
  deadZone: 0.12,
  minimumYawRate: 0.12,
  triggerAngle: 0.09,
  cooldownMilliseconds: 320,
  maximumStepMilliseconds: 80,
});

export function createGyroFocusState() {
  return {
    accumulator: 0,
    lastAt: 0,
    cooldownUntil: 0,
  };
}

export function gyroFocusIntent(
  previousState,
  angularActivity,
  yawRate,
  now = Date.now(),
  options = {},
) {
  const previous = previousState || createGyroFocusState();
  const currentTime = Number(now) || Date.now();
  const activity = Number(angularActivity);
  const turnRate = Number(yawRate);
  const deadZone = Number(options.deadZone) || GYRO_CONFIG.deadZone;
  const triggerAngle = Number(options.triggerAngle) || GYRO_CONFIG.triggerAngle;
  const cooldown = Number(options.cooldownMilliseconds)
    || GYRO_CONFIG.cooldownMilliseconds;
  const maxStep = Number(options.maximumStepMilliseconds)
    || GYRO_CONFIG.maximumStepMilliseconds;
  const lastAt = Number(previous.lastAt) || currentTime;
  const elapsed = Math.max(0, Math.min(maxStep, currentTime - lastAt));
  const next = {
    accumulator: Number(previous.accumulator) || 0,
    lastAt: currentTime,
    cooldownUntil: Number(previous.cooldownUntil) || 0,
  };

  if (
    !Number.isFinite(activity)
    || !Number.isFinite(turnRate)
    || elapsed <= 0
    || currentTime < next.cooldownUntil
  ) {
    return { step: 0, state: next };
  }

  if (
    Math.abs(activity) < deadZone
    || Math.abs(turnRate) < (Number(options.minimumYawRate)
      || GYRO_CONFIG.minimumYawRate)
  ) {
    next.accumulator *= 0.55;
    if (Math.abs(next.accumulator) < 0.01) next.accumulator = 0;
    return { step: 0, state: next };
  }

  const direction = turnRate > 0 ? 1 : -1;
  next.accumulator += direction * Math.abs(activity) * (elapsed / 1000);
  if (Math.abs(next.accumulator) < triggerAngle) {
    return { step: 0, state: next };
  }

  const step = next.accumulator > 0 ? 1 : -1;
  next.accumulator = 0;
  next.cooldownUntil = currentTime + cooldown;
  return { step, state: next };
}
