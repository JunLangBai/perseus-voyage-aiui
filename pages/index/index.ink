<script def>
{
  "navigationBarTitleText": "英仙座远航",
  "description": "Rokid AIUI 单绿色殖民舰队经营 Demo。"
}
</script>

<script setup>
import * as Game from '../../game/engine.js';
import {
  FACTIONS,
  PLANETS,
  RESOURCE_LABELS,
  RESOURCE_SHORT_LABELS,
} from '../../game/content.js';
import {
  clearPendingTap,
  DOUBLE_TAP_WINDOW_MS,
  findDefaultFocusIndex,
  findFocusIndex,
  moveFocusIndex,
  templeIntent,
} from '../../interaction/temple.js';
import {
  GAZE_CONFIG,
  relativeGazeAngles,
  smoothGazeAngles,
  spatialMotionFromAngles,
} from '../../interaction/gaze.js';
import {
  createGyroFocusState,
  GYRO_CONFIG,
  gyroFocusIntent,
} from '../../interaction/gyroscope.js';

const PLANET_BY_ID = PLANETS.reduce((catalog, planet) => {
  catalog[planet.id] = planet;
  return catalog;
}, {});
const PAGE_LABELS = {
  1: '殖民地',
  2: '前哨航路',
  3: '深空航段',
  4: '最终要塞',
};
const NOD_CONFIRM_COOLDOWN_MS = 700;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function eventDataset(event) {
  if (event.currentTarget && event.currentTarget.dataset) return event.currentTarget.dataset;
  if (event.target && event.target.dataset) return event.target.dataset;
  return {};
}

function gazePoint(x = 0.5, y = 0.5) {
  return { x: clamp(x, 0.01, 0.99), y: clamp(y, 0.01, 0.99) };
}

function stackedGazePoint(index, total, x = 0.5, first = 0.28, last = 0.72) {
  const denominator = Math.max(1, total - 1);
  return gazePoint(x, first + ((last - first) * index) / denominator);
}

function neutralSpatialMotionPatch() {
  return {
    spatialViewX: 0,
    spatialViewY: 0,
    spatialViewRotate: 0,
    spatialViewScale: 1,
    spatialNavX: 0,
    spatialNavRotate: 0,
    spatialControlX: 0,
    spatialOrientationLabel: 'YAW 00° · PITCH 00°',
  };
}

function flatSpatialPatch() {
  return {
    spatialMode: false,
    ...neutralSpatialMotionPatch(),
  };
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function formatSignedAngle(radians) {
  const degrees = Math.round((Number(radians) || 0) * 180 / Math.PI);
  const magnitude = Math.abs(degrees);
  return `${degrees >= 0 ? '+' : '-'}${magnitude < 10 ? '0' : ''}${magnitude}°`;
}

function resourceLabel(key) {
  return RESOURCE_LABELS[key] || key;
}

function outputLine(planet) {
  return `${RESOURCE_SHORT_LABELS.population}+${planet.output.population} ${RESOURCE_SHORT_LABELS.energy}+${planet.output.energy} ${RESOURCE_SHORT_LABELS.alloy}+${planet.output.alloy}`;
}

function formatUpkeep(upkeep) {
  return `人口 -${upkeep.population} / 能源 -${upkeep.energy} / 合金 -${upkeep.alloy}`;
}

function ownerLabel(owner) {
  if (owner === 'player') return '己方';
  if (owner === 'unowned') return '无阵营';
  return FACTIONS[owner] ? FACTIONS[owner].shortName : '未知';
}

function planetModel(planet, state) {
  const planetState = state.planets[planet.id];
  const isOwned = planetState.owner === 'player';
  const upkeep = isOwned
    ? Game.getColonyUpkeepRate(planetState.stability)
    : null;
  return {
    id: planet.id,
    name: planet.name,
    owner: ownerLabel(planetState.owner),
    marker: planetState.owner === 'player'
      ? '控制'
      : planet.hostile
        ? '敌对'
        : '殖民',
    output: outputLine(planet),
    outputPopulation: planet.output.population,
    outputEnergy: planet.output.energy,
    outputAlloy: planet.output.alloy,
    flavor: planet.flavor,
    stability: Math.round(planetState.stability),
    upkeepLabel: upkeep
      ? state.settings.colonyUpkeepEnabled
        ? formatUpkeep(upkeep.rounded)
        : '已关闭'
      : '',
    upkeepMeta: upkeep
      ? `稳定修正 x${upkeep.multiplier.toFixed(2)}`
      : '',
    researchValue: planetState.research,
    recommended: planet.recommended,
    recommendedLabel: planet.colonizationShips
      ? planetState.owner === 'player'
        ? '已接入'
        : String(planet.colonizationShips)
      : planet.recommended
        ? String(planet.recommended)
        : '—',
    requirementLabel: planet.colonizationShips
      ? planetState.owner === 'player'
        ? '殖民状态'
        : '殖民需求'
      : '推荐投入',
    isOwned,
    isEnemy: Boolean(planet.hostile) && planetState.owner !== 'player',
    canColonize: planet.originOwner === 'unowned' && planetState.owner !== 'player',
    canReturn: planetState.owner === 'player' && planet.originOwner !== 'unowned',
    rowClass: planetState.owner === 'player' ? 'planet-button owned' : 'planet-button',
    actionLabel: planetState.owner === 'player'
      ? '管理'
      : planet.hostile
        ? '核查'
        : '开发',
  };
}

function pageTabs(currentPage, state) {
  return [1, 2, 3, 4].map((page) => {
    const pagePlanets = PLANETS.filter((planet) => planet.page === page);
    const owned = pagePlanets.filter((planet) => state.planets[planet.id].owner === 'player').length;
    return {
      page,
      label: String(page),
      summary: page === 4 ? `${owned}/1` : `${owned}/3`,
      className: page === currentPage ? 'page-tab active' : 'page-tab',
    };
  });
}

function resultModel(result, state) {
  if (!result) return null;
  const target = PLANET_BY_ID[result.targetId];
  const ownedCount = Game.getOwnedPlanets(state).length;
  return {
    title: result.title,
    wonLabel: result.won ? '占领成功' : '远征失败',
    text: result.text,
    targetName: result.targetName,
    investment: result.investment,
    recommended: result.recommended,
    lostShips: result.lostShips,
    availableShips: result.availableShips,
    output: target ? outputLine(target) : '',
    outputText: result.won && target ? outputLine(target) : '未接入',
    ownedCount,
    objective: ownedCount >= 10 ? '十星区已全部接管' : '修复舰队后继续推进',
    stageClass: result.cgType,
  };
}

function optionModels(event, selectedIndex) {
  if (!event) return [];
  return event.options.map((option, index) => ({
    index,
    label: option.label,
    preview: option.preview,
    className: index === selectedIndex ? 'choice-button selected' : 'choice-button',
  }));
}

function spatialCardModels(targets, currentIndex) {
  if (!Array.isArray(targets) || targets.length === 0 || currentIndex < 0) {
    return [];
  }
  const cardAt = (offset, slotLabel, className, visible = true) => {
    const index = ((currentIndex + offset) % targets.length + targets.length)
      % targets.length;
    return {
      offset,
      slotLabel,
      label: targets[index].label,
      className,
      visible,
    };
  };
  return [
    cardAt(-1, '上一项', 'dof-card dof-prev', targets.length > 1),
    cardAt(0, '当前焦点', 'dof-card dof-current'),
    cardAt(1, '下一项', 'dof-card dof-next', targets.length > 2),
  ];
}

function firstNextTarget(state) {
  const targets = PLANETS
    .filter((planet) => state.planets[planet.id].owner !== 'player')
    .sort((left, right) => {
      if (left.page !== right.page) return left.page - right.page;
      return (left.recommended || 0) - (right.recommended || 0);
    });
  return targets[0] || null;
}

export default {
  data: {
    screen: 'boot',
    showTicker: false,
    showResources: false,
    menuStarted: false,
    menuOwned: 0,
    menuShips: 0,
    menuStatus: '等待建立第一座殖民地',
    menuPrimaryLabel: '选择初始殖民地',
    menuUpkeepLabel: '殖民地维持：开启',
    menuRestartLabel: '开始新远征',
    mapPage: 1,
    tickerText: '深空中继在线',
    resourceItems: [],
    claimReady: false,
    autoHarvestStatus: '',
    colonyUpkeepEnabled: true,
    colonyUpkeepLine: '',
    totalOwned: 0,
    nextObjective: '',
    nextObjectiveMeta: '',
    mailPending: 0,
    availableShips: 0,
    totalShips: 0,
    damagedShips: 0,
    fleetDamageLabel: '舰队完好',
    researchValue: 0,
    researchCostLabel: 'x1.00',
    buildCostLine: '',
    repairCostLine: '',
    maintenanceText: '',
    maintenanceWarning: false,
    relationLine: '',
    relationStarCore: 0,
    relationHeavyWall: 0,
    activeNav: 'overview',
    openingPlanets: [],
    mapPlanets: [],
    pageTabs: [],
    mapPageLabel: '殖民地',
    mailEvents: [],
    activeEvent: null,
    activeEventId: '',
    eventOptions: [],
    selectedOptionIndex: -1,
    selectedOptionPreview: '',
    selectedPlanetId: '',
    selectedPlanet: null,
    showControlBar: false,
    focusTargetId: '',
    focusTargetLabel: '等待操作',
    focusPosition: '0/0',
    controlPrefix: '镜腿',
    controlHelp: '上下选择 · 单击确认 · 双击返回',
    spatialMode: false,
    spatialCards: [],
    spatialViewX: 0,
    spatialViewY: 0,
    spatialViewRotate: 0,
    spatialViewScale: 1,
    spatialNavX: 0,
    spatialNavRotate: 0,
    spatialControlX: 0,
    spatialOrientationLabel: 'YAW 00° · PITCH 00°',
    colonizeTarget: null,
    colonizeAvailable: 0,
    colonizeRequired: 0,
    colonizeCanStart: false,
    expeditionTarget: null,
    investment: 0,
    investmentMax: 0,
    investmentPercent: 0,
    investmentHalfPercent: 50,
    investmentRecPercent: 50,
    expeditionDanger: '',
    expeditionWinChance: 0,
    expeditionConfirmLabel: '确认出征',
    travelData: null,
    battleStageClass: 'defeat',
    battleTitle: '',
    battleSubtitle: '',
    resultData: null,
    tradeOffers: [],
    resetArmed: false,
    returnArmed: false,
    toastText: '',
    toastVisible: false,
    loadNotice: '',
    completed: false,
  },

  onLoad() {
    if (typeof this.enableWorldAwareness === 'function') {
      this.enableWorldAwareness();
    }
    this._focusContextKey = '';
    this._focusIndex = -1;
    this._focusTargetId = '';
    this._templeInputState = {
      lastTapSignalAt: 0,
      pendingTapAt: 0,
      tapDownAt: 0,
      lastBackSignalAt: 0,
      lastDirectionGesture: '',
      lastDirectionAt: 0,
    };
    this._singleTapTimer = null;
    this._singleTapToken = 0;
    this._autosaveTimer = null;
    this._gazeMode = 'fallback';
    this._gazeSensor = null;
    this._gazeReadingListener = null;
    this._gazeErrorListener = null;
    this._gyroSensor = null;
    this._gyroReadingListener = null;
    this._gyroErrorListener = null;
    this._gyroFocusState = createGyroFocusState();
    this._orientationReady = false;
    this._gyroReady = false;
    this._gazeContextKey = '';
    this._gazeReference = null;
    this._gazeAngles = null;
    this._gazePreviousAngles = null;
    this._gazeLastReadingAt = 0;
    this._orientationYawRate = 0;
    this._lastSpatialUpdateAt = 0;
    this._lastSpatialMotion = null;
    this._gazeNeedsCalibration = true;
    this._gazeErrorShown = false;
    this._lastNodConfirmAt = 0;
    this._game = Game.loadState(localStorage, Date.now());
    this._selectedResult = null;
    this._ambientTickerText = '深空中继在线';
    this._renderedTickerAmbient = '';
    const reconciled = Game.reconcileState(this._game, Date.now());
    this._game = reconciled.state;

    if (reconciled.changed) {
      Game.persistState(this._game, localStorage);
    }

    if (!this._game.started) {
      this._resumeScreen = 'opening';
    } else if (this._game.lastBattleResult) {
      this._selectedResult = this._game.lastBattleResult;
      this._resumeScreen = 'result';
    } else if (this._game.fleet.expedition) {
      this._resumeScreen = 'travel';
    } else {
      this._resumeScreen = 'overview';
    }

    if (this._game.loadFailed) {
      this.setData({ loadNotice: '存档读取异常，已载入安全默认状态。' });
    }

    this.setData({ screen: 'boot' });
    this.renderAll();
    this._bootTimer = setTimeout(() => {
      this.setData({
        screen: 'menu',
      });
      this._bootTimer = null;
      this.renderAll();
    }, 1350);
  },

  onShow() {
    this.startClock();
    this.refreshFromClock();
    this.startGazeFocus();
  },

  onHide() {
    this.stopGazeFocus();
    this.stopClock();
    this.cancelPendingTempleTap();
    if (this._game) this.persist();
  },

  onUnload() {
    this.stopGazeFocus();
    this.stopClock();
    if (this._game) this.persist();
    this.clearToastTimer();
    this.clearBattleTimer();
    this.cancelPendingTempleTap();
    if (this._bootTimer) {
      clearTimeout(this._bootTimer);
      this._bootTimer = null;
    }
  },

  startClock() {
    this.stopClock();
    this._clockTimer = setInterval(() => {
      this.refreshFromClock();
    }, 1000);
    this._autosaveTimer = setInterval(() => {
      if (this._game) this.persist();
    }, 60 * 1000);
  },

  stopClock() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
    if (this._autosaveTimer) {
      clearInterval(this._autosaveTimer);
      this._autosaveTimer = null;
    }
  },

  clearToastTimer() {
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
  },

  clearBattleTimer() {
    if (this._battleTimer) {
      clearTimeout(this._battleTimer);
      this._battleTimer = null;
    }
  },

  clearSingleTapTimer() {
    if (this._singleTapTimer) {
      clearTimeout(this._singleTapTimer);
      this._singleTapTimer = null;
    }
    this._singleTapToken = (this._singleTapToken || 0) + 1;
  },

  cancelPendingTempleTap() {
    this.clearSingleTapTimer();
    clearPendingTap(this._templeInputState);
  },

  setGazeMode(mode) {
    if (this._gazeMode === mode) return;
    this._gazeMode = mode;
    if (mode === 'starting') {
      this.setData({
        ...flatSpatialPatch(),
        controlPrefix: '校准',
        controlHelp: '等待方向与陀螺仪 · 暂用镜腿操作',
      });
      return;
    }
    if (mode === 'active') {
      this.cancelPendingTempleTap();
      this._gyroFocusState = createGyroFocusState();
      this.setData({
        spatialMode: true,
        controlPrefix: '3DoF',
        controlHelp: '陀螺仪转头换焦点 · 点头确认 · 双击返回',
      });
      return;
    }
    this.setData({
      ...flatSpatialPatch(),
      controlPrefix: '镜腿',
      controlHelp: '上下选择 · 单击确认 · 双击返回',
    });
  },

  startGazeFocus() {
    this.stopGazeFocus();
    const OrientationSensor = globalThis.AbsoluteOrientationSensor;
    const GyroSensor = globalThis.Gyroscope;
    if (
      typeof OrientationSensor !== 'function'
      || typeof GyroSensor !== 'function'
    ) {
      this.setGazeMode('fallback');
      return false;
    }

    this._orientationReady = false;
    this._gyroReady = false;
    this._gyroFocusState = createGyroFocusState();
    this.setGazeMode('starting');
    try {
      const orientationSensor = new OrientationSensor({
        frequency: GAZE_CONFIG.frequency,
      });
      this._gazeSensor = orientationSensor;
      this._gazeReadingListener = () => this.handleGazeReading();
      this._gazeErrorListener = (event) => this.handleGazeError(event);
      orientationSensor.addEventListener('reading', this._gazeReadingListener);
      orientationSensor.addEventListener('error', this._gazeErrorListener);

      const gyroSensor = new GyroSensor({ frequency: GYRO_CONFIG.frequency });
      this._gyroSensor = gyroSensor;
      this._gyroReadingListener = () => this.handleGyroReading();
      this._gyroErrorListener = (event) => this.handleGyroError(event);
      gyroSensor.addEventListener('reading', this._gyroReadingListener);
      gyroSensor.addEventListener('error', this._gyroErrorListener);

      orientationSensor.start();
      gyroSensor.start();
      this.recenterGaze();
      return true;
    } catch (error) {
      this.stopGazeFocus();
      this.setGazeMode('fallback');
      if (!this._gazeErrorShown && this.data.screen !== 'boot') {
        this._gazeErrorShown = true;
        this.showToast('空间传感器不可用，已切换为平面操作。');
      }
      return false;
    }
  },

  stopGazeFocus() {
    const orientationSensor = this._gazeSensor;
    const gyroSensor = this._gyroSensor;
    if (orientationSensor) {
      try {
        if (this._gazeReadingListener) {
          orientationSensor.removeEventListener('reading', this._gazeReadingListener);
        }
        if (this._gazeErrorListener) {
          orientationSensor.removeEventListener('error', this._gazeErrorListener);
        }
        orientationSensor.stop();
      } catch (error) {
        // The host may already have torn down the sensor during Page teardown.
      }
    }
    if (gyroSensor) {
      try {
        if (this._gyroReadingListener) {
          gyroSensor.removeEventListener('reading', this._gyroReadingListener);
        }
        if (this._gyroErrorListener) {
          gyroSensor.removeEventListener('error', this._gyroErrorListener);
        }
        gyroSensor.stop();
      } catch (error) {
        // The host may already have torn down the sensor during Page teardown.
      }
    }
    this._gazeSensor = null;
    this._gazeReadingListener = null;
    this._gazeErrorListener = null;
    this._gyroSensor = null;
    this._gyroReadingListener = null;
    this._gyroErrorListener = null;
    this._orientationReady = false;
    this._gyroReady = false;
    this._gyroFocusState = createGyroFocusState();
    this._gazeReference = null;
    this._gazeAngles = null;
    this._orientationYawRate = 0;
  },

  handleGazeError() {
    this.stopGazeFocus();
    this.setGazeMode('fallback');
    if (!this._gazeErrorShown) {
      this._gazeErrorShown = true;
      this.showToast('方向传感器读取失败，已切换为平面操作。');
    }
  },

  handleGyroError() {
    this.stopGazeFocus();
    this.setGazeMode('fallback');
    if (!this._gazeErrorShown) {
      this._gazeErrorShown = true;
      this.showToast('陀螺仪读取失败，已切换为平面操作。');
    }
  },

  maybeActivateSpatialMode() {
    if (
      this._gazeMode === 'starting'
      && this._orientationReady
      && this._gyroReady
    ) {
      this.resolveFocus();
      this.setGazeMode('active');
      this.renderAll();
    }
  },

  recenterGaze(contextKey = this.focusContextKey()) {
    this._gazeContextKey = contextKey;
    this._gazeReference = null;
    this._gazeAngles = null;
    this._gazePreviousAngles = null;
    this._gazeLastReadingAt = 0;
    this._orientationYawRate = 0;
    this._lastSpatialUpdateAt = 0;
    this._lastSpatialMotion = null;
    this._gyroFocusState = createGyroFocusState();
    this._gazeNeedsCalibration = true;
    if (this.data.spatialMode) {
      this.setData(neutralSpatialMotionPatch());
    }
  },

  handleGazeReading() {
    const sensor = this._gazeSensor;
    if (!sensor || !sensor.quaternion) return;

    const contextKey = this.focusContextKey();
    if (this._gazeContextKey !== contextKey) {
      this.recenterGaze(contextKey);
    }

    const quaternion = Array.from(sensor.quaternion);
    if (this._gazeNeedsCalibration) {
      this._gazeReference = quaternion;
      this._gazeAngles = { yaw: 0, pitch: 0 };
      this._gazePreviousAngles = { yaw: 0, pitch: 0 };
      this._gazeLastReadingAt = Date.now();
      this._gazeNeedsCalibration = false;
      this._orientationReady = true;
      this.maybeActivateSpatialMode();
      return;
    }

    const rawAngles = relativeGazeAngles(this._gazeReference, quaternion);
    if (!rawAngles) return;
    const now = Date.now();
    const elapsedSeconds = Math.max(
      0.001,
      (now - this._gazeLastReadingAt) / 1000,
    );
    const previousYaw = this._gazePreviousAngles
      ? this._gazePreviousAngles.yaw
      : 0;
    const rawYawRate = (rawAngles.yaw - previousYaw) / elapsedSeconds;
    this._orientationYawRate = this._orientationYawRate * 0.4 + rawYawRate * 0.6;
    this._gazePreviousAngles = rawAngles;
    this._gazeLastReadingAt = now;
    this._gazeAngles = smoothGazeAngles(this._gazeAngles, rawAngles);
    this.updateSpatialMotion(this._gazeAngles, now);
  },

  handleGyroReading() {
    const sensor = this._gyroSensor;
    if (
      !sensor
      || !Number.isFinite(Number(sensor.x))
      || !Number.isFinite(Number(sensor.y))
      || !Number.isFinite(Number(sensor.z))
    ) {
      return;
    }

    this._gyroReady = true;
    this.maybeActivateSpatialMode();
    if (!this.data.spatialMode) return;

    const now = Date.now();
    const angularActivity = Math.hypot(
      Number(sensor.x),
      Number(sensor.y),
      Number(sensor.z),
    );
    const result = gyroFocusIntent(
      this._gyroFocusState,
      angularActivity,
      this._orientationYawRate,
      now,
    );
    this._gyroFocusState = result.state;
    if (result.step !== 0) {
      this.moveFocus(result.step, { recenter: false });
    }
  },

  updateSpatialMotion(angles, now = Date.now()) {
    if (!this.data.spatialMode || !angles) return;
    if (now - this._lastSpatialUpdateAt < GAZE_CONFIG.spatialUpdateMilliseconds) return;
    const motion = spatialMotionFromAngles(angles.yaw, angles.pitch, {
      horizontalFieldOfViewDegrees: GAZE_CONFIG.horizontalFieldOfViewDegrees,
      verticalFieldOfViewDegrees: GAZE_CONFIG.verticalFieldOfViewDegrees,
    });
    const previous = this._lastSpatialMotion;
    if (previous) {
      const changed = Object.keys(motion).some((key) => (
        Math.abs(motion[key] - previous[key]) >= 0.04
      ));
      if (!changed) return;
    }
    this._lastSpatialUpdateAt = now;
    this._lastSpatialMotion = motion;
    this.setData({
      spatialViewX: motion.viewX,
      spatialViewY: motion.viewY,
      spatialViewRotate: motion.viewRotate,
      spatialViewScale: motion.viewScale,
      spatialNavX: motion.navX,
      spatialNavRotate: motion.navRotate,
      spatialControlX: motion.controlX,
      spatialOrientationLabel: `YAW ${formatSignedAngle(angles.yaw)} · PITCH ${formatSignedAngle(angles.pitch)}`,
    });
  },

  selectSpatialCard(event) {
    if (!this.data.spatialMode) return;
    const offset = Number(eventDataset(event).spatialOffset || 0);
    if (offset === 0) {
      this.activateFocusedTarget();
      return;
    }
    this.moveFocus(offset, { recenter: false });
  },

  scheduleSingleTap() {
    if (this.data.spatialMode) return;
    this.clearSingleTapTimer();
    const token = this._singleTapToken;
    this._singleTapTimer = setTimeout(() => {
      if (token !== this._singleTapToken) return;
      this._singleTapTimer = null;
      clearPendingTap(this._templeInputState);
      this.activateFocusedTarget();
    }, DOUBLE_TAP_WINDOW_MS);
  },

  applyTempleIntent(intent) {
    if (intent.type === 'previous') {
      this.cancelPendingTempleTap();
      if (this.data.spatialMode) return;
      this.moveFocus(-1);
      return;
    }
    if (intent.type === 'next') {
      this.cancelPendingTempleTap();
      if (this.data.spatialMode) return;
      this.moveFocus(1);
      return;
    }
    if (intent.type === 'back') {
      this.cancelPendingTempleTap();
      this.goBack();
      return;
    }
    if (intent.type === 'tap' && intent.sequence === 'double') {
      this.cancelPendingTempleTap();
      this.goBack();
      return;
    }
    if (intent.type === 'tap' && intent.sequence === 'single') {
      if (this.data.spatialMode) return;
      this.scheduleSingleTap();
    }
  },

  datasetEvent(dataset) {
    return {
      currentTarget: { dataset },
      target: { dataset },
    };
  },

  focusContextKey(screen = this.data.screen) {
    return screen || 'boot';
  },

  getFocusTargets() {
    const screen = this.data.screen;
    const targets = [];
    const add = (target) => targets.push(target);

    if (screen === 'menu') {
      add({
        id: 'menu-continue',
        label: this._game && this._game.started ? '继续远征' : '选择初始殖民地',
        default: true,
        gaze: gazePoint(0.5, 0.31),
        run: () => this.continueFromMenu(),
      });
      add({
        id: 'menu-colony-upkeep',
        label: this.data.menuUpkeepLabel,
        gaze: gazePoint(0.5, 0.53),
        run: () => this.toggleColonyUpkeep(),
      });
      if (this.data.menuStarted) {
        add({
          id: 'menu-reset',
          label: this.data.resetArmed ? '再次确认新远征' : '开始新远征',
          gaze: gazePoint(0.5, 0.72),
          run: () => this.requestReset(),
        });
      }
      add({
        id: 'menu-exit',
        label: '退出游戏',
        gaze: gazePoint(0.5, 0.89),
        run: () => this.requestExit(),
      });
      return targets;
    }

    if (screen === 'opening') {
      const openingPlanets = PLANETS.filter((planet) => planet.page === 1);
      openingPlanets
        .forEach((planet, index) => {
          add({
            id: `opening-${planet.id}`,
            label: `选择 ${planet.name}`,
            default: index === 0,
            gaze: stackedGazePoint(index, openingPlanets.length),
            run: () => this.startColony(this.datasetEvent({ planetId: planet.id })),
          });
        });
      return targets;
    }

    if (screen === 'overview') {
      add({
        id: 'overview-mail',
        label: `殖民邮件 ${this.data.mailPending} 封`,
        default: true,
        gaze: gazePoint(0.5, 0.34),
        run: () => this.goMail(),
      });
      add({
        id: 'overview-map',
        label: '打开星图',
        gaze: gazePoint(0.28, 0.72),
        run: () => this.goMap(),
      });
      add({
        id: 'overview-fleet',
        label: '打开舰队',
        gaze: gazePoint(0.72, 0.72),
        run: () => this.goFleet(),
      });
      return targets;
    }

    if (screen === 'map') {
      const pagePlanets = PLANETS.filter((planet) => planet.page === this.data.mapPage);
      pagePlanets.forEach((planet, index) => {
        const planetState = this._game.planets[planet.id];
        add({
          id: `map-planet-${planet.id}`,
          label: `查看 ${planet.name} / ${ownerLabel(planetState.owner)}`,
          default: index === 0,
          gaze: stackedGazePoint(index, pagePlanets.length, 0.5, 0.28, 0.72),
          run: () => this.openPlanet(this.datasetEvent({ planetId: planet.id })),
        });
      });
      add({
        id: 'map-prev',
        label: '上一张星图',
        default: pagePlanets.length === 0,
        gaze: gazePoint(0.18, 0.9),
        run: () => this.nextMapPage(this.datasetEvent({ delta: -1 })),
      });
      add({
        id: 'map-next',
        label: '下一张星图',
        gaze: gazePoint(0.5, 0.9),
        run: () => this.nextMapPage(this.datasetEvent({ delta: 1 })),
      });
      add({
        id: 'map-back',
        label: '返回总览',
        gaze: gazePoint(0.82, 0.9),
        run: () => this.goOverview(),
      });
      return targets;
    }

    if (screen === 'planet') {
      const planet = PLANET_BY_ID[this.data.selectedPlanetId];
      const planetState = planet ? this._game.planets[planet.id] : null;
      add({
        id: 'planet-back',
        label: '返回星图',
        default: !planet || (!planet.hostile && !planet.colonizationShips),
        gaze: gazePoint(0.28, 0.76),
        run: () => this.goBack(),
      });
      if (planet && planetState) {
        if (planet.hostile && planetState.owner !== 'player') {
          add({
            id: 'planet-action',
            label: `配置 ${planet.name} 远征`,
            default: true,
            gaze: gazePoint(0.72, 0.76),
            run: () => this.prepareExpeditionForId(planet.id),
          });
        } else if (planet.originOwner === 'unowned' && planetState.owner !== 'player') {
          add({
            id: 'planet-action',
            label: `殖民 ${planet.name}`,
            default: true,
            gaze: gazePoint(0.72, 0.76),
            run: () => this.openColonize(),
          });
        } else if (planetState.owner === 'player' && planet.originOwner !== 'unowned') {
          add({
            id: 'planet-action',
            label: this.data.returnArmed ? '再次确认归还殖民地' : '归还殖民地',
            gaze: gazePoint(0.72, 0.76),
            run: () => this.returnColony(),
          });
        }
      }
      return targets;
    }

    if (screen === 'colonize') {
      add({
        id: 'colonize-back',
        label: '返回行星详情',
        default: !this.data.colonizeCanStart,
        gaze: gazePoint(0.3, 0.72),
        run: () => this.goBack(),
      });
      if (this.data.colonizeCanStart) {
        add({
          id: 'colonize-confirm',
          label: '确认殖民',
          default: true,
          gaze: gazePoint(0.7, 0.72),
          run: () => this.confirmColonize(),
        });
      }
      return targets;
    }

    if (screen === 'fleet') {
      add({
        id: 'fleet-build',
        label: '建造 20 艘舰船',
        default: true,
        gaze: gazePoint(0.3, 0.36),
        run: () => this.buildFleet(),
      });
      add({
        id: 'fleet-repair',
        label: '维修 10 艘舰船',
        gaze: gazePoint(0.7, 0.36),
        run: () => this.repairFleet(),
      });
      add({
        id: 'fleet-trade',
        label: '阵营贸易',
        gaze: gazePoint(0.3, 0.74),
        run: () => this.goTrade(),
      });
      add({
        id: 'fleet-overview',
        label: '返回总览',
        gaze: gazePoint(0.7, 0.74),
        run: () => this.goOverview(),
      });
      return targets;
    }

    if (screen === 'mail') {
      const pendingEvents = this._game.pendingEvents;
      pendingEvents.forEach((event, index) => {
        add({
          id: `mail-row-${event.id}`,
          label: `邮件 ${index + 1} / ${event.title}`,
          default: index === 0,
          gaze: stackedGazePoint(index, pendingEvents.length, 0.5, 0.25, 0.68),
          run: () => this.openMailEvent(this.datasetEvent({ eventId: event.id })),
        });
      });
      add({
        id: 'mail-back',
        label: '返回总览',
        default: pendingEvents.length === 0,
        gaze: gazePoint(0.5, 0.87),
        run: () => this.goOverview(),
      });
      return targets;
    }

    if (screen === 'mail-detail') {
      const activeEvent = this.data.activeEvent;
      if (activeEvent) {
        activeEvent.options.forEach((option, index) => {
          add({
            id: `mail-option-${index}`,
            label: `选择 ${option.label}`,
            default: index === 0,
            gaze: stackedGazePoint(index, activeEvent.options.length, 0.5, 0.3, 0.58),
            run: () => this.selectMailOption(this.datasetEvent({ optionIndex: index })),
          });
        });
      }
      add({
        id: 'mail-detail-back',
        label: '返回邮箱',
        gaze: gazePoint(0.5, 0.82),
        run: () => this.goBack(),
      });
      return targets;
    }

    if (screen === 'trade') {
      Game.TRADE_OFFERS.forEach((offer, index) => {
        add({
          id: `trade-offer-${offer.id}`,
          label: `交换 ${offer.name}`,
          default: index === 0,
          gaze: stackedGazePoint(index, Game.TRADE_OFFERS.length, 0.8, 0.25, 0.68),
          run: () => this.tradeOffer(this.datasetEvent({ offerId: offer.id })),
        });
      });
      add({
        id: 'trade-back',
        label: '返回总览',
        gaze: gazePoint(0.5, 0.88),
        run: () => this.goOverview(),
      });
      return targets;
    }

    if (screen === 'expedition') {
      add({
        id: 'expedition-minus',
        label: '减少 10 艘出征舰船',
        gaze: gazePoint(0.25, 0.48),
        run: () => this.adjustInvestment(this.datasetEvent({ delta: -10 })),
      });
      add({
        id: 'expedition-plus',
        label: '增加 10 艘出征舰船',
        default: true,
        gaze: gazePoint(0.75, 0.48),
        run: () => this.adjustInvestment(this.datasetEvent({ delta: 10 })),
      });
      add({
        id: 'expedition-back',
        label: '返回行星详情',
        gaze: gazePoint(0.3, 0.78),
        run: () => this.goBack(),
      });
      if (this.data.investment > 0) {
        add({
          id: 'expedition-confirm',
          label: `确认远征 ${this.data.investment} 艘`,
          gaze: gazePoint(0.7, 0.78),
          run: () => this.confirmExpedition(),
        });
      }
      return targets;
    }

    if (screen === 'travel') {
      add({
        id: 'travel-overview',
        label: '返回总览等待',
        default: true,
        gaze: gazePoint(0.5, 0.74),
        run: () => this.goOverview(),
      });
      return targets;
    }

    if (screen === 'result') {
      add({
        id: 'result-finish',
        label: '返回总览',
        default: true,
        gaze: gazePoint(0.5, 0.76),
        run: () => this.finishResult(),
      });
    }

    return targets;
  },

  resolveFocus(screen = this.data.screen) {
    const targets = this.getFocusTargets();
    const contextKey = this.focusContextKey(screen);
    let index = findFocusIndex(targets, this._focusTargetId);
    let shouldRecenterGaze = contextKey !== this._focusContextKey;
    if (shouldRecenterGaze || index < 0) {
      index = findDefaultFocusIndex(targets);
      shouldRecenterGaze = true;
    }
    this._focusContextKey = contextKey;
    this._focusIndex = index;
    this._focusTargetId = index >= 0 ? targets[index].id : '';
    if (shouldRecenterGaze) {
      this.recenterGaze(contextKey);
    }
    return {
      targets,
      target: index >= 0 ? targets[index] : null,
      index,
    };
  },

  moveFocus(delta, options = {}) {
    const focus = this.resolveFocus();
    if (focus.targets.length === 0) {
      this.showToast('当前页面没有可执行操作。');
      return;
    }
    const nextIndex = moveFocusIndex(focus.index, focus.targets.length, delta);
    this._focusIndex = nextIndex;
    this._focusTargetId = focus.targets[nextIndex].id;
    if (options.recenter !== false) this.recenterGaze();
    this.renderAll();
  },

  activateFocusedTarget() {
    const focus = this.resolveFocus();
    if (!focus.target) {
      this.showToast('当前页面没有可执行操作。');
      return;
    }
    focus.target.run();
  },

  refreshFromClock() {
    if (!this._game) return;
    const now = Date.now();
    const reconciled = Game.reconcileState(this._game, now);
    this._game = reconciled.state;
    let shouldPersist = reconciled.changed;

    if (reconciled.arrived) {
      this._selectedResult = this._game.lastBattleResult;
      this.showBattle();
      Game.persistState(this._game, localStorage);
      return;
    }

    if (this.data.screen !== 'battle' && this.data.screen !== 'result') {
      const ticker = Game.maybeAdvanceTicker(this._game, now);
      this._game = ticker.state;
      if (ticker.advanced) {
        shouldPersist = true;
        this._ambientTickerText = this._game.ticker.text;
      }
    }

    if (this.autoHarvest(now).ok) {
      shouldPersist = true;
    }

    if (shouldPersist) {
      Game.persistState(this._game, localStorage);
    }
    this.renderAll(now);
  },

  persist() {
    const result = Game.persistState(this._game, localStorage);
    if (!result.ok) this.showToast(`存档失败：${result.message}`);
    return result.ok;
  },

  showToast(text) {
    this.clearToastTimer();
    this.setData({ toastText: text, toastVisible: true });
    this._toastTimer = setTimeout(() => {
      this.setData({ toastVisible: false });
      this._toastTimer = null;
    }, 2400);
  },

  setScreen(screen) {
    if (screen === 'overview' && this.autoHarvest(Date.now()).ok) {
      this.persist();
    }
    this.setData({
      screen,
      returnArmed: false,
      resetArmed: false,
    });
    this.renderAll();
  },

  continueFromMenu() {
    const screen = this._resumeScreen || (this._game.started ? 'overview' : 'opening');
    if (screen === 'overview' && this.autoHarvest(Date.now()).ok) {
      this.persist();
    }
    this.setData({ screen });
    this.renderAll();
  },

  toggleColonyUpkeep() {
    const enabled = !this._game.settings.colonyUpkeepEnabled;
    this._game = Game.setColonyUpkeepEnabled(this._game, enabled);
    this.persist();
    this.renderAll();
    this.showToast(enabled
      ? '殖民地日常维持已开启。稳定度越低，消耗越高。'
      : '殖民地日常维持已关闭。');
  },

  renderAll(now = Date.now()) {
    if (!this._game) return;
    const state = this._game;
    const claimWindow = Game.getClaimWindow(state, now);
    const autoHarvestStatus = claimWindow.ready
      ? '可结算产出等待自动入库'
      : `${Math.max(1, Math.ceil(claimWindow.nextClaimMs / 1000))} 秒后自动收获`;
    const colonyUpkeep = Game.getProjectedColonyUpkeep(state, Game.CYCLE_MS);
    const colonyUpkeepLine = colonyUpkeep.enabled
      ? `日常维持 ${formatUpkeep(colonyUpkeep.rounded)} · 稳定低则消耗高`
      : '日常维持已关闭 · 可在菜单开启';
    const highestResearch = Game.getHighestResearch(state);
    const available = Game.getAvailableShips(state);
    const nextTarget = firstNextTarget(state);
    const ownedCount = Game.getOwnedPlanets(state).length;
    const buildCost = Game.getBuildCost(state);
    const repairCost = Game.getRepairCost(state);
    const selectedPlanetDef = PLANET_BY_ID[this.data.selectedPlanetId] || null;
    const colonizePlanetDef = this.data.colonizeTarget
      ? PLANET_BY_ID[this.data.colonizeTarget.id] || null
      : null;
    const activeEvent = state.pendingEvents.find((event) => event.id === this.data.activeEventId) || null;
    const screen = this.data.screen;
    const focus = this.resolveFocus(screen);
    const focusedTargetId = focus.target ? focus.target.id : '';
    const spatialCards = spatialCardModels(focus.targets, focus.index);
    const mapPlanets = PLANETS
      .filter((planet) => planet.page === this.data.mapPage)
      .map((planet) => {
        const model = planetModel(planet, state);
        const focusId = `map-planet-${planet.id}`;
        return {
          ...model,
          focusId,
          rowClass: focusedTargetId === focusId ? `${model.rowClass} focused` : model.rowClass,
        };
      });

    const resources = [
      {
        key: 'population',
        label: RESOURCE_LABELS.population,
        value: String(state.resources.population),
        className: 'resource-value',
      },
      {
        key: 'energy',
        label: RESOURCE_LABELS.energy,
        value: String(state.resources.energy),
        className: 'resource-value',
      },
      {
        key: 'alloy',
        label: RESOURCE_LABELS.alloy,
        value: String(state.resources.alloy),
        className: 'resource-value',
      },
      {
        key: 'ships',
        label: RESOURCE_LABELS.ships,
        value: state.fleet.damaged > 0 ? `${available}/${state.resources.ships}` : String(available),
        className: state.fleet.damaged > 0 ? 'resource-value warning' : 'resource-value',
      },
    ];

    const openingPlanets = PLANETS
      .filter((planet) => planet.page === 1)
      .map((planet, index) => {
        const model = planetModel(planet, state);
        const focusId = `opening-${planet.id}`;
        return {
          ...model,
          ordinal: `0${index + 1}`,
          outputs: outputLine(planet),
          focusId,
          rowClass: focusedTargetId === focusId
            ? 'opening-row focused'
            : 'opening-row',
        };
      });

    const mailEvents = state.pendingEvents.map((event, index) => {
      const baseClass = event.templateId === 'lost-freighter' ? 'mail-row alarm' : 'mail-row';
      const focusId = `mail-row-${event.id}`;
      return {
        id: event.id,
        index: `0${index + 1}`,
        title: event.title,
        source: event.source,
        sourceLine: event.planetId && PLANET_BY_ID[event.planetId]
          ? `${event.source} / ${PLANET_BY_ID[event.planetId].name}`
          : event.source,
        focusId,
        rowClass: focusedTargetId === focusId ? `${baseClass} focused` : baseClass,
      };
    });

    const travelData = state.fleet.expedition
      ? this.buildTravelData(state.fleet.expedition, now)
      : this.data.travelData;
    const showTicker = !['boot', 'menu', 'opening', 'battle', 'result'].includes(screen);
    const showResources = screen === 'overview' || screen === 'fleet';

    const tradeOffers = Game.TRADE_OFFERS.map((offer) => {
      const quote = Game.getTradeQuote(state, offer.id);
      const focusId = `trade-offer-${offer.id}`;
      return {
        id: offer.id,
        name: offer.name,
        faction: FACTIONS[offer.faction].shortName,
        meta: `好感加成 ${Math.round((1 - quote.factor) * 100)}%`,
        price: `${resourceLabel(offer.give.resource)} ${quote.required} → ${resourceLabel(offer.receive.resource)} ${offer.receive.amount}`,
        focusId,
        rowClass: focusedTargetId === focusId ? 'trade-row focused' : 'trade-row',
      };
    });

    const tabs = pageTabs(this.data.mapPage, state).map((tab) => {
      const focusId = `map-page-${tab.page}`;
      return {
        ...tab,
        focusId,
        className: focusedTargetId === focusId
          ? `${tab.className} focused`
          : tab.className,
      };
    });
    const options = optionModels(activeEvent, this.data.selectedOptionIndex).map((option) => {
      const focusId = `mail-option-${option.index}`;
      return {
        ...option,
        focusId,
        className: focusedTargetId === focusId
          ? `${option.className} focused`
          : option.className,
      };
    });

    const patch = {
      showTicker,
      showResources,
      menuStarted: state.started,
      menuOwned: ownedCount,
      menuShips: available,
      menuStatus: state.started
        ? `已控制 ${ownedCount}/10 行星 · 舰队 ${available}`
        : '等待建立第一座殖民地',
      menuPrimaryLabel: state.started ? '继续远征' : '选择初始殖民地',
      menuUpkeepLabel: `殖民地维持：${state.settings.colonyUpkeepEnabled ? '开启' : '关闭'}`,
      menuRestartLabel: this.data.resetArmed ? '再次确认新远征' : '开始新远征',
      resourceItems: resources,
      claimReady: claimWindow.ready,
      autoHarvestStatus,
      colonyUpkeepEnabled: Boolean(state.settings.colonyUpkeepEnabled),
      colonyUpkeepLine,
      totalOwned: ownedCount,
      nextObjective: nextTarget
        ? nextTarget.colonizationShips
          ? `${nextTarget.name} / 殖民`
          : `${nextTarget.name} / 敌对`
        : '星区已接管',
      mailPending: state.pendingEvents.length,
      availableShips: available,
      totalShips: state.resources.ships,
      damagedShips: state.fleet.damaged,
      fleetDamageLabel: state.resources.ships === 0
        ? '无可用舰船'
        : state.fleet.damaged > 0
          ? `战损 ${state.fleet.damaged}`
          : '舰队完好',
      researchValue: highestResearch,
      researchCostLabel: `x${Game.getResearchCostFactor(state).toFixed(2)}`,
      buildCostLine: `人口 ${buildCost.population} / 能源 ${buildCost.energy} / 合金 ${buildCost.alloy}`,
      repairCostLine: `人口 ${repairCost.population} / 能源 ${repairCost.energy} / 合金 ${repairCost.alloy}`,
      maintenanceText: state.fleet.maintenanceOverdue
        ? '[!] 维持资源不足，建造与维修已锁定'
        : '[+] 维持正常：建造与维修可用',
      maintenanceWarning: state.fleet.maintenanceOverdue,
      relationLine: `海帕 ${state.relations.starCore >= 0 ? '+' : ''}${state.relations.starCore}  /  陆巡 ${state.relations.heavyWall >= 0 ? '+' : ''}${state.relations.heavyWall}`,
      relationStarCore: state.relations.starCore,
      relationHeavyWall: state.relations.heavyWall,
      activeNav: screen,
      showControlBar: screen !== 'boot',
      focusTargetId: focusedTargetId,
      focusTargetLabel: focus.target ? focus.target.label : '等待操作',
      focusPosition: focus.target ? `${focus.index + 1}/${focus.targets.length}` : '0/0',
      spatialCards,
      openingPlanets,
      mapPlanets,
      pageTabs: tabs,
      mapPageLabel: PAGE_LABELS[this.data.mapPage] || '殖民地',
      mailEvents,
      activeEvent,
      eventOptions: options,
      selectedPlanet: selectedPlanetDef ? planetModel(selectedPlanetDef, state) : null,
      colonizeTarget: colonizePlanetDef ? planetModel(colonizePlanetDef, state) : null,
      colonizeAvailable: available,
      colonizeRequired: colonizePlanetDef ? colonizePlanetDef.colonizationShips : 0,
      colonizeCanStart: Boolean(colonizePlanetDef && available >= colonizePlanetDef.colonizationShips),
      expeditionTarget: this.data.expeditionTarget
        ? planetModel(PLANET_BY_ID[this.data.expeditionTarget.id], state)
        : null,
      tradeOffers,
      travelData,
      resultData: this._selectedResult ? resultModel(this._selectedResult, state) : null,
      completed: Boolean(state.completedAt),
    };
    if (this._renderedTickerAmbient !== this._ambientTickerText) {
      patch.tickerText = this._ambientTickerText;
      this._renderedTickerAmbient = this._ambientTickerText;
    }
    this.setData(patch);

    if (this.data.screen === 'expedition') {
      this.renderInvestment();
    }
  },

  buildTravelData(expedition, now) {
    const target = PLANET_BY_ID[expedition.targetId];
    const owned = Game.getOwnedPlanets(this._game);
    const fromPage = owned.length ? Math.max(...owned.map((planet) => planet.page)) : 1;
    const total = Math.max(1000, expedition.arrivedAt - expedition.startedAt);
    const elapsed = clamp(now - expedition.startedAt, 0, total);
    const remaining = Math.max(0, expedition.arrivedAt - now);
    return {
      fromPage,
      toPage: target.page,
      fromLabel: `PAGE 0${fromPage} / ${PAGE_LABELS[fromPage]}`,
      toLabel: `PAGE 0${target.page} / ${target.name}`,
      targetName: target.name,
      seconds: expedition.durationSeconds,
      secondsLeft: Math.ceil(remaining / 1000),
      progress: Math.round((elapsed / total) * 100),
      durationClass: `travel-dot duration-${expedition.durationSeconds}`,
    };
  },

  renderInvestment() {
    if (!this._game || !this.data.expeditionTarget) return;
    const target = PLANET_BY_ID[this.data.expeditionTarget.id];
    const max = Game.getMaxInvestment(this._game);
    const investment = clamp(this.data.investment, 0, max);
    const winChance = Game.getEstimatedWinChance(target, investment);
    const danger = winChance === 0
      ? '[!] 投入低于最低建议，远征几乎没有胜算'
      : winChance === 50
        ? '[~] 势均力敌，预计胜负各半'
        : winChance < 50
          ? `[~] 当前投入偏低，预计胜率 ${winChance}%`
          : `[+] 当前投入占优，预计胜率 ${winChance}%`;

    this.setData({
      investment,
      investmentMax: max,
      expeditionDanger: danger,
      expeditionWinChance: winChance,
    });
  },

  goOverview() {
    if (this.data.screen === 'result') {
      this.finishResult();
      return;
    }
    this.setScreen(this._game && this._game.started ? 'overview' : 'opening');
  },

  goMap() {
    if (!this._game.started) {
      this.showToast('先选择第一颗殖民地。');
      return;
    }
    this.setData({ screen: 'map', activeNav: 'map' });
    this.renderAll();
  },

  goMail() {
    if (!this._game.started) {
      this.showToast('先选择第一颗殖民地。');
      return;
    }
    this.setData({ screen: 'mail', activeNav: 'mail', activeEventId: '' });
    this.renderAll();
  },

  goFleet() {
    if (!this._game.started) return;
    this.setData({ screen: 'fleet', activeNav: 'fleet' });
    this.renderAll();
  },

  goTrade() {
    if (!this._game.started) return;
    this.setData({ screen: 'trade', activeNav: 'trade' });
    this.renderAll();
  },

  startColony(event) {
    const planetId = eventDataset(event).planetId;
    const result = Game.startGame(this._game, planetId, Date.now());
    if (!result.ok) {
      this.showToast(result.message);
      return;
    }
    this._game = result.state;
    this.autoHarvest(Date.now());
    this.persist();
    this._resumeScreen = 'overview';
    this.setData({ screen: 'overview', activeNav: 'overview' });
    this.showToast(result.message);
    this.renderAll();
  },

  claimOutput() {
    const result = this.autoHarvest(Date.now());
    if (!result.ok) {
      this.showToast('行星产出正在自动积累。');
      return;
    }
    this.persist();
    this.renderAll();
    this.showToast('本轮产出已自动入库。');
  },

  autoHarvest(now = Date.now()) {
    if (!this._game || !this._game.started) {
      return { ok: false, state: this._game };
    }
    if (!Game.getClaimWindow(this._game, now).ready) {
      return { ok: false, state: this._game };
    }
    const result = Game.claimAll(this._game, now);
    if (result.ok) {
      this._game = result.state;
    }
    return result;
  },

  buildFleet() {
    const result = Game.buildShips(this._game);
    if (!result.ok) {
      this.showToast(result.message);
      return;
    }
    this._game = result.state;
    this.persist();
    this.renderAll();
    this.showToast(result.message);
  },

  repairFleet() {
    const result = Game.repairShips(this._game);
    if (!result.ok) {
      this.showToast(result.message);
      return;
    }
    this._game = result.state;
    this.persist();
    this.renderAll();
    this.showToast(result.message);
  },

  setMapPage(event) {
    const page = Number(eventDataset(event).page || 1);
    this._focusTargetId = '';
    this._focusContextKey = '';
    this.setData({
      screen: 'map',
      mapPage: clamp(page, 1, 4),
      selectedPlanetId: '',
      returnArmed: false,
      activeNav: 'map',
    });
    this.renderAll();
  },

  nextMapPage(event) {
    const delta = Number(eventDataset(event).delta || 1);
    const page = clamp(this.data.mapPage + delta, 1, 4);
    this._focusTargetId = '';
    this._focusContextKey = '';
    this.setData({ mapPage: page, selectedPlanetId: '', returnArmed: false });
    this.renderAll();
  },

  openPlanet(event) {
    const planetId = eventDataset(event).planetId;
    if (!PLANET_BY_ID[planetId]) return;
    this.setData({
      screen: 'planet',
      selectedPlanetId: planetId,
      mapPage: PLANET_BY_ID[planetId].page,
      activeNav: 'planet',
      returnArmed: false,
    });
    this.renderAll();
  },

  openColonize() {
    const planet = PLANET_BY_ID[this.data.selectedPlanetId];
    if (!planet || planet.originOwner !== 'unowned') {
      this.showToast('该行星不需要殖民。');
      return;
    }
    this.setData({
      screen: 'colonize',
      colonizeTarget: { id: planet.id, name: planet.name },
      activeNav: 'colonize',
    });
    this.renderAll();
  },

  confirmColonize() {
    if (!this.data.colonizeTarget) return;
    const result = Game.colonizePlanet(
      this._game,
      this.data.colonizeTarget.id,
      Date.now(),
    );
    if (!result.ok) {
      this.showToast(result.message);
      return;
    }
    this._game = result.state;
    this.persist();
    this.setData({
      screen: 'planet',
      colonizeTarget: null,
      selectedPlanetId: result.state.planets[this.data.selectedPlanetId]
        ? this.data.selectedPlanetId
        : this.data.colonizeTarget.id,
    });
    this.showToast(result.message);
    this.renderAll();
  },

  prepareExpedition(event) {
    const planetId = event && eventDataset(event).planetId
      ? eventDataset(event).planetId
      : this.data.selectedPlanetId;
    this.prepareExpeditionForId(planetId);
  },

  prepareExpeditionForId(planetId) {
    const planet = PLANET_BY_ID[planetId];
    if (!planet || !planet.hostile) {
      this.showToast('该行星不是军事目标。');
      return;
    }
    const max = Game.getMaxInvestment(this._game);
    const preferred = Math.min(planet.recommended, max);
    this.setData({
      screen: 'expedition',
      selectedPlanetId: planetId,
      expeditionTarget: {
        id: planet.id,
        name: planet.name,
      },
      investment: preferred,
      activeNav: 'expedition',
    });
    this.renderAll();
  },

  adjustInvestment(event) {
    const delta = Number(eventDataset(event).delta || 0);
    const max = Game.getMaxInvestment(this._game);
    const next = clamp(this.data.investment + delta, 0, max);
    if (next === this.data.investment) {
      this.showToast(delta < 0 ? '已达到最低投入。' : '已达到可用舰船上限。');
      return;
    }
    this.setData({ investment: next });
    this.renderInvestment();
  },

  setInvestmentPreset(event) {
    if (!this.data.expeditionTarget) return;
    const target = PLANET_BY_ID[this.data.expeditionTarget.id];
    const max = Game.getMaxInvestment(this._game);
    const mode = eventDataset(event).mode;
    let value = target.recommended;
    if (mode === 'half') value = Math.ceil(target.recommended * 0.5);
    if (mode === 'max') value = max;
    this.setData({ investment: clamp(value, 0, max) });
    this.renderInvestment();
  },

  confirmExpedition() {
    if (!this.data.expeditionTarget) return;
    if (this.data.investment <= 0) {
      this.showToast('请至少投入 10 艘舰船。');
      return;
    }
    const result = Game.startExpedition(
      this._game,
      this.data.expeditionTarget.id,
      this.data.investment,
      Date.now(),
    );
    if (!result.ok) {
      this.showToast(result.message);
      return;
    }
    this._game = result.state;
    this.persist();
    this.setData({
      screen: 'travel',
      activeNav: 'travel',
      travelData: this.buildTravelData(result.expedition, Date.now()),
    });
    this._resumeScreen = 'travel';
    this.renderAll();
    this.showToast(result.message);
  },

  showBattle() {
    if (!this._selectedResult) return;
    this.clearBattleTimer();
    const result = this._selectedResult;
    this.setData({
      screen: 'battle',
      battleStageClass: result.cgType,
      battleTitle: result.title,
      battleSubtitle: `${result.targetName} / 战损 ${result.lostShips}`,
    });
    this._battleTimer = setTimeout(() => {
      this.openResult();
    }, 4200);
  },

  skipBattle() {
    this.clearBattleTimer();
    this.openResult();
  },

  openResult() {
    this.clearBattleTimer();
    this.setData({
      screen: 'result',
      resultData: this._selectedResult
        ? resultModel(this._selectedResult, this._game)
        : this.data.resultData,
    });
  },

  finishResult() {
    if (this._game.lastBattleResult) {
      this._game = Game.acknowledgeBattleResult(this._game);
      this.persist();
    }
    this._selectedResult = null;
    this._resumeScreen = 'overview';
    this.setData({ screen: 'overview', resultData: null, activeNav: 'overview' });
    this.renderAll();
  },

  openMailEvent(event) {
    const eventId = eventDataset(event).eventId;
    const mail = this._game.pendingEvents.find((item) => item.id === eventId);
    if (!mail) return;
    this._focusTargetId = 'mail-option-0';
    this._focusContextKey = '';
    this.setData({
      screen: 'mail-detail',
      activeEventId: eventId,
      activeEvent: mail,
      selectedOptionIndex: -1,
      selectedOptionPreview: '',
      activeNav: 'mail',
    }, () => this.renderAll());
  },

  selectMailOption(event) {
    const index = Number(eventDataset(event).optionIndex);
    const activeEvent = this.data.activeEvent;
    if (!activeEvent || !activeEvent.options[index]) return;
    const result = Game.chooseEvent(
      this._game,
      activeEvent.id,
      index,
      Date.now(),
    );
    if (!result.ok) {
      this.showToast(result.message);
      return;
    }
    this._game = result.state;
    this.persist();
    this.setData({
      screen: 'mail',
      activeEventId: '',
      activeEvent: null,
      selectedOptionIndex: -1,
      selectedOptionPreview: '',
    });
    this.renderAll();
    this.showToast(result.message);
  },

  tradeOffer(event) {
    const offerId = eventDataset(event).offerId;
    const result = Game.tradeResources(this._game, offerId);
    if (!result.ok) {
      this.showToast(result.message);
      return;
    }
    this._game = result.state;
    this.persist();
    this.renderAll();
    this.showToast(result.message);
  },

  returnColony() {
    if (!this.data.selectedPlanetId) return;
    if (!this.data.returnArmed) {
      this.setData({ returnArmed: true });
      this.showToast('再次确认：归还后停止该行星产出。');
      return;
    }
    const result = Game.returnColony(this._game, this.data.selectedPlanetId);
    if (!result.ok) {
      this.showToast(result.message);
      return;
    }
    this._game = result.state;
    this.persist();
    this.setData({ returnArmed: false, screen: 'planet' });
    this.renderAll();
    this.showToast(result.message);
  },

  requestReset() {
    if (!this.data.resetArmed) {
      this.setData({ resetArmed: true });
      this.renderAll();
      this.showToast('再次确认：将清空当前存档。');
      return;
    }
    Game.resetSavedState(localStorage);
    this._game = Game.createDefaultState(Date.now());
    this._selectedResult = null;
    this.setData({
      screen: 'opening',
      mapPage: 1,
      selectedPlanetId: '',
      expeditionTarget: null,
      activeEventId: '',
      resetArmed: false,
      travelData: null,
      resultData: null,
    });
    this._resumeScreen = 'opening';
    this.renderAll();
    this.showToast('存档已重置。');
  },

  requestExit() {
    if (!this.persist()) return;
    if (typeof window !== 'undefined' && typeof window.close === 'function') {
      window.close();
      return;
    }
    this.renderAll();
    this.showToast('当前环境不支持退出游戏。');
  },

  goBack() {
    const screen = this.data.screen;
    if (screen === 'boot') return;
    if (screen === 'menu') return;
    if (screen === 'mail-detail') {
      this.setData({ screen: 'mail', activeEventId: '', selectedOptionIndex: -1 });
      this.renderAll();
      return;
    }
    if (screen === 'planet') {
      this.setScreen('map');
      return;
    }
    if (screen === 'colonize') {
      this.setScreen('planet');
      return;
    }
    if (screen === 'expedition') {
      this.setScreen('planet');
      return;
    }
    if (screen === 'battle') {
      this.skipBattle();
      return;
    }
    if (screen === 'result') {
      this.finishResult();
      return;
    }
    if (screen === 'travel') {
      this.goOverview();
      return;
    }
    if (screen === 'overview' || screen === 'opening') {
      this.setData({ screen: 'menu' });
      this.renderAll();
      return;
    }
    if (screen === 'trade') {
      this.setScreen('fleet');
      return;
    }
    this.goOverview();
  },

  onHeadGesture(event) {
    if (!event || event.gesture !== 'nod' || !this.data.spatialMode) return;
    const now = Date.now();
    const lastNodAt = Number(this._lastNodConfirmAt) || 0;
    if (now - lastNodAt < NOD_CONFIRM_COOLDOWN_MS) return;
    this._lastNodConfirmAt = now;
    this.cancelPendingTempleTap();
    const focus = this.resolveFocus();
    if (!focus.target) return;
    if (event.preventDefault) event.preventDefault();
    focus.target.run();
  },

  onKeyDown(event) {
    const intent = templeIntent(
      event,
      'down',
      this._templeInputState,
      Date.now(),
    );
    if (!intent) return;
    if (event.preventDefault) event.preventDefault();
    this.applyTempleIntent(intent);
  },

  onKeyUp(event) {
    const intent = templeIntent(
      event,
      'up',
      this._templeInputState,
      Date.now(),
    );
    if (!intent) return;
    if (event.preventDefault) event.preventDefault();
    if (intent.type === 'consume') return;
    this.applyTempleIntent(intent);
  },

  onVoiceWakeup(event) {
    const parts = [event.text, event.keyword];
    if (event.detail) parts.push(event.detail.text, event.detail.keyword);
    const text = parts.filter(Boolean).join(' ');
    let handled = true;

    if (text.includes('领取')) {
      this.claimOutput();
    } else if (text.includes('建造')) {
      this.buildFleet();
    } else if (text.includes('邮件')) {
      this.goMail();
    } else if (text.includes('地图')) {
      this.goMap();
    } else if (text.includes('舰队')) {
      this.goFleet();
    } else if (text.includes('退出')) {
      this.requestExit();
    } else if (text.includes('返回')) {
      this.goBack();
    } else if (text.includes('攻击')) {
      const target = PLANETS.find((planet) => text.includes(planet.name));
      if (target) this.prepareExpeditionForId(target.id);
      else {
        handled = false;
        this.showToast('请说出目标行星名。');
      }
    } else {
      handled = false;
    }

    if (handled && event.preventDefault) event.preventDefault();
  },
};
</script>

<page>
  <view
    class="app-shell {{spatialMode ? 'spatial-mode' : ''}}"
    style="--spatial-view-x: {{spatialViewX}}px; --spatial-view-y: {{spatialViewY}}px; --spatial-view-rotate: {{spatialViewRotate}}deg; --spatial-view-scale: {{spatialViewScale}}; --spatial-nav-x: {{spatialNavX}}px; --spatial-nav-rotate: {{spatialNavRotate}}deg; --spatial-control-x: {{spatialControlX}}px;"
  >
    <view ink:if="{{showTicker}}" class="telemetry-row">
      <view class="telemetry-window">
        <view class="telemetry-track">
          <view class="telemetry-group">
            <text class="telemetry-copy">{{tickerText}}</text>
            <text class="telemetry-separator">···</text>
          </view>
          <view class="telemetry-group">
            <text class="telemetry-copy">{{tickerText}}</text>
            <text class="telemetry-separator">···</text>
          </view>
        </view>
      </view>
    </view>

    <view ink:if="{{showResources}}" class="resource-strip">
      <view ink:for="{{resourceItems}}" class="resource-cell">
        <text class="resource-key">{{item.label}}</text>
        <text class="{{item.className}}">{{item.value}}</text>
      </view>
    </view>

    <scroll-view scroll-y="true" class="viewport">
      <view ink:if="{{screen == 'boot'}}" class="screen screen-fill">
        <view class="boot-screen">
          <text class="boot-title">英仙座远航</text>
          <text class="boot-caption">远征舰队系统初始化中</text>
          <view class="boot-progress-track">
            <view class="boot-progress-fill"></view>
          </view>
        </view>
      </view>

      <view ink:if="{{screen == 'menu'}}" class="screen screen-fill">
        <view class="menu-screen">
          <view class="menu-panel">
            <text class="menu-eyebrow">本地远征存档</text>
            <text class="menu-title">英仙座远航</text>
            <text class="menu-status">{{menuStatus}}</text>
            <text class="menu-note">离线最多累计 30 分钟</text>
            <text class="menu-note">稳定度越低，殖民地日常维持消耗越高</text>
            <view class="menu-rule"></view>
            <view class="menu-actions">
              <button class="action-button primary {{focusTargetId == 'menu-continue' ? 'focused' : ''}}" bindtap="continueFromMenu">
                <text>{{menuPrimaryLabel}}</text>
              </button>
              <button class="action-button quiet {{focusTargetId == 'menu-colony-upkeep' ? 'focused' : ''}}" bindtap="toggleColonyUpkeep">
                <text>{{menuUpkeepLabel}}</text>
              </button>
              <button ink:if="{{menuStarted}}" class="{{resetArmed ? 'action-button primary' : 'action-button quiet'}} {{focusTargetId == 'menu-reset' ? 'focused' : ''}}" bindtap="requestReset">
                <text>{{menuRestartLabel}}</text>
              </button>
              <button class="action-button quiet {{focusTargetId == 'menu-exit' ? 'focused' : ''}}" bindtap="requestExit">
                <text>退出游戏</text>
              </button>
            </view>
          </view>
        </view>
      </view>

      <view ink:if="{{screen == 'opening'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">建立第一座殖民地</text>
          <text class="screen-kicker">选择初始据点</text>
        </view>
        <text class="screen-copy">3DoF 转头换焦点、点头确认；无传感器时上下滑并单击确认。</text>
        <view class="opening-list">
          <button ink:for="{{openingPlanets}}" class="{{item.rowClass}}" data-planet-id="{{item.id}}" bindtap="startColony">
            <text class="planet-index">{{item.ordinal}}</text>
            <view class="opening-copy">
              <text class="opening-name">{{item.name}}</text>
              <text class="opening-flavor">{{item.flavor}}</text>
            </view>
            <text class="opening-outputs">{{item.outputs}}</text>
            <text class="planet-enter">›</text>
          </button>
        </view>
      </view>

      <view ink:if="{{screen == 'overview'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">殖民地总览</text>
          <text class="screen-kicker">{{totalOwned}}/10 行星</text>
        </view>
        <view class="overview-clean">
          <text class="objective-line">下一目标 · {{nextObjective}}</text>
          <view class="harvest-status">
            <view class="claim-copy">
              <text class="claim-title">行星产出自动入库</text>
              <text class="claim-meta">{{totalOwned}} 颗己方行星 · {{autoHarvestStatus}}</text>
              <text class="claim-meta">{{colonyUpkeepLine}}</text>
            </view>
            <text class="claim-auto-status">自动</text>
          </view>
          <button class="mail-entry {{focusTargetId == 'overview-mail' ? 'focused' : ''}}" bindtap="goMail">
            <text>殖民邮件 · {{mailPending}} 封待处理  ›</text>
          </button>
          <view class="overview-actions">
            <button class="action-button quiet {{focusTargetId == 'overview-map' ? 'focused' : ''}}" bindtap="goMap"><text>星图</text></button>
            <button class="action-button quiet {{focusTargetId == 'overview-fleet' ? 'focused' : ''}}" bindtap="goFleet"><text>舰队</text></button>
          </view>
          <view class="panel-line">
            <text class="screen-meta">可用舰船 {{availableShips}}</text>
            <text class="screen-meta">{{fleetDamageLabel}}</text>
          </view>
          <text ink:if="{{maintenanceWarning}}" class="objective-line">[!] 维持资源不足，建造与维修已锁定。</text>
        </view>
      </view>

      <view ink:if="{{screen == 'map'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">星图</text>
          <text class="screen-kicker">{{mapPage}}/4 · {{mapPageLabel}}</text>
        </view>
        <view class="planet-list">
          <button ink:for="{{mapPlanets}}" class="{{item.rowClass}}" data-planet-id="{{item.id}}" bindtap="openPlanet">
            <text class="planet-level">{{item.marker}}</text>
            <view class="planet-button-copy">
              <text class="planet-button-name">{{item.name}}</text>
              <text class="planet-button-meta">{{item.owner}}</text>
            </view>
            <text class="planet-enter">›</text>
          </button>
        </view>
        <view class="map-footer map-navigation">
          <button class="action-button quiet compact {{focusTargetId == 'map-prev' ? 'focused' : ''}}" data-delta="-1" bindtap="nextMapPage"><text>上一页</text></button>
          <button class="action-button quiet compact {{focusTargetId == 'map-next' ? 'focused' : ''}}" data-delta="1" bindtap="nextMapPage"><text>下一页</text></button>
          <button class="action-button quiet compact {{focusTargetId == 'map-back' ? 'focused' : ''}}" bindtap="goOverview"><text>返回总览</text></button>
        </view>
      </view>

      <view ink:if="{{screen == 'planet'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">{{selectedPlanet.name}}</text>
          <text class="screen-kicker">{{selectedPlanet.owner}} · {{selectedPlanet.marker}}</text>
        </view>
        <view class="detail-clean">
          <text class="detail-clean-copy">{{selectedPlanet.flavor}}</text>
          <view class="detail-clean-stats">
            <view class="detail-clean-stat">
              <text class="detail-clean-key">每分钟产出</text>
              <text class="detail-clean-value">{{selectedPlanet.output}}</text>
            </view>
            <view class="detail-clean-stat">
              <text class="detail-clean-key">稳定度</text>
              <text class="detail-clean-value">{{selectedPlanet.stability}}</text>
            </view>
            <view class="detail-clean-stat">
              <text class="detail-clean-key">科研值</text>
              <text class="detail-clean-value">{{selectedPlanet.researchValue}} / 100</text>
            </view>
            <view ink:if="{{selectedPlanet.isOwned}}" class="detail-clean-stat">
              <text class="detail-clean-key">每分钟维持</text>
              <text class="detail-clean-value">{{selectedPlanet.upkeepLabel}} · {{selectedPlanet.upkeepMeta}}</text>
            </view>
            <view class="detail-clean-stat">
              <text class="detail-clean-key">{{selectedPlanet.requirementLabel}}</text>
              <text class="detail-clean-value">{{selectedPlanet.recommendedLabel}}</text>
            </view>
          </view>
          <view class="detail-clean-actions">
            <button class="action-button quiet {{focusTargetId == 'planet-back' ? 'focused' : ''}}" bindtap="goBack"><text>返回星图</text></button>
            <button ink:if="{{selectedPlanet.isEnemy}}" class="action-button primary {{focusTargetId == 'planet-action' ? 'focused' : ''}}" bindtap="prepareExpedition">
              <text>配置远征</text>
            </button>
            <button ink:if="{{selectedPlanet.canColonize}}" class="action-button primary {{focusTargetId == 'planet-action' ? 'focused' : ''}}" bindtap="openColonize">
              <text>殖民</text>
            </button>
            <button ink:if="{{selectedPlanet.canReturn}}" class="{{returnArmed ? 'action-button primary' : 'action-button quiet'}} {{focusTargetId == 'planet-action' ? 'focused' : ''}}" bindtap="returnColony">
              <text>{{returnArmed ? '再次确认归还' : '归还殖民地'}}</text>
            </button>
          </view>
        </view>
      </view>

      <view ink:if="{{screen == 'colonize'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">{{colonizeTarget.name}}</text>
          <text class="screen-kicker">殖民</text>
        </view>
        <view class="expedition-clean">
          <view class="expedition-top">
            <view class="expedition-metric">
              <text class="expedition-metric-key">可用舰船</text>
              <text class="expedition-metric-value">{{colonizeAvailable}}</text>
            </view>
            <view class="expedition-metric">
              <text class="expedition-metric-key">殖民需求</text>
              <text class="expedition-metric-value">{{colonizeRequired}}</text>
            </view>
            <view class="expedition-metric">
              <text class="expedition-metric-key">预计结果</text>
              <text class="expedition-metric-value">{{colonizeCanStart ? '可殖民' : '不足'}}</text>
            </view>
          </view>
          <text class="expedition-alert">达到所需舰船后即可殖民。成功后，{{colonizeRequired}} 艘殖民舰队会全部损耗。</text>
          <view class="expedition-actions">
            <button class="action-button quiet {{focusTargetId == 'colonize-back' ? 'focused' : ''}}" bindtap="goBack"><text>返回</text></button>
            <button class="{{colonizeCanStart ? 'action-button primary' : 'action-button disabled'}} {{focusTargetId == 'colonize-confirm' ? 'focused' : ''}}" bindtap="confirmColonize"><text>确认殖民</text></button>
          </view>
        </view>
      </view>

      <view ink:if="{{screen == 'fleet'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">远征舰队</text>
          <text class="screen-kicker">最高科研值 {{researchValue}} · 成本 {{researchCostLabel}}</text>
        </view>
        <view class="fleet-clean">
          <view class="fleet-hero">
            <text class="fleet-hero-number">{{availableShips}}</text>
            <text class="fleet-hero-copy">总量 {{totalShips}} · 战损 {{damagedShips}}</text>
          </view>
          <view class="fleet-action-row">
            <button class="action-button primary {{focusTargetId == 'fleet-build' ? 'focused' : ''}}" bindtap="buildFleet"><text>建造 20</text></button>
            <button class="action-button {{focusTargetId == 'fleet-repair' ? 'focused' : ''}}" bindtap="repairFleet"><text>维修 10</text></button>
          </view>
          <text class="fleet-cost-inline">建造：{{buildCostLine}}</text>
          <text class="fleet-cost-inline">维修：{{repairCostLine}}</text>
          <text ink:if="{{maintenanceWarning}}" class="objective-line">[!] 维持资源不足，建造与维修已锁定。</text>
          <view class="fleet-tools">
            <button class="action-button quiet {{focusTargetId == 'fleet-trade' ? 'focused' : ''}}" bindtap="goTrade"><text>阵营贸易</text></button>
            <button class="action-button quiet {{focusTargetId == 'fleet-overview' ? 'focused' : ''}}" bindtap="goOverview"><text>返回总览</text></button>
          </view>
        </view>
      </view>

      <view ink:if="{{screen == 'mail'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">殖民邮件</text>
          <text class="screen-kicker">{{mailPending}}/3 待处理</text>
        </view>
        <view ink:if="{{mailEvents.length > 0}}" class="mail-list">
          <button ink:for="{{mailEvents}}" class="{{item.rowClass}}" data-event-id="{{item.id}}" bindtap="openMailEvent">
            <text class="mail-index">{{item.index}}</text>
            <view class="mail-copy">
              <text class="mail-title">{{item.title}}</text>
              <text class="mail-source">{{item.sourceLine}}</text>
            </view>
            <text class="planet-enter">›</text>
          </button>
        </view>
        <view ink:if="{{mailEvents.length == 0}}" class="empty-box">
          <text>暂无待处理邮件</text>
          <text>新邮件会自动抵达。</text>
        </view>
        <view class="map-footer">
          <button class="action-button compact {{focusTargetId == 'mail-back' ? 'focused' : ''}}" bindtap="goOverview"><text>返回总览</text></button>
        </view>
      </view>

      <view ink:if="{{screen == 'mail-detail'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">{{activeEvent.title}}</text>
          <text class="screen-kicker">{{activeEvent.source}}</text>
        </view>
        <view class="mail-detail">
          <text class="mail-body">{{activeEvent.body}}</text>
          <button ink:for="{{eventOptions}}" class="{{item.className}}" data-option-index="{{item.index}}" bindtap="selectMailOption">
            <text>{{item.label}}</text>
            <text class="choice-preview">{{item.preview}}</text>
          </button>
          <view class="action-row">
            <button class="action-button quiet compact {{focusTargetId == 'mail-detail-back' ? 'focused' : ''}}" bindtap="goBack"><text>返回邮箱</text></button>
          </view>
        </view>
      </view>

      <view ink:if="{{screen == 'trade'}}" class="screen screen-fill trade-screen">
        <view class="screen-head">
          <text class="screen-title">阵营贸易</text>
          <text class="screen-kicker trade-relations">海帕 {{relationStarCore}} · 陆巡 {{relationHeavyWall}}</text>
        </view>
        <view class="trade-list">
          <view ink:for="{{tradeOffers}}" class="{{item.rowClass}}">
            <view class="trade-copy">
              <text class="trade-title">{{item.faction}} / {{item.name}}</text>
              <text class="trade-meta">{{item.meta}}</text>
            </view>
            <text class="trade-price">{{item.price}}</text>
            <button class="action-button compact" data-offer-id="{{item.id}}" bindtap="tradeOffer"><text>交换</text></button>
          </view>
        </view>
        <view class="map-footer trade-footer">
          <button class="action-button compact {{focusTargetId == 'trade-back' ? 'focused' : ''}}" bindtap="goOverview"><text>返回总览</text></button>
        </view>
      </view>

      <view ink:if="{{screen == 'expedition'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">{{expeditionTarget.name}}</text>
          <text class="screen-kicker">敌对目标</text>
        </view>
        <view class="expedition-clean">
          <view class="expedition-top">
            <view class="expedition-metric">
              <text class="expedition-metric-key">可用舰船</text>
              <text class="expedition-metric-value">{{availableShips}}</text>
            </view>
            <view class="expedition-metric">
              <text class="expedition-metric-key">推荐投入</text>
              <text class="expedition-metric-value">{{expeditionTarget.recommended}}</text>
            </view>
            <view class="expedition-metric">
              <text class="expedition-metric-key">预计胜率</text>
              <text class="expedition-metric-value">{{expeditionWinChance}}%</text>
            </view>
          </view>
          <text class="expedition-alert">{{expeditionDanger}}</text>
          <text class="expedition-rule">出征舰队不能超过可用舰船；每 10 艘消耗人口、能源、合金各 10。</text>
          <view class="investment-clean">
            <button class="action-button {{focusTargetId == 'expedition-minus' ? 'focused' : ''}}" data-delta="-10" bindtap="adjustInvestment"><text>-10</text></button>
            <view class="investment-value-clean">
              <text class="investment-value-number">{{investment}}</text>
              <text class="investment-value-caption">出征舰船 / 上限 {{investmentMax}}</text>
            </view>
            <button class="action-button {{focusTargetId == 'expedition-plus' ? 'focused' : ''}}" data-delta="10" bindtap="adjustInvestment"><text>+10</text></button>
          </view>
          <view class="expedition-actions">
            <button class="action-button quiet {{focusTargetId == 'expedition-back' ? 'focused' : ''}}" bindtap="goBack"><text>返回</text></button>
            <button class="action-button primary {{focusTargetId == 'expedition-confirm' ? 'focused' : ''}}" bindtap="confirmExpedition"><text>确认远征</text></button>
          </view>
        </view>
      </view>

      <view ink:if="{{screen == 'travel'}}" class="screen screen-fill">
        <view class="screen-head">
          <text class="screen-title">远征舰队航行中</text>
          <text class="screen-kicker">{{travelData.secondsLeft}} 秒</text>
        </view>
        <view class="travel-stage">
          <view class="travel-endpoints">
            <text>{{travelData.fromLabel}}</text>
            <text>{{travelData.toLabel}}</text>
          </view>
          <view class="travel-track">
            <view class="travel-line"></view>
            <view class="travel-progress" style="width: {{travelData.progress}}%;"></view>
          </view>
          <view class="travel-caption">
            <text>唯一远征舰队</text>
            <text>{{travelData.progress}}%</text>
          </view>
          <button class="action-button {{focusTargetId == 'travel-overview' ? 'focused' : ''}}" bindtap="goOverview"><text>返回总览等待</text></button>
        </view>
      </view>

      <view ink:if="{{screen == 'battle'}}" class="screen screen-fill">
        <view class="battle-stage {{battleStageClass}}">
          <view class="battle-cg">
            <view class="battle-grid-line battle-grid-horizontal"></view>
            <view class="battle-grid-line battle-grid-vertical"></view>
            <view class="battle-scan"></view>
            <view class="battle-planet">
              <view class="battle-planet-core"></view>
              <view class="battle-planet-ring planet-ring-a"></view>
              <view class="battle-planet-ring planet-ring-b"></view>
            </view>
            <view class="battle-fleet">
              <view class="battle-ship"></view>
              <view class="battle-ship"></view>
              <view class="battle-ship"></view>
              <view class="battle-ship"></view>
            </view>
            <view class="battle-enemy">
              <view class="battle-enemy-ship"></view>
              <view class="battle-enemy-ship"></view>
              <view class="battle-enemy-ship"></view>
            </view>
            <view class="battle-laser battle-laser-a"></view>
            <view class="battle-laser battle-laser-b"></view>
            <view class="battle-impact"></view>
          </view>
          <view class="battle-copy">
            <text class="battle-signal">FLEET CONTACT</text>
            <text class="battle-title">{{battleTitle}}</text>
            <text class="battle-subtitle">{{battleSubtitle}}</text>
          </view>
        </view>
      </view>

      <view ink:if="{{screen == 'result'}}" class="screen">
        <view class="screen-head">
          <text class="screen-title">远征结算</text>
        </view>
        <view class="result-layout">
          <view class="result-hero">
            <text class="result-title">{{resultData.title}}</text>
            <text class="screen-kicker">{{resultData.wonLabel}}</text>
            <text class="result-copy">{{resultData.text}}</text>
            <text class="screen-meta">{{resultData.objective}}</text>
          </view>
          <view class="result-stats">
            <view class="open-panel">
              <view class="panel-line">
                <text class="panel-line-label">目标</text>
                <text class="panel-line-value">{{resultData.targetName}}</text>
              </view>
              <view class="panel-line">
                <text class="panel-line-label">投入</text>
                <text class="panel-line-value">{{resultData.investment}} / {{resultData.recommended}}</text>
              </view>
              <view class="panel-line">
                <text class="panel-line-label">战损</text>
                <text class="panel-line-value">{{resultData.lostShips}} 舰</text>
              </view>
              <view class="panel-line">
                <text class="panel-line-label">新产出</text>
                <text class="panel-line-value">{{resultData.outputText}}</text>
              </view>
            </view>
            <button class="action-button primary {{focusTargetId == 'result-finish' ? 'focused' : ''}}" bindtap="finishResult"><text>返回总览</text></button>
          </view>
        </view>
      </view>
    </scroll-view>

    <view ink:if="{{spatialMode && showControlBar && spatialCards.length > 0}}" class="dof-nav">
      <view class="dof-track">
        <button
          ink:for="{{spatialCards}}"
          ink:if="{{item.visible}}"
          class="{{item.className}}"
          data-spatial-offset="{{item.offset}}"
          bindtap="selectSpatialCard"
        >
          <text class="dof-slot">{{item.slotLabel}}</text>
          <text class="dof-label">{{item.label}}</text>
        </button>
      </view>
      <view class="dof-telemetry">
        <text>{{spatialOrientationLabel}}</text>
        <text>GYRO FOCUS</text>
      </view>
    </view>

    <view ink:if="{{showControlBar}}" class="control-bar">
      <text class="control-prefix">{{controlPrefix}}</text>
      <text class="control-position">{{focusPosition}}</text>
      <text class="control-focus">当前：{{focusTargetLabel}}</text>
      <text class="control-help">{{controlHelp}}</text>
    </view>

    <view ink:if="{{toastVisible}}" class="toast">{{toastText}}</view>
  </view>
</page>

<style>
@import "/styles/app.css";
</style>
