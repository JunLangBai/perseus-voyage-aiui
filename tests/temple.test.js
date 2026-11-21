import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOUBLE_TAP_WINDOW_MS,
  clearPendingTap,
  findDefaultFocusIndex,
  moveFocusIndex,
  registerTapSignal,
  templeGesture,
  templeIntent,
} from '../interaction/temple.js';

function inputState() {
  return {
    lastTapSignalAt: 0,
    pendingTapAt: 0,
    tapDownAt: 0,
    lastBackSignalAt: 0,
    lastDirectionGesture: '',
    lastDirectionAt: 0,
  };
}

test('temple input aliases map the real gestures to product actions', () => {
  assert.equal(templeGesture('GlobalHook'), 'tap');
  assert.equal(templeGesture('Enter'), 'tap');
  assert.equal(templeGesture({ code: 'SwipeUp' }), 'previous');
  assert.equal(templeGesture({ code: 'ArrowDown' }), 'next');
  assert.equal(templeGesture({ code: 'DoubleTap' }), 'back');
  assert.equal(templeGesture({ code: 'Backspace' }), 'back');
});

test('one click is a single tap and a repeated click within the window is back', () => {
  const state = inputState();
  assert.deepEqual(
    templeIntent('GlobalHook', 'down', state, 1000),
    { type: 'tap', sequence: 'single' },
  );
  assert.deepEqual(
    templeIntent('GlobalHook', 'up', state, 1040),
    { type: 'consume' },
  );
  assert.deepEqual(
    templeIntent('GlobalHook', 'down', state, 1180),
    { type: 'tap', sequence: 'double' },
  );
  assert.equal(state.pendingTapAt, 0);
});

test('the official simulator GlobalHook and Enter pair counts as one click', () => {
  const state = inputState();
  assert.deepEqual(
    templeIntent('GlobalHook', 'down', state, 1000),
    { type: 'tap', sequence: 'single' },
  );
  assert.deepEqual(
    templeIntent('GlobalHook', 'up', state, 1001),
    { type: 'consume' },
  );
  assert.deepEqual(
    templeIntent('Enter', 'down', state, 1001),
    { type: 'consume' },
  );
  assert.deepEqual(
    templeIntent('Enter', 'up', state, 1002),
    { type: 'consume' },
  );
  assert.equal(state.pendingTapAt, 1000);
});

test('single tap expires after the double-click window', () => {
  const state = inputState();
  assert.equal(registerTapSignal(state, 1000), 'single');
  clearPendingTap(state);
  assert.equal(
    registerTapSignal(state, 1000 + DOUBLE_TAP_WINDOW_MS + 1),
    'single',
  );
});

test('swipe up and down move focus once and consume key-up', () => {
  const state = inputState();
  assert.deepEqual(
    templeIntent('ArrowUp', 'down', state, 1000),
    { type: 'previous' },
  );
  assert.deepEqual(
    templeIntent('ArrowUp', 'up', state, 1050),
    { type: 'consume' },
  );
  assert.deepEqual(
    templeIntent({ code: 'SwipeDown' }, 'up', state, 2000),
    { type: 'next' },
  );
  assert.deepEqual(
    templeIntent({ code: 'ArrowDown', repeat: true }, 'down', state, 2100),
    { type: 'consume' },
  );
});

test('double-tap aliases and Backspace return immediately with deduplication', () => {
  const state = inputState();
  assert.deepEqual(
    templeIntent('Backspace', 'down', state, 1000),
    { type: 'back' },
  );
  assert.deepEqual(
    templeIntent('Backspace', 'up', state, 1050),
    { type: 'consume' },
  );
  assert.deepEqual(
    templeIntent({ code: 'DoubleClick' }, 'up', state, 2000),
    { type: 'back' },
  );
});

test('focus movement wraps and recovers from an empty selection', () => {
  assert.equal(moveFocusIndex(0, 3, -1), 2);
  assert.equal(moveFocusIndex(2, 3, 1), 0);
  assert.equal(moveFocusIndex(-1, 3, 1), 1);
  assert.equal(moveFocusIndex(4, 3, -1), 2);
  assert.equal(moveFocusIndex(0, 0, 1), -1);
});

test('a screen can declare its default action', () => {
  const targets = [
    { id: 'back' },
    { id: 'confirm', default: true },
    { id: 'adjust' },
  ];
  assert.equal(findDefaultFocusIndex(targets), 1);
  assert.equal(findDefaultFocusIndex([]), -1);
});
