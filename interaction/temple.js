export const DOUBLE_TAP_WINDOW_MS = 360;
export const TAP_DOWN_PAIR_MS = 800;
export const BACK_SIGNAL_COALESCE_MS = 260;
export const DIRECTION_SIGNAL_COALESCE_MS = 220;
export const TAP_ALIAS_COALESCE_MS = 80;

function collectInputText(eventOrCode) {
  if (typeof eventOrCode === 'string') return eventOrCode;
  if (!eventOrCode || typeof eventOrCode !== 'object') return '';

  const detail = eventOrCode.detail && typeof eventOrCode.detail === 'object'
    ? eventOrCode.detail
    : {};
  return [
    eventOrCode.code,
    eventOrCode.key,
    eventOrCode.action,
    eventOrCode.gesture,
    eventOrCode.direction,
    eventOrCode.type,
    detail.code,
    detail.key,
    detail.action,
    detail.gesture,
    detail.direction,
    detail.type,
    detail.clickCount,
  ].filter((value) => value !== undefined && value !== null).join(' ');
}

export function normalizeTempleInput(eventOrCode) {
  return collectInputText(eventOrCode)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function tapSignalKind(eventOrCode) {
  const text = normalizeTempleInput(eventOrCode);
  if (text.includes('globalhook')) return 'globalhook';
  if (text.includes('enter')) return 'enter';
  if (text.includes('space')) return 'space';
  if (text.includes('primaryclick')) return 'primaryclick';
  if (text.includes('tap')) return 'tap';
  if (text.includes('click')) return 'click';
  return '';
}

function isPairedTapAlias(previousKind, currentKind, elapsedMs) {
  if (!previousKind || !currentKind || elapsedMs > TAP_ALIAS_COALESCE_MS) {
    return false;
  }
  return (
    previousKind === 'globalhook'
    && ['enter', 'space', 'primaryclick'].includes(currentKind)
  ) || (
    currentKind === 'globalhook'
    && ['enter', 'space', 'primaryclick'].includes(previousKind)
  );
}

export function templeGesture(eventOrCode) {
  const text = normalizeTempleInput(eventOrCode);
  if (!text) return null;
  const clickCount = Number(
    eventOrCode && typeof eventOrCode === 'object'
      ? eventOrCode.clickCount
        || (eventOrCode.detail && eventOrCode.detail.clickCount)
      : 0,
  );
  if (clickCount >= 2) return 'back';

  if (
    text.includes('doubletap')
    || text.includes('doubleclick')
    || text.includes('dblclick')
    || text.includes('backspace')
    || text.includes('escape')
  ) {
    return 'back';
  }

  if (
    text.includes('swipeup')
    || text.includes('arrowup')
    || text.includes('scrollup')
    || text.includes('directionup')
  ) {
    return 'previous';
  }

  if (
    text.includes('swipedown')
    || text.includes('arrowdown')
    || text.includes('scrolldown')
    || text.includes('directiondown')
  ) {
    return 'next';
  }

  if (
    text.includes('globalhook')
    || text.includes('numpadenter')
    || text.includes('enter')
    || text.includes('space')
    || text.includes('primaryclick')
    || text.includes('tap')
    || text.includes('click')
  ) {
    return 'tap';
  }

  return null;
}

export function registerTapSignal(state = {}, now = Date.now(), eventOrCode = null) {
  const pendingTapAt = Number(state.pendingTapAt) || 0;
  const signalKind = tapSignalKind(eventOrCode);
  if (pendingTapAt && now - pendingTapAt <= DOUBLE_TAP_WINDOW_MS) {
    if (isPairedTapAlias(state.pendingTapKind, signalKind, now - pendingTapAt)) {
      return 'duplicate';
    }
    state.pendingTapAt = 0;
    state.pendingTapKind = '';
    return 'double';
  }

  state.pendingTapAt = now;
  state.pendingTapKind = signalKind;
  return 'single';
}

export function clearPendingTap(state = {}) {
  state.pendingTapAt = 0;
  state.pendingTapKind = '';
}

export function moveFocusIndex(index, length, delta) {
  if (length <= 0) return -1;
  const normalized = Number.isInteger(index) && index >= 0 && index < length ? index : 0;
  const direction = delta < 0 ? -1 : 1;
  return (normalized + direction + length) % length;
}

export function findFocusIndex(targets, targetId) {
  if (!Array.isArray(targets)) return -1;
  return targets.findIndex((target) => target && target.id === targetId);
}

export function findDefaultFocusIndex(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return -1;
  const preferred = targets.findIndex((target) => target && target.default === true);
  return preferred >= 0 ? preferred : 0;
}

export function templeIntent(eventOrCode, phase, state = {}, now = Date.now()) {
  const gesture = templeGesture(eventOrCode);
  if (!gesture) return null;
  if (
    phase === 'down'
    && eventOrCode
    && typeof eventOrCode === 'object'
    && eventOrCode.repeat
  ) {
    return { type: 'consume' };
  }

  if (gesture === 'previous' || gesture === 'next') {
    if (phase === 'up') {
      const lastAt = Number(state.lastDirectionAt) || 0;
      if (
        state.lastDirectionGesture === gesture
        && now - lastAt <= DIRECTION_SIGNAL_COALESCE_MS
      ) {
        state.lastDirectionGesture = '';
        state.lastDirectionAt = 0;
        return { type: 'consume' };
      }
    }

    state.lastDirectionGesture = gesture;
    state.lastDirectionAt = now;
    return { type: gesture };
  }

  if (gesture === 'back') {
    const lastAt = Number(state.lastBackSignalAt) || 0;
    if (now - lastAt < BACK_SIGNAL_COALESCE_MS) return { type: 'consume' };
    state.lastBackSignalAt = now;
    return { type: 'back' };
  }

  if (phase === 'down') {
    state.tapDownAt = now;
    const sequence = registerTapSignal(state, now, eventOrCode);
    if (sequence === 'duplicate') return { type: 'consume' };
    return sequence ? { type: 'tap', sequence } : null;
  }

  const tapDownAt = Number(state.tapDownAt) || 0;
  if (tapDownAt && now - tapDownAt <= TAP_DOWN_PAIR_MS) {
    state.tapDownAt = 0;
    return { type: 'consume' };
  }

  state.tapDownAt = 0;
  const sequence = registerTapSignal(state, now, eventOrCode);
  if (sequence === 'duplicate') return { type: 'consume' };
  return sequence ? { type: 'tap', sequence } : null;
}
