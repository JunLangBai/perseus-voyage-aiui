import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Game from '../game/engine.js';
import { DOUBLE_TAP_WINDOW_MS } from '../interaction/temple.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const pageDirectory = path.join(projectRoot, 'pages', 'index');
const ink = readFileSync(path.join(pageDirectory, 'index.ink'), 'utf8');
const setup = ink.match(/<script setup>\s*([\s\S]*?)\s*<\/script>/)?.[1];
assert.ok(setup, 'Page <script setup> must exist');

const temporaryModule = path.join(pageDirectory, `.focus-test-${process.pid}.mjs`);
writeFileSync(temporaryModule, setup, 'utf8');
const moduleUrl = `${pathToFileURL(temporaryModule).href}?test=${Date.now()}`;
const { default: pageDefinition } = await import(moduleUrl);

after(() => {
  rmSync(temporaryModule, { force: true });
});

function createPage(screen) {
  const page = {
    ...pageDefinition,
    data: structuredClone(pageDefinition.data),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    renderAll() {
      this.renderCount = (this.renderCount || 0) + 1;
    },
  };
  page.data.screen = screen;
  page._focusContextKey = '';
  page._focusIndex = -1;
  page._focusTargetId = '';
  page._templeInputState = {
    lastTapSignalAt: 0,
    pendingTapAt: 0,
    tapDownAt: 0,
    lastBackSignalAt: 0,
    lastDirectionGesture: '',
    lastDirectionAt: 0,
  };
  page._singleTapTimer = null;
  page._singleTapToken = 0;
  page._game = Game.createDefaultState();
  return page;
}

test('menu and opening screens expose deterministic focus targets', () => {
  const page = createPage('menu');
  assert.equal(page.resolveFocus().target.id, 'menu-continue');
  assert.ok(page.getFocusTargets().some((target) => target.id === 'menu-colony-upkeep'));
  assert.ok(page.getFocusTargets().some((target) => target.id === 'menu-exit'));

  page.data.screen = 'opening';
  assert.equal(page.resolveFocus().target.id, 'opening-tide-3');
  page.moveFocus(1);
  assert.equal(page._focusTargetId, 'opening-red-sand-9');
  page.moveFocus(-1);
  assert.equal(page._focusTargetId, 'opening-tide-3');
});

test('exit game saves immediately and closes without a confirmation step', () => {
  const page = createPage('menu');
  let saves = 0;
  let closes = 0;
  page.persist = () => {
    saves += 1;
    return true;
  };
  const previousWindow = globalThis.window;
  globalThis.window = {
    close() {
      closes += 1;
    },
  };

  try {
    page.requestExit();
  } finally {
    globalThis.window = previousWindow;
  }

  assert.equal(saves, 1);
  assert.equal(closes, 1);
});

test('menu setting disables colony upkeep and saves immediately', () => {
  const page = createPage('menu');
  let saves = 0;
  let toast = '';
  page.persist = () => {
    saves += 1;
    return true;
  };
  page.showToast = (message) => {
    toast = message;
  };

  page.toggleColonyUpkeep();
  assert.equal(page._game.settings.colonyUpkeepEnabled, false);
  assert.equal(saves, 1);
  assert.match(toast, /已关闭/);

  page.toggleColonyUpkeep();
  assert.equal(page._game.settings.colonyUpkeepEnabled, true);
  assert.equal(saves, 2);
});

test('page hide and unload flush the current save', () => {
  const page = createPage('overview');
  page._game = Game.startGame(page._game, 'tide-3', Date.now()).state;
  let saves = 0;
  page.persist = () => {
    saves += 1;
    return true;
  };
  page.stopClock = () => {};
  page.cancelPendingTempleTap = () => {};
  page.clearToastTimer = () => {};
  page.clearBattleTimer = () => {};

  page.onHide();
  page.onUnload();

  assert.equal(saves, 2);
});

test('page clock starts an independent sixty-second autosave timer', () => {
  const page = createPage('overview');
  page._game = Game.startGame(page._game, 'tide-3', Date.now()).state;
  const callbacks = [];
  let saves = 0;
  const previousSetInterval = globalThis.setInterval;
  const previousClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, delay) => {
    callbacks.push({ callback, delay });
    return callbacks.length;
  };
  globalThis.clearInterval = () => {};
  page.persist = () => {
    saves += 1;
    return true;
  };

  try {
    page.startClock();
    const autosave = callbacks.find((item) => item.delay === 60000);
    assert.ok(autosave);
    autosave.callback();
    assert.equal(saves, 1);
  } finally {
    globalThis.setInterval = previousSetInterval;
    globalThis.clearInterval = previousClearInterval;
  }
});

test('game screens focus the safest useful primary action', () => {
  const page = createPage('overview');
  const started = Game.startGame(page._game, 'red-sand-9', Date.now());
  page._game = started.state;
  assert.equal(page.resolveFocus().target.id, 'overview-mail');
  assert.ok(page.getFocusTargets().every((target) => target.id !== 'overview-claim'));
  assert.ok(page.getFocusTargets().some((target) => target.id === 'overview-map'));
  assert.ok(page.getFocusTargets().some((target) => target.id === 'overview-fleet'));
  assert.ok(page.getFocusTargets().every((target) => !target.id.startsWith('nav-')));

  page.data.screen = 'expedition';
  page.data.investment = 50;
  assert.equal(page.resolveFocus().target.id, 'expedition-plus');

  page.data.screen = 'colonize';
  page.data.colonizeCanStart = false;
  assert.equal(page.resolveFocus().target.id, 'colonize-back');

  page.data.screen = 'result';
  assert.equal(page.resolveFocus().target.id, 'result-finish');
});

test('every focusable screen target has a gaze position', () => {
  const page = createPage('menu');
  page._game = Game.startGame(page._game, 'tide-3', Date.now()).state;
  const mail = page._game.pendingEvents[0];
  const screens = [
    'menu',
    'opening',
    'overview',
    'map',
    'planet',
    'colonize',
    'fleet',
    'mail',
    'mail-detail',
    'trade',
    'expedition',
    'travel',
    'result',
  ];

  page.data.menuStarted = true;
  page.data.selectedPlanetId = 'tide-3';
  page.data.colonizeTarget = { id: 'red-sand-9', name: '赤沙-9' };
  page.data.colonizeCanStart = true;
  page.data.activeEvent = mail;
  page.data.expeditionTarget = { id: 'moon-mirror-port', name: '月镜港' };
  page.data.investment = 10;

  screens.forEach((screen) => {
    page.data.screen = screen;
    page._focusContextKey = '';
    page._focusTargetId = '';
    page.getFocusTargets().forEach((target) => {
      assert.ok(target.gaze, `${screen}:${target.id} must define a gaze point`);
      assert.ok(Number.isFinite(target.gaze.x));
      assert.ok(Number.isFinite(target.gaze.y));
    });
  });
});

test('3DoF uses orientation for view, gyro for focus, and stops both sensors', () => {
  class FakeOrientationSensor {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.started = 0;
      this.stopped = 0;
      this.quaternion = [0, 0, 0, 1];
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    removeEventListener(name, listener) {
      if (this.listeners.get(name) === listener) this.listeners.delete(name);
    }

    start() {
      this.started += 1;
    }

    stop() {
      this.stopped += 1;
    }

    emitReading(quaternion) {
      this.quaternion = quaternion;
      this.listeners.get('reading')?.();
    }
  }

  class FakeGyroscope {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.started = 0;
      this.stopped = 0;
      this.x = 0;
      this.y = 0;
      this.z = 0;
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    removeEventListener(name, listener) {
      if (this.listeners.get(name) === listener) this.listeners.delete(name);
    }

    start() {
      this.started += 1;
    }

    stop() {
      this.stopped += 1;
    }

    emitReading({ x = 0, y = 0, z = 0 } = {}) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.listeners.get('reading')?.();
    }
  }

  const page = createPage('menu');
  const previousOrientation = globalThis.AbsoluteOrientationSensor;
  const previousGyroscope = globalThis.Gyroscope;
  globalThis.AbsoluteOrientationSensor = FakeOrientationSensor;
  globalThis.Gyroscope = FakeGyroscope;

  try {
    assert.equal(page.startGazeFocus(), true);
    const orientation = page._gazeSensor;
    const gyroscope = page._gyroSensor;
    assert.equal(orientation.options.frequency, 30);
    assert.equal(gyroscope.options.frequency, 60);
    assert.equal(orientation.started, 1);
    assert.equal(gyroscope.started, 1);
    assert.equal(page.data.controlPrefix, '校准');

    orientation.emitReading([0, 0, 0, 1]);
    assert.equal(page.data.spatialMode, false);
    gyroscope.emitReading({ y: 0 });
    assert.equal(page.data.controlPrefix, '3DoF');
    assert.equal(page.data.spatialMode, true);
    assert.equal(page._focusTargetId, 'menu-continue');

    const pitchDown = -12 * Math.PI / 180;
    const downQuaternion = [
      Math.sin(pitchDown / 2),
      0,
      0,
      Math.cos(pitchDown / 2),
    ];
    orientation.emitReading(downQuaternion);
    assert.equal(page._focusTargetId, 'menu-continue');

    page._orientationYawRate = 1;
    for (let index = 0; index < 3; index += 1) {
      page._gyroFocusState.lastAt = Date.now() - 40;
      gyroscope.emitReading({ x: 2 });
    }
    assert.equal(page._focusTargetId, 'menu-colony-upkeep');

    page._gazeErrorShown = true;
    page.handleGyroError();
    assert.equal(orientation.stopped, 1);
    assert.equal(gyroscope.stopped, 1);
    assert.equal(page._gazeSensor, null);
    assert.equal(page._gyroSensor, null);
    assert.equal(orientation.listeners.size, 0);
    assert.equal(gyroscope.listeners.size, 0);
    assert.equal(page.data.spatialMode, false);
    assert.equal(page.data.controlPrefix, '镜腿');
  } finally {
    globalThis.AbsoluteOrientationSensor = previousOrientation;
    globalThis.Gyroscope = previousGyroscope;
  }
});

test('ready planet output is harvested without a manual claim action', () => {
  const page = createPage('overview');
  const now = Date.now();
  const started = Game.startGame(page._game, 'tide-3', now);
  page._game = started.state;
  const before = page._game.resources.energy;

  const harvested = page.autoHarvest(now);

  assert.equal(harvested.ok, true);
  assert.ok(page._game.resources.energy > before);
  assert.equal(page._game.lastClaimAt, now);
  assert.ok(page.getFocusTargets().every((target) => target.id !== 'overview-claim'));
});

test('mail options execute on the first activation without a confirm target', () => {
  const page = createPage('mail-detail');
  const started = Game.startGame(page._game, 'tide-3', Date.now());
  page._game = started.state;
  const mail = page._game.pendingEvents[0];
  page.data.activeEvent = mail;
  page.data.activeEventId = mail.id;
  page.data.selectedOptionIndex = 0;
  page.persist = () => true;

  assert.ok(page.getFocusTargets().every((target) => target.id !== 'mail-confirm'));
  page.selectMailOption(page.datasetEvent({ optionIndex: 0 }));

  assert.equal(page.data.screen, 'mail');
  assert.equal(page.data.activeEventId, '');
  assert.equal(page._game.pendingEvents.some((event) => event.id === mail.id), false);
});

test('mail detail starts on its first option and map provides a back action', () => {
  const page = createPage('mail');
  page._game = Game.startGame(page._game, 'tide-3', Date.now()).state;
  const mail = page._game.pendingEvents[0];

  page.openMailEvent(page.datasetEvent({ eventId: mail.id }));
  assert.equal(page.data.screen, 'mail-detail');
  assert.equal(page.resolveFocus().target.id, 'mail-option-0');

  page.data.screen = 'map';
  page.data.mapPage = 2;
  const mapFocus = page.resolveFocus();
  assert.equal(mapFocus.target.id, 'map-planet-moon-mirror-port');
  assert.ok(mapFocus.targets.some((target) => target.id === 'map-back'));
});

test('battle CG is non-skippable and result omits win chance and header count', () => {
  assert.match(ink, /class="battle-cg"/);
  assert.doesNotMatch(ink, /跳过 CG/);
  assert.doesNotMatch(ink, /战前胜率/);
  assert.doesNotMatch(ink, /\{\{resultData\.ownedCount\}\}\/10 行星/);
});

test('voice wakeup routes recognized text to the intended page action', () => {
  const page = createPage('battle');
  const calls = [];
  page.claimOutput = () => calls.push('claim');
  page.buildFleet = () => calls.push('build');
  page.goMail = () => calls.push('mail');
  page.goMap = () => calls.push('map');
  page.goFleet = () => calls.push('fleet');
  page.goBack = () => calls.push('back');
  page.prepareExpeditionForId = (planetId) => calls.push(`attack:${planetId}`);

  const wake = (text, detailText = '') => ({
    text,
    detail: detailText ? { text: detailText } : undefined,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  });

  [
    ['领取', 'claim'],
    ['建造', 'build'],
    ['邮件', 'mail'],
    ['打开地图', 'map'],
    ['舰队', 'fleet'],
    ['返回', 'back'],
    ['', 'attack:moon-mirror-port', '攻击月镜港'],
  ].forEach(([text, expected, detailText]) => {
    const event = wake(text, detailText);
    page.onVoiceWakeup(event);
    assert.equal(event.prevented, true);
    assert.equal(calls.at(-1), expected);
  });

  const unknown = wake('打开音乐');
  page.onVoiceWakeup(unknown);
  assert.equal(unknown.prevented, false);

  const skip = wake('跳过');
  page.onVoiceWakeup(skip);
  assert.equal(skip.prevented, false);
});

test('changing the star map page moves focus to its first planet', () => {
  const page = createPage('map');
  assert.equal(page.resolveFocus().target.id, 'map-planet-tide-3');
  page.nextMapPage(page.datasetEvent({ delta: 1 }));
  assert.equal(page.data.mapPage, 2);
  assert.equal(page.resolveFocus().target.id, 'map-planet-moon-mirror-port');
});

test('Page key handlers route verified glasses-leg codes to focus actions', () => {
  const page = createPage('opening');
  const moves = [];
  const scheduledTaps = [];
  const cancellations = [];
  const backs = [];
  page.moveFocus = (delta) => moves.push(delta);
  page.scheduleSingleTap = () => scheduledTaps.push('single');
  page.cancelPendingTempleTap = () => cancellations.push('cancel');
  page.goBack = () => backs.push('back');
  const event = (code) => ({
    code,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  });

  const down = event('ArrowDown');
  page.onKeyDown(down);
  assert.deepEqual(moves, [1]);
  assert.equal(down.prevented, true);

  const arrowUp = event('ArrowDown');
  page.onKeyUp(arrowUp);
  assert.deepEqual(moves, [1]);
  assert.equal(arrowUp.prevented, true);

  const enter = event('Enter');
  page.onKeyDown(enter);
  assert.deepEqual(scheduledTaps, ['single']);
  assert.equal(enter.prevented, true);

  const backspace = event('Backspace');
  page.onKeyDown(backspace);
  assert.deepEqual(backs, ['back']);
  assert.equal(backspace.prevented, true);

  page._templeInputState.lastTapSignalAt = 0;
  page._templeInputState.pendingTapAt = 0;
  page._templeInputState.tapDownAt = 0;
  page.onKeyUp(event('GlobalHook'));
  assert.deepEqual(scheduledTaps, ['single', 'single']);

  page.applyTempleIntent({ type: 'tap', sequence: 'double' });
  assert.deepEqual(backs, ['back', 'back']);
  assert.ok(cancellations.length >= 2);

  page._templeInputState.lastTapSignalAt = 0;
  page._templeInputState.pendingTapAt = 0;
  page._templeInputState.tapDownAt = 0;
  page.onKeyDown(event('GlobalHook'));
  page.onKeyUp(event('GlobalHook'));
  assert.deepEqual(scheduledTaps, ['single', 'single', 'single']);
});

test('nod confirms the focused target once and other head gestures are ignored', () => {
  assert.match(ink, /enableWorldAwareness\(\)/);
  assert.match(ink, /onHeadGesture\(event\)/);
  const page = createPage('menu');
  let confirmations = 0;
  page.continueFromMenu = () => {
    confirmations += 1;
  };
  page._lastNodConfirmAt = 0;

  page.data.spatialMode = false;
  page.onHeadGesture({ gesture: 'nod', preventDefault() {} });
  assert.equal(confirmations, 0);

  page.data.spatialMode = true;
  page.onHeadGesture({ gesture: 'shake', preventDefault() {} });
  assert.equal(confirmations, 0);

  page.onHeadGesture({ gesture: 'nod', preventDefault() {} });
  page.onHeadGesture({ gesture: 'nod', preventDefault() {} });
  assert.equal(confirmations, 1);
});

test('3DoF ignores temple selection and single-click confirmation', () => {
  const page = createPage('menu');
  const moves = [];
  let scheduled = 0;
  let backs = 0;
  page.data.spatialMode = true;
  page.moveFocus = (delta) => moves.push(delta);
  page.scheduleSingleTap = () => {
    scheduled += 1;
  };
  page.goBack = () => {
    backs += 1;
  };

  page.applyTempleIntent({ type: 'previous' });
  page.applyTempleIntent({ type: 'next' });
  page.applyTempleIntent({ type: 'tap', sequence: 'single' });
  assert.deepEqual(moves, []);
  assert.equal(scheduled, 0);

  page.applyTempleIntent({ type: 'tap', sequence: 'double' });
  assert.equal(backs, 1);
});

test('two Page-level temple taps become one double-click back action', () => {
  const page = createPage('opening');
  let scheduled = 0;
  let cancelled = 0;
  let backs = 0;
  page.scheduleSingleTap = () => {
    scheduled += 1;
  };
  page.cancelPendingTempleTap = () => {
    cancelled += 1;
  };
  page.goBack = () => {
    backs += 1;
  };
  const event = (code) => ({
    code,
    preventDefault() {},
  });

  page.onKeyDown(event('GlobalHook'));
  page.onKeyUp(event('GlobalHook'));
  page.onKeyDown(event('GlobalHook'));
  page.onKeyUp(event('GlobalHook'));

  assert.equal(scheduled, 1);
  assert.equal(backs, 1);
  assert.equal(cancelled, 1);
});

test('single tap waits for the double-tap window and double tap cancels it', async () => {
  const page = createPage('opening');
  let activations = 0;
  let backs = 0;
  page.activateFocusedTarget = () => {
    activations += 1;
  };
  page.goBack = () => {
    backs += 1;
  };

  page.scheduleSingleTap();
  await new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP_WINDOW_MS + 40));
  assert.equal(activations, 1);
  assert.equal(backs, 0);

  page.scheduleSingleTap();
  page.applyTempleIntent({ type: 'tap', sequence: 'double' });
  await new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP_WINDOW_MS + 40));
  assert.equal(activations, 1);
  assert.equal(backs, 1);
});
