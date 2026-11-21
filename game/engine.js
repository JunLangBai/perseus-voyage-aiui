import {
  CONTENT_VERSION,
  EVENT_TEMPLATES,
  FACTIONS,
  PLANETS,
  RESOURCE_SHORT_LABELS,
  TICKER_TEMPLATES,
  TRADE_OFFERS,
} from './content.js';

export const SAVE_KEY = 'perseus-voyage.save.v1';
export const SAVE_VERSION = 1;
export const MINUTE_MS = 60 * 1000;
export const AUTO_CLAIM_INTERVAL_MS = 10 * 1000;
export const CYCLE_MS = MINUTE_MS;
export const MAX_OFFLINE_MS = 30 * MINUTE_MS;
export const BUILD_BATCH = 20;
export const REPAIR_BATCH = 10;
export const INITIAL_RELATION = 50;
export const MIN_RELATION = 0;
export const MAX_RELATION = 100;
export const STABILITY_MULTIPLIER_MIN = 0.6;
export const STABILITY_MULTIPLIER_MAX = 1.4;
export const STABILITY_MULTIPLIER_PER_POINT = 0.008;
export const RESEARCH_COST_PER_POINT = 0.0032;
export const RESEARCH_COST_FLOOR = 0.68;
export const TRADE_RELATION_DIVISOR = 250;
export const INITIAL_RESOURCES = {
  population: 137,
  energy: 190,
  alloy: 127,
  ships: 10,
};

export { CONTENT_VERSION, EVENT_TEMPLATES, FACTIONS, PLANETS, RESOURCE_SHORT_LABELS, TICKER_TEMPLATES, TRADE_OFFERS };

const PLANET_BY_ID = PLANETS.reduce((catalog, planet) => {
  catalog[planet.id] = planet;
  return catalog;
}, {});
const RESOURCE_KEYS = ['population', 'energy', 'alloy'];
const ROUNDING_EPSILON = 1e-9;

function emptyResourceCarry() {
  return {
    population: 0,
    energy: 0,
    alloy: 0,
  };
}

function nowValue(now) {
  return Number.isFinite(now) ? now : Date.now();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toSafeNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeRelation(value) {
  return clamp(
    Math.round(toSafeNumber(value, INITIAL_RELATION)),
    MIN_RELATION,
    MAX_RELATION,
  );
}

function legacyResearchValue(level, progress, fallback) {
  if (level === undefined || level === null) return fallback;
  const safeLevel = clamp(Math.round(toSafeNumber(level, 1)), 1, 5);
  const safeProgress = clamp(toSafeNumber(progress, 0), 0, 99);
  return clamp((safeLevel - 1) * 25 + safeProgress * 0.25, 0, 100);
}

function normalizeClaimCarry(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const production = source.production && typeof source.production === 'object'
    ? source.production
    : {};
  const maintenance = source.maintenance && typeof source.maintenance === 'object'
    ? source.maintenance
    : {};
  const normalizePart = (part) => {
    const output = emptyResourceCarry();
    RESOURCE_KEYS.forEach((key) => {
      output[key] = clamp(toSafeNumber(part[key], 0), -1, 1);
    });
    return output;
  };
  return {
    production: normalizePart(production),
    maintenance: normalizePart(maintenance),
  };
}

function roundResourceAmount(value) {
  return Math.round(value + ROUNDING_EPSILON);
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function nextEventDelay() {
  return randomBetween(30, 120) * 1000;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getPlanet(planetId) {
  return PLANET_BY_ID[planetId] || null;
}

export function createDefaultState(now = Date.now()) {
  const current = nowValue(now);
  const planets = {};

  PLANETS.forEach((planet) => {
    planets[planet.id] = {
      owner: planet.originOwner,
      stability: planet.stability,
      research: planet.research,
      occupiedAt: null,
    };
  });

  return {
    version: SAVE_VERSION,
    contentVersion: CONTENT_VERSION,
    started: false,
    startedAt: null,
    selectedStartId: null,
    resources: clone(INITIAL_RESOURCES),
    planets,
    fleet: {
      damaged: 0,
      maintenanceOverdue: false,
      expedition: null,
    },
    relations: {
      starCore: INITIAL_RELATION,
      heavyWall: INITIAL_RELATION,
    },
    claimCarry: {
      production: emptyResourceCarry(),
      maintenance: emptyResourceCarry(),
    },
    lastClaimAt: current,
    nextEventAt: current + 45 * 1000,
    pendingEvents: [],
    eventCursor: 0,
    lastTickerAt: current,
    ticker: {
      kind: 'plain',
      text: '深空中继已接入。等待总督下达第一道命令。',
      at: current,
    },
    tickerCursor: 0,
    lastBattleResult: null,
    battleHistory: [],
    completedAt: null,
    lastSavedAt: null,
  };
}

function normalizePlanetState(raw, planet) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const research = source.research !== undefined && source.research !== null
    ? clamp(Math.round(toSafeNumber(source.research, planet.research)), 0, 100)
    : legacyResearchValue(source.science, source.scienceProgress, planet.research);
  return {
    owner: typeof source.owner === 'string' ? source.owner : planet.originOwner,
    stability: clamp(toSafeNumber(source.stability, planet.stability), 0, 100),
    research,
    occupiedAt: source.occupiedAt || null,
  };
}

export function normalizeState(raw, now = Date.now()) {
  if (!raw || raw.version !== SAVE_VERSION) {
    const fallback = createDefaultState(now);
    fallback.loadFailed = true;
    return fallback;
  }

  const base = createDefaultState(now);
  const state = {
    ...base,
    ...raw,
    resources: { ...base.resources, ...(raw.resources || {}) },
    relations: { ...base.relations, ...(raw.relations || {}) },
    fleet: { ...base.fleet, ...(raw.fleet || {}) },
    claimCarry: normalizeClaimCarry(raw.claimCarry),
    planets: {},
    pendingEvents: Array.isArray(raw.pendingEvents) ? raw.pendingEvents.slice(0, 3) : [],
    battleHistory: Array.isArray(raw.battleHistory) ? raw.battleHistory.slice(0, 12) : [],
  };

  RESOURCE_KEYS.forEach((key) => {
    state.resources[key] = Math.max(0, Math.round(toSafeNumber(state.resources[key], 0)));
  });
  state.resources.ships = Math.max(0, Math.round(toSafeNumber(state.resources.ships, 0)));
  state.relations.starCore = normalizeRelation(state.relations.starCore);
  state.relations.heavyWall = normalizeRelation(state.relations.heavyWall);
  state.fleet.damaged = clamp(
    Math.round(toSafeNumber(state.fleet.damaged, 0)),
    0,
    state.resources.ships,
  );
  state.fleet.maintenanceOverdue = Boolean(state.fleet.maintenanceOverdue);

  PLANETS.forEach((planet) => {
    state.planets[planet.id] = normalizePlanetState(raw.planets && raw.planets[planet.id], planet);
  });

  if (!state.started) {
    state.fleet.expedition = null;
    state.lastBattleResult = null;
  }

  if (state.fleet.expedition && !PLANET_BY_ID[state.fleet.expedition.targetId]) {
    state.fleet.expedition = null;
  }

  return state;
}

export function loadState(storage = localStorage, now = Date.now()) {
  try {
    const serialized = storage.getItem(SAVE_KEY);
    if (!serialized) {
      return createDefaultState(now);
    }
    return normalizeState(JSON.parse(serialized), now);
  } catch (error) {
    const fallback = createDefaultState(now);
    fallback.loadFailed = true;
    fallback.loadError = error && error.message ? error.message : '存档读取失败';
    return fallback;
  }
}

export function persistState(state, storage = localStorage) {
  try {
    const safeState = clone(state);
    delete safeState.loadFailed;
    delete safeState.loadError;
    safeState.lastSavedAt = Date.now();
    storage.setItem(SAVE_KEY, JSON.stringify(safeState));
    return { ok: true, savedAt: safeState.lastSavedAt };
  } catch (error) {
    return {
      ok: false,
      message: error && error.message ? error.message : '存档写入失败',
    };
  }
}

export function resetSavedState(storage = localStorage) {
  try {
    storage.removeItem(SAVE_KEY);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error && error.message ? error.message : '重置失败',
    };
  }
}

function makeEventInstance(state, template, now) {
  let planetId = null;
  if (template.requiresPlanet) {
    planetId = template.requiresPlanet;
  } else {
    const owned = PLANETS.filter((planet) => state.planets[planet.id].owner === 'player');
    if (owned.length > 0) {
      planetId = owned[state.eventCursor % owned.length].id;
    }
  }

  return {
    id: `event-${now}-${state.eventCursor}`,
    templateId: template.id,
    source: template.source,
    title: template.title,
    body: template.body,
    planetId,
    createdAt: now,
    options: clone(template.options),
  };
}

function eligibleEventTemplates(state) {
  return EVENT_TEMPLATES.filter((template) => {
    if (!template.requiresPlanet) return true;
    return state.planets[template.requiresPlanet] &&
      state.planets[template.requiresPlanet].owner === 'player';
  });
}

function addEvent(state, now, templateId = null) {
  if (state.pendingEvents.length >= 3) return null;
  const eligible = eligibleEventTemplates(state);
  if (eligible.length === 0) return null;

  let template = null;
  if (templateId) {
    template = eligible.find((item) => item.id === templateId) || null;
  }
  if (!template) {
    const start = state.eventCursor % eligible.length;
    for (let offset = 0; offset < eligible.length; offset += 1) {
      const candidate = eligible[(start + offset) % eligible.length];
      const isDuplicate = state.pendingEvents.some((event) => event.templateId === candidate.id);
      if (!isDuplicate) {
        template = candidate;
        break;
      }
    }
  }
  if (!template) template = eligible[state.eventCursor % eligible.length];

  const event = makeEventInstance(state, template, now);
  state.pendingEvents.push(event);
  state.eventCursor += 1;
  return event;
}

export function startGame(inputState, planetId, now = Date.now()) {
  const current = nowValue(now);
  const planet = PLANET_BY_ID[planetId];
  if (!planet || planet.page !== 1 || planet.originOwner !== 'unowned') {
    return { ok: false, state: inputState, message: '只能从三颗开局行星中选择一颗。' };
  }

  const state = clone(inputState);
  state.started = true;
  state.startedAt = current;
  state.selectedStartId = planetId;
  state.planets[planetId].owner = 'player';
  state.planets[planetId].occupiedAt = current;
  state.lastClaimAt = current - CYCLE_MS;
  state.nextEventAt = current + nextEventDelay();
  state.lastTickerAt = current;
  state.ticker = {
    kind: 'good',
    text: `殖民协议生效。${planet.name} 已接入舰队网络。`,
    at: current,
  };
  state.pendingEvents = [];
  state.eventCursor = 0;
  addEvent(state, current, 'star-core-escort');

  return { ok: true, state, message: `${planet.name} 殖民地已建立。` };
}

export function getAvailableShips(state) {
  return Math.max(0, state.resources.ships - state.fleet.damaged);
}

export function getOwnedPlanets(state) {
  return PLANETS.filter((planet) => state.planets[planet.id].owner === 'player');
}

export function getHighestResearch(state) {
  const owned = getOwnedPlanets(state);
  if (owned.length === 0) return 0;
  return Math.max(...owned.map((planet) => state.planets[planet.id].research));
}

export function getResearchCostFactor(state) {
  return Math.max(
    RESEARCH_COST_FLOOR,
    1 - getHighestResearch(state) * RESEARCH_COST_PER_POINT,
  );
}

export function getBuildCost(state) {
  const factor = getResearchCostFactor(state);
  return {
    population: Math.max(1, Math.round(30 * factor)),
    energy: Math.max(1, Math.round(40 * factor)),
    alloy: Math.max(1, Math.round(20 * factor)),
  };
}

export function getRepairCost(state) {
  const factor = getResearchCostFactor(state);
  return {
    population: Math.max(1, Math.round(5 * factor)),
    energy: Math.max(1, Math.round(10 * factor)),
    alloy: Math.max(1, Math.round(12 * factor)),
  };
}

function canAfford(resources, cost) {
  return Object.keys(cost).every((key) => resources[key] >= cost[key]);
}

function deduct(resources, cost) {
  Object.keys(cost).forEach((key) => {
    resources[key] = Math.max(0, resources[key] - cost[key]);
  });
}

export function buildShips(inputState) {
  const state = clone(inputState);
  const cost = getBuildCost(state);
  if (state.fleet.maintenanceOverdue) {
    return { ok: false, state: inputState, message: '维护资源不足，建造已锁定。先领取产出。' };
  }
  if (!canAfford(state.resources, cost)) {
    return { ok: false, state: inputState, message: '人口、能源或合金不足，无法建造。' };
  }

  deduct(state.resources, cost);
  state.resources.ships += BUILD_BATCH;
  return {
    ok: true,
    state,
    message: `建造完成：舰船 +${BUILD_BATCH}`,
    cost,
  };
}

export function repairShips(inputState) {
  const state = clone(inputState);
  if (state.fleet.damaged <= 0) {
    return { ok: false, state: inputState, message: '当前没有战损舰船。' };
  }

  const cost = getRepairCost(state);
  if (state.fleet.maintenanceOverdue) {
    return { ok: false, state: inputState, message: '维护资源不足，维修已锁定。先领取产出。' };
  }
  if (!canAfford(state.resources, cost)) {
    return { ok: false, state: inputState, message: '人口、能源或合金不足，无法维修。' };
  }

  const repaired = Math.min(REPAIR_BATCH, state.fleet.damaged);
  deduct(state.resources, cost);
  state.fleet.damaged -= repaired;
  return {
    ok: true,
    state,
    message: `维修完成：可出征舰船 +${repaired}`,
    repaired,
    cost,
  };
}

export function colonizePlanet(inputState, planetId, now = Date.now()) {
  const state = clone(inputState);
  const planet = PLANET_BY_ID[planetId];
  const required = planet ? planet.colonizationShips : null;

  if (!planet || planet.originOwner !== 'unowned') {
    return { ok: false, state: inputState, message: '该行星不能直接殖民。' };
  }
  if (state.planets[planetId].owner === 'player') {
    return { ok: false, state: inputState, message: '该行星已经在你的控制之下。' };
  }
  if (state.fleet.expedition) {
    return { ok: false, state: inputState, message: '远征舰队仍在航线上。' };
  }

  const available = getAvailableShips(state);
  if (available < required) {
    return {
      ok: false,
      state: inputState,
      message: `至少需要 ${required} 艘可用舰船才能殖民。`,
    };
  }

  const lostShips = required;
  state.planets[planetId].owner = 'player';
  state.planets[planetId].stability = 45;
  state.planets[planetId].occupiedAt = nowValue(now);
  state.resources.ships = Math.max(0, state.resources.ships - required);

  const allOwned = PLANETS.every((item) => state.planets[item.id].owner === 'player');
  if (allOwned && !state.completedAt) state.completedAt = nowValue(now);

  return {
    ok: true,
    state,
    required,
    lostShips,
    message: `殖民完成：${planet.name} 已接入。${required} 艘殖民舰队全部损耗。`,
  };
}

export function getStabilityMultiplier(stability) {
  return clamp(
    STABILITY_MULTIPLIER_MIN + stability * STABILITY_MULTIPLIER_PER_POINT,
    STABILITY_MULTIPLIER_MIN,
    STABILITY_MULTIPLIER_MAX,
  );
}

export function getClaimWindow(state, now = Date.now()) {
  const current = nowValue(now);
  const elapsed = Math.max(0, current - state.lastClaimAt);
  const elapsedMs = Math.min(elapsed, MAX_OFFLINE_MS);
  return {
    elapsedMs,
    remainingMs: Math.max(0, MAX_OFFLINE_MS - elapsedMs),
    nextClaimMs: Math.max(0, AUTO_CLAIM_INTERVAL_MS - elapsed),
    progress: Math.min(elapsedMs / CYCLE_MS, 1),
    ready: state.started && elapsed >= AUTO_CLAIM_INTERVAL_MS,
  };
}

export function getProjectedProduction(state, elapsedMs = CYCLE_MS) {
  const cycles = clamp(elapsedMs / CYCLE_MS, 0, MAX_OFFLINE_MS / CYCLE_MS);
  const rawProduction = { population: 0, energy: 0, alloy: 0 };

  getOwnedPlanets(state).forEach((planet) => {
    const planetState = state.planets[planet.id];
    const multiplier = getStabilityMultiplier(planetState.stability);
    rawProduction.population += planet.output.population * multiplier * cycles;
    rawProduction.energy += planet.output.energy * multiplier * cycles;
    rawProduction.alloy += planet.output.alloy * multiplier * cycles;
  });

  const production = {};
  RESOURCE_KEYS.forEach((key) => {
    production[key] = roundResourceAmount(rawProduction[key]);
  });

  const rawMaintenance = {
    population: (state.resources.ships / 100) * 3 * cycles,
    energy: (state.resources.ships / 100) * 6 * cycles,
    alloy: (state.resources.ships / 100) * 5 * cycles,
  };

  const maintenance = {
    population: roundResourceAmount(rawMaintenance.population),
    energy: roundResourceAmount(rawMaintenance.energy),
    alloy: roundResourceAmount(rawMaintenance.alloy),
  };

  return { production, rawProduction, maintenance, rawMaintenance, cycles };
}

export function claimAll(inputState, now = Date.now()) {
  const current = nowValue(now);
  const state = clone(inputState);
  const window = getClaimWindow(state, current);
  if (!state.started) {
    return { ok: false, state: inputState, message: '先建立第一座殖民地。' };
  }
  if (!window.ready) {
    return { ok: false, state: inputState, message: '本周期产出尚未形成，请稍后再领取。' };
  }

  const projected = getProjectedProduction(state, window.elapsedMs);
  const added = {};
  const nextProductionCarry = emptyResourceCarry();
  RESOURCE_KEYS.forEach((key) => {
    const total = projected.rawProduction[key] + state.claimCarry.production[key];
    added[key] = roundResourceAmount(total);
    nextProductionCarry[key] = total - added[key];
    state.resources[key] += added[key];
  });

  let maintenanceShortage = false;
  const maintenance = {};
  const nextMaintenanceCarry = emptyResourceCarry();
  RESOURCE_KEYS.forEach((key) => {
    const total = projected.rawMaintenance[key] + state.claimCarry.maintenance[key];
    const due = roundResourceAmount(total);
    maintenance[key] = due;
    nextMaintenanceCarry[key] = total - due;
    if (state.resources[key] < due) maintenanceShortage = true;
    state.resources[key] = Math.max(0, state.resources[key] - due);
  });
  state.fleet.maintenanceOverdue = maintenanceShortage;
  state.claimCarry = {
    production: nextProductionCarry,
    maintenance: nextMaintenanceCarry,
  };
  state.lastClaimAt = current;

  return {
    ok: true,
    state,
    added,
    maintenance,
    cycles: projected.cycles,
    maintenanceShortage,
    message: maintenanceShortage ? '产出已领取，但维护资源不足。' : '本轮行星产出已领取。',
  };
}

export function getTravelSeconds(state, targetPlanet) {
  if (targetPlanet.page === 4) return 15;
  const owned = getOwnedPlanets(state);
  const homePage = owned.length
    ? Math.max(...owned.map((planet) => planet.page))
    : 1;
  const distance = Math.abs(targetPlanet.page - homePage);
  return distance <= 1 ? 5 : 10;
}

export function getMaxInvestment(state) {
  return Math.max(
    0,
    Math.min(
      getAvailableShips(state),
      Math.floor(state.resources.population),
      Math.floor(state.resources.energy),
      Math.floor(state.resources.alloy),
    ),
  );
}

export function getEstimatedWinChance(target, investment) {
  const recommended = Math.max(1, target.recommended || 1);
  const ratio = investment / recommended;
  if (investment <= 0 || ratio < 0.5) return 0;
  if (ratio < 0.85) {
    return Math.round((0.1 + ((ratio - 0.5) / 0.35) * 0.4) * 100);
  }
  if (ratio <= 1.15) {
    return Math.round((0.5 + ((ratio - 0.85) / 0.3) * 0.35) * 100);
  }
  if (ratio < 1.2) {
    return Math.round((0.85 + ((ratio - 1.15) / 0.05) * 0.15) * 100);
  }
  return 100;
}

function computeBattleResult(state, target, investment, now) {
  const available = getAvailableShips(state);
  const recommended = target.recommended;
  const ratio = investment / Math.max(1, recommended);
  const winChance = getEstimatedWinChance(target, investment);
  const roll = Math.random() * 100;
  let lossRate = 0.18;
  let cgType = 'stalemate';
  let outcomeType = 'close-defeat';
  let won = false;
  let title = '惜败';
  let text = '双方舰列在行星轨道交错，舰队最终被迫撤退。';

  if (ratio < 0.5) {
    lossRate = state.fleet.maintenanceOverdue ? 0.3 : 0.28;
    cgType = 'defeat';
    outcomeType = 'crushing-defeat';
    title = '大败';
    text = '投入舰队不足，阵形被防御阵列截断，残存舰船被迫撤回。';
  } else if (ratio >= 1.5) {
    lossRate = 0.04;
    cgType = 'victory';
    outcomeType = 'great-victory';
    won = true;
    title = '大胜';
    text = '绝对规模优势压穿行星防线，舰队以极小损失完成接管。';
  } else if (roll < winChance) {
    won = true;
    outcomeType = ratio >= 1.15 ? 'advantage-victory' : 'close-victory';
    title = ratio >= 1.15 ? '胜利' : '险胜';
    cgType = ratio >= 1.15 ? 'victory' : 'stalemate';
    lossRate = ratio >= 1.15 ? 0.08 : 0.12;
    text = ratio >= 1.15
      ? '舰队在相持后撕开防线，行星防御环逐层熄灭。'
      : '双方舰列交错，防线在最后阶段出现缺口，行星已被接管。';
  }

  const lostShips = Math.min(
    investment,
    Math.max(investment > 0 ? 1 : 0, Math.round(investment * lossRate)),
  );

  return {
    id: `battle-${now}-${target.id}`,
    targetId: target.id,
    targetName: target.name,
    availableShips: available,
    investment,
    recommended,
    estimatedWinChance: winChance,
    chanceRoll: roll,
    durationSeconds: getTravelSeconds(state, target),
    cgType,
    outcomeType,
    won,
    title,
    text,
    lossRate,
    lostShips,
    startedAt: now,
    arrivedAt: now + getTravelSeconds(state, target) * 1000,
    applied: false,
  };
}

export function startExpedition(inputState, targetId, investment, now = Date.now()) {
  const current = nowValue(now);
  const target = PLANET_BY_ID[targetId];
  const state = clone(inputState);

  if (!target || !target.hostile) {
    return { ok: false, state: inputState, message: '该行星不是可攻击目标。' };
  }
  if (state.planets[targetId].owner === 'player') {
    return { ok: false, state: inputState, message: '该行星已经在你的控制之下。' };
  }
  if (state.fleet.expedition) {
    return { ok: false, state: inputState, message: '远征舰队仍在航线上。' };
  }
  if (!state.started) {
    return { ok: false, state: inputState, message: '先建立第一座殖民地。' };
  }

  const selectedInvestment = Math.max(0, Math.round(toSafeNumber(investment, 0)));
  const maxInvestment = getMaxInvestment(state);
  if (selectedInvestment > maxInvestment) {
    return {
      ok: false,
      state: inputState,
      message: `当前最多投入 ${maxInvestment} 点远征资源。`,
    };
  }

  const preCheck = computeBattleResult(state, target, selectedInvestment, current);
  const cost = {
    population: selectedInvestment,
    energy: selectedInvestment,
    alloy: selectedInvestment,
  };
  deduct(state.resources, cost);
  state.fleet.expedition = preCheck;

  return {
    ok: true,
    state,
    expedition: preCheck,
    cost,
    message: `舰队已出发，预计 ${preCheck.durationSeconds} 秒后抵达。`,
  };
}

function applyBattleResult(state, result) {
  const finalResult = clone(result);
  finalResult.applied = true;
  state.fleet.damaged = clamp(
    state.fleet.damaged + finalResult.lostShips,
    0,
    state.resources.ships,
  );

  if (finalResult.won) {
    const targetPlanetState = state.planets[finalResult.targetId];
    const target = PLANET_BY_ID[finalResult.targetId];
    targetPlanetState.owner = 'player';
    targetPlanetState.stability = 45;
    targetPlanetState.occupiedAt = finalResult.arrivedAt;

    if (target.originOwner === 'starCore') {
      state.relations.starCore = normalizeRelation(state.relations.starCore - 10);
    }
    if (target.originOwner === 'heavyWall') {
      state.relations.heavyWall = normalizeRelation(state.relations.heavyWall - 10);
    }

    const allOwned = PLANETS.every((planet) => state.planets[planet.id].owner === 'player');
    if (allOwned && !state.completedAt) state.completedAt = finalResult.arrivedAt;
  }

  state.lastBattleResult = finalResult;
  state.battleHistory.unshift(finalResult);
  state.battleHistory = state.battleHistory.slice(0, 12);
  state.fleet.expedition = null;
}

export function reconcileState(inputState, now = Date.now()) {
  const current = nowValue(now);
  const state = clone(inputState);
  let arrived = false;
  let changed = false;

  if (state.fleet.expedition && current >= state.fleet.expedition.arrivedAt) {
    applyBattleResult(state, state.fleet.expedition);
    arrived = true;
    changed = true;
  }

  if (state.started) {
    if (state.pendingEvents.length < 3) {
      if (!Number.isFinite(state.nextEventAt) || state.nextEventAt <= 0) {
        state.nextEventAt = current + nextEventDelay();
      }
      let guard = 0;
      while (
        state.pendingEvents.length < 3 &&
        state.nextEventAt <= current &&
        guard < 3
      ) {
        const scheduledAt = state.nextEventAt;
        addEvent(state, scheduledAt);
        state.nextEventAt = scheduledAt + nextEventDelay();
        guard += 1;
        changed = true;
      }
    } else {
      state.nextEventAt = 0;
    }
  }

  return { state, arrived, changed };
}

export function acknowledgeBattleResult(inputState) {
  const state = clone(inputState);
  state.lastBattleResult = null;
  return state;
}

function applyResourceChange(state, changes) {
  if (!changes) return [];
  const lines = [];
  Object.keys(changes).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(state.resources, key)) return;
    const requested = Math.round(toSafeNumber(changes[key], 0));
    const before = state.resources[key];
    state.resources[key] = Math.max(0, before + requested);
    const actual = state.resources[key] - before;
    lines.push(`${key === 'ships' ? '舰船' : key}${actual >= 0 ? '+' : ''}${actual}`);
  });
  return lines;
}

function addResearch(state, planetId, amount) {
  if (!planetId || !state.planets[planetId]) return '';
  const planetState = state.planets[planetId];
  const before = planetState.research;
  planetState.research = clamp(before + Math.max(0, Math.round(amount)), 0, 100);
  return `${PLANET_BY_ID[planetId].name} 科研值 +${planetState.research - before}`;
}

export function chooseEvent(inputState, eventId, optionIndex, now = Date.now()) {
  const state = clone(inputState);
  const event = state.pendingEvents.find((item) => item.id === eventId);
  if (!event) {
    return { ok: false, state: inputState, message: '该邮件已经处理。' };
  }
  const option = event.options[optionIndex];
  if (!option) {
    return { ok: false, state: inputState, message: '请选择一个明确选项。' };
  }

  const effects = option.effects || {};
  const resultLines = [];

  if (effects.resources) {
    Object.keys(effects.resources).forEach((key) => {
      const requested = Math.round(effects.resources[key]);
      const before = state.resources[key];
      state.resources[key] = Math.max(0, before + requested);
      const actual = state.resources[key] - before;
      const label = key === 'population' ? '人口' : key === 'energy' ? '能源' : '合金';
      resultLines.push(`${label} ${actual >= 0 ? '+' : ''}${actual}`);
    });
  }

  if (effects.relation) {
    Object.keys(effects.relation).forEach((factionId) => {
      const delta = Math.round(effects.relation[factionId]);
      state.relations[factionId] = normalizeRelation(state.relations[factionId] + delta);
      resultLines.push(`${FACTIONS[factionId].shortName}好感 ${delta >= 0 ? '+' : ''}${delta}`);
    });
  }

  if (effects.stability && event.planetId && state.planets[event.planetId]) {
    const delta = Math.round(effects.stability);
    const planetState = state.planets[event.planetId];
    planetState.stability = clamp(planetState.stability + delta, 0, 100);
    resultLines.push(`${PLANET_BY_ID[event.planetId].name} 稳定 ${delta >= 0 ? '+' : ''}${delta}`);
  }

  if (effects.research && event.planetId && state.planets[event.planetId]) {
    resultLines.push(addResearch(state, event.planetId, effects.research));
  }

  state.pendingEvents = state.pendingEvents.filter((item) => item.id !== eventId);
  state.nextEventAt = nowValue(now) + nextEventDelay();

  return {
    ok: true,
    state,
    message: resultLines.length ? resultLines.join(' / ') : '邮件已处理。',
    resultLines,
  };
}

export function getTradeQuote(state, offerId) {
  const offer = TRADE_OFFERS.find((item) => item.id === offerId);
  if (!offer) return null;
  const relation = normalizeRelation(state.relations[offer.faction]);
  const factor = 1 - relation / TRADE_RELATION_DIVISOR;
  const required = Math.ceil(offer.give.amount * factor);
  return {
    ...offer,
    relation,
    factor,
    required,
  };
}

export function tradeResources(inputState, offerId) {
  const state = clone(inputState);
  const quote = getTradeQuote(state, offerId);
  if (!quote) {
    return { ok: false, state: inputState, message: '该贸易报价不存在。' };
  }
  if (state.resources[quote.give.resource] < quote.required) {
    return { ok: false, state: inputState, message: '支付资源不足。' };
  }

  state.resources[quote.give.resource] -= quote.required;
  state.resources[quote.receive.resource] += quote.receive.amount;
  return {
    ok: true,
    state,
    message: `交换完成：${quote.give.resource === 'population' ? '人口' : quote.give.resource === 'energy' ? '能源' : '合金'} -${quote.required}，${quote.receive.resource === 'population' ? '人口' : quote.receive.resource === 'energy' ? '能源' : '合金'} +${quote.receive.amount}`,
  };
}

export function returnColony(inputState, planetId) {
  const planet = PLANET_BY_ID[planetId];
  const state = clone(inputState);
  if (!planet || planet.originOwner === 'unowned') {
    return { ok: false, state: inputState, message: '该行星不属于可归还的 NPC 殖民地。' };
  }
  if (state.planets[planetId].owner !== 'player') {
    return { ok: false, state: inputState, message: '该行星尚未被占领。' };
  }

  state.planets[planetId].owner = planet.originOwner;
  state.planets[planetId].stability = planet.stability;
  state.planets[planetId].occupiedAt = null;
  if (planet.originOwner === 'starCore') {
    state.relations.starCore = normalizeRelation(state.relations.starCore + 10);
  }
  if (planet.originOwner === 'heavyWall') {
    state.relations.heavyWall = normalizeRelation(state.relations.heavyWall + 10);
  }
  if (state.selectedStartId === planetId) {
    state.selectedStartId = null;
  }
  return {
    ok: true,
    state,
    message: `${planet.name} 已归还 ${FACTIONS[planet.originOwner].name}，好感 +10。`,
  };
}

function applyTickerEffect(state, template) {
  if (!template.effect) return '';
  const resource = template.effect.resource;
  const resultParts = [];
  if (resource) {
    const before = state.resources[resource];
    let requested = template.effect.requested;
    if (template.effect.cappedAtOnePercent) {
      const cap = Math.max(1, Math.min(10, Math.floor(before * 0.01)));
      requested = requested < 0 ? -cap : cap;
    }
    state.resources[resource] = Math.max(0, before + requested);
    const actual = state.resources[resource] - before;
    const label = resource === 'population' ? '人口' : resource === 'energy' ? '能源' : '合金';
    resultParts.push(`${actual >= 0 ? '[' : '[!]'} ${label} ${actual >= 0 ? '+' : ''}${actual}`);
  }

  if (template.effect.research) {
    const owned = getOwnedPlanets(state);
    const target = owned.reduce((best, planet) => {
      if (!best) return planet;
      const research = state.planets[planet.id].research;
      const bestResearch = state.planets[best.id].research;
      return research > bestResearch ? planet : best;
    }, null);
    if (target) {
      const amount = Math.max(0, Math.round(template.effect.research));
      resultParts.push(`[+] ${addResearch(state, target.id, amount)}`);
    }
  }

  if (template.effect.stability) {
    const owned = getOwnedPlanets(state);
    const target = owned.reduce((lowest, planet) => {
      if (!lowest) return planet;
      const stability = state.planets[planet.id].stability;
      const lowestStability = state.planets[lowest.id].stability;
      return stability < lowestStability ? planet : lowest;
    }, null);
    if (target) {
      const amount = Math.max(0, Math.round(template.effect.stability));
      const before = state.planets[target.id].stability;
      state.planets[target.id].stability = clamp(before + amount, 0, 100);
      const actual = state.planets[target.id].stability - before;
      resultParts.push(`[+] ${target.name} 稳定 +${actual}`);
    }
  }

  return resultParts.join(' ');
}

export function maybeAdvanceTicker(inputState, now = Date.now()) {
  const current = nowValue(now);
  const state = clone(inputState);
  if (!state.started) return { state, advanced: false };
  if (current - state.lastTickerAt < MINUTE_MS) return { state, advanced: false };

  const template = TICKER_TEMPLATES[state.tickerCursor % TICKER_TEMPLATES.length];
  state.tickerCursor += 1;
  const effectText = applyTickerEffect(state, template);
  state.ticker = {
    kind: template.kind,
    text: effectText ? `${template.text} ${effectText}` : template.text,
    at: current,
  };
  state.lastTickerAt = current;
  return { state, advanced: true };
}

export function getPlanetStatus(planet, planetState) {
  if (!planetState) return '未知';
  if (planetState.owner === 'player') {
    return '己方';
  }
  if (planetState.owner === 'unowned') return '无阵营';
  return FACTIONS[planetState.owner] ? FACTIONS[planetState.owner].shortName : '未知';
}

export function getResultLabel(result) {
  if (!result) return '';
  return `${result.title} / ${result.won ? '占领成功' : '远征失败'}`;
}

export function makeBattleWords(result) {
  if (!result) return [];
  return [
    `目标 ${result.targetName}`,
    `投入 ${result.investment} / 推荐 ${result.recommended}`,
    `出征舰船 ${result.availableShips}`,
    `战损 ${result.lostShips} 舰`,
  ];
}

