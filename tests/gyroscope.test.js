import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGyroFocusState,
  gyroFocusIntent,
} from '../interaction/gyroscope.js';

test('gyro integration moves focus once after a deliberate yaw gesture', () => {
  let state = createGyroFocusState();
  let result = gyroFocusIntent(state, 2, 1, 1000);
  state = result.state;
  assert.equal(result.step, 0);

  result = gyroFocusIntent(state, 2, 1, 1040);
  state = result.state;
  assert.equal(result.step, 0);

  result = gyroFocusIntent(state, 2, 1, 1080);
  state = result.state;
  assert.equal(result.step, 1);

  result = gyroFocusIntent(state, 2, 1, 1120);
  assert.equal(result.step, 0);
});

test('gyro focus supports reverse turns and rejects dead-zone noise', () => {
  let state = { accumulator: 0, lastAt: 2000, cooldownUntil: 0 };
  state = gyroFocusIntent(state, 0.04, 1, 2040).state;
  state = gyroFocusIntent(state, 0.04, 1, 2080).state;
  assert.equal(state.accumulator, 0);

  state = { accumulator: 0, lastAt: 3000, cooldownUntil: 0 };
  state = gyroFocusIntent(state, 2, -1, 3040).state;
  const result = gyroFocusIntent(state, 2, -1, 3080);
  assert.equal(result.step, -1);
  assert.ok(result.state.cooldownUntil > 3080);
});
