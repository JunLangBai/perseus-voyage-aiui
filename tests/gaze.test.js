import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findGazeTarget,
  isRapidPitchMotion,
  projectGazePoint,
  relativeGazeAngles,
  smoothGazeAngles,
  spatialMotionFromAngles,
} from '../interaction/gaze.js';

const radians = (degrees) => (degrees * Math.PI) / 180;
const degrees = (value) => (value * 180) / Math.PI;

function axisAngleQuaternion(axis, angle) {
  const halfAngle = angle / 2;
  const length = Math.hypot(...axis);
  const scale = Math.sin(halfAngle) / length;
  return [
    axis[0] * scale,
    axis[1] * scale,
    axis[2] * scale,
    Math.cos(halfAngle),
  ];
}

test('relative head pose maps horizontal and vertical motion into screen space', () => {
  const horizontal = relativeGazeAngles(
    [0, 0, 0, 1],
    axisAngleQuaternion([0, 1, 0], radians(10)),
  );
  const vertical = relativeGazeAngles(
    [0, 0, 0, 1],
    axisAngleQuaternion([1, 0, 0], radians(8)),
  );

  assert.ok(Math.abs(degrees(horizontal.yaw) + 10) < 0.001);
  assert.ok(Math.abs(degrees(vertical.pitch) - 8) < 0.001);

  const left = projectGazePoint(horizontal.yaw, horizontal.pitch);
  const up = projectGazePoint(vertical.yaw, vertical.pitch);
  assert.ok(left.x < 0.5);
  assert.ok(up.y < 0.5);
});

test('gaze angles ignore quaternion sign flips and reject malformed samples', () => {
  const current = axisAngleQuaternion([0, 0, 1], radians(6));
  const flipped = current.map((component) => -component);
  const normal = relativeGazeAngles([0, 0, 0, 1], current);
  const opposite = relativeGazeAngles([0, 0, 0, 1], flipped);

  assert.ok(Math.abs(normal.yaw - opposite.yaw) < 0.001);
  assert.ok(Math.abs(normal.pitch - opposite.pitch) < 0.001);
  assert.equal(relativeGazeAngles([0, 0, 0, 0], current), null);
  assert.equal(relativeGazeAngles([0, 0, 0, 1], [1, NaN, 0, 1]), null);
});

test('gaze projection clamps outside the supported field of view', () => {
  assert.deepEqual(projectGazePoint(0, 0), { x: 0.5, y: 0.5 });
  assert.equal(projectGazePoint(radians(90), 0).x, 0.99);
  assert.equal(projectGazePoint(-radians(90), 0).x, 0.01);
  assert.equal(projectGazePoint(0, radians(90)).y, 0.01);
  assert.equal(projectGazePoint(0, -radians(90)).y, 0.99);
});

test('gaze focus changes predictably and keeps the current target inside hysteresis', () => {
  const targets = [
    { id: 'left', gaze: { x: 0.45, y: 0.5 } },
    { id: 'right', gaze: { x: 0.55, y: 0.5 } },
  ];

  assert.equal(findGazeTarget(targets, { x: 0.505, y: 0.5 }, 'left').id, 'left');
  assert.equal(findGazeTarget(targets, { x: 0.58, y: 0.5 }, 'left').id, 'right');
  assert.equal(findGazeTarget(targets, { x: 0.2, y: 0.2 }, 'right').id, 'left');
  assert.equal(findGazeTarget([], { x: 0.5, y: 0.5 }, ''), null);
});

test('gaze smoothing reduces a single-frame jump', () => {
  const smoothed = smoothGazeAngles(
    { yaw: 0, pitch: 0 },
    { yaw: 0.2, pitch: -0.1 },
    0.25,
  );
  assert.ok(smoothed.yaw > 0 && smoothed.yaw < 0.2);
  assert.ok(smoothed.pitch < 0 && smoothed.pitch > -0.1);
});

test('rapid pitch motion is recognized as a nod guard without blocking settled gaze', () => {
  assert.equal(isRapidPitchMotion(
    { yaw: 0, pitch: 0 },
    { yaw: 0, pitch: radians(4) },
    16,
  ), true);
  assert.equal(isRapidPitchMotion(
    { yaw: 0, pitch: 0 },
    { yaw: 0, pitch: radians(0.5) },
    100,
  ), false);
});

test('orientation drives restrained opposite-depth parallax motion', () => {
  const center = spatialMotionFromAngles(0, 0);
  assert.equal(center.backX, 0);
  assert.equal(center.viewX, 0);
  assert.equal(center.viewScale, 1);

  const right = spatialMotionFromAngles(radians(10), 0);
  assert.ok(right.backX < 0);
  assert.ok(right.viewX > 0);
  assert.ok(right.controlX < 0);
  assert.ok(Math.abs(right.viewX) <= 2.4);

  const down = spatialMotionFromAngles(0, -radians(7));
  assert.ok(down.backY < 0);
  assert.ok(down.viewY > 0);
  assert.ok(down.viewScale > 1);
});
