import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeBattleResult,
  buildShips,
  claimAll,
  colonizePlanet,
  createDefaultState,
  getAvailableShips,
  getBuildCost,
  getClaimWindow,
  getColonyUpkeepMultiplier,
  getColonyUpkeepRate,
  getEstimatedWinChance,
  getResearchCostFactor,
  getHighestResearch,
  getMaxInvestment,
  getRepairCost,
  getStabilityMultiplier,
  getTradeQuote,
  AUTO_CLAIM_INTERVAL_MS,
  EVENT_TEMPLATES,
  MAX_OFFLINE_MS,
  PLANETS,
  TICKER_TEMPLATES,
  chooseEvent,
  loadState,
  maybeAdvanceTicker,
  normalizeState,
  persistState,
  reconcileState,
  returnColony,
  setColonyUpkeepEnabled,
  startExpedition,
  startGame,
} from '../game/engine.js';

const START = Date.UTC(2026, 10, 20, 2, 0, 0);

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function startTide() {
  const result = startGame(createDefaultState(START), 'tide-3', START);
  assert.equal(result.ok, true);
  return result.state;
}

function buildToGate(state, now) {
  let current = claimAll(state, now).state;
  let nextClaimAt = now;
  while (current.resources.ships < 110) {
    const built = buildShips(current);
    if (built.ok) {
      current = built.state;
      continue;
    }
    nextClaimAt += 31 * 60 * 1000;
    const claimed = claimAll(current, nextClaimAt);
    assert.equal(claimed.ok, true);
    current = claimed.state;
  }
  return current;
}

function buildToShips(state, targetShips, now) {
  let current = claimAll(state, now).state;
  while (current.resources.ships < targetShips) {
    const built = buildShips(current);
    assert.equal(built.ok, true);
    current = built.state;
  }
  return current;
}

function fundCampaign(state) {
  state.resources.population += 1000;
  state.resources.energy += 1000;
  state.resources.alloy += 1000;
  return state;
}

test('new game starts with one colony, one mail, and a claimable cycle', () => {
  const state = startTide();
  assert.equal(state.started, true);
  assert.equal(state.planets['tide-3'].owner, 'player');
  assert.deepEqual(state.resources, {
    population: 137,
    energy: 190,
    alloy: 127,
    ships: 10,
  });
  assert.equal(state.pendingEvents.length, 1);
  assert.equal(state.relations.starCore, 50);
  assert.equal(state.relations.heavyWall, 50);
  assert.equal(getClaimWindow(state, START).ready, true);
});

test('faction relations use the current zero-to-one-hundred range', () => {
  const state = createDefaultState(START);
  const normalized = normalizeState({
    ...state,
    relations: {
      starCore: -10,
      heavyWall: 120,
    },
  }, START);

  assert.equal(normalized.relations.starCore, 0);
  assert.equal(normalized.relations.heavyWall, 100);
});

test('legacy science levels migrate to the single zero-to-one-hundred research value', () => {
  const state = createDefaultState(START);
  const raw = structuredClone(state);
  delete raw.planets['tide-3'].research;
  raw.planets['tide-3'].science = 3;
  raw.planets['tide-3'].scienceProgress = 40;

  const normalized = normalizeState(raw, START);
  assert.equal(normalized.planets['tide-3'].research, 60);
  assert.equal('science' in normalized.planets['tide-3'], false);
  assert.equal('scienceProgress' in normalized.planets['tide-3'], false);
});

test('hostile planets no longer carry fleet levels', () => {
  assert.equal(PLANETS.filter((planet) => planet.hostile).length, 7);
  assert.ok(PLANETS.every((planet) => !('enemyLevel' in planet)));
});

test('stability now scales planet output from sixty to one hundred forty percent', () => {
  assert.equal(getStabilityMultiplier(0), 0.6);
  assert.equal(getStabilityMultiplier(50), 1);
  assert.equal(getStabilityMultiplier(100), 1.4);
});

test('colony upkeep is enabled by default and scales inversely with stability', () => {
  const state = startTide();
  assert.equal(state.settings.colonyUpkeepEnabled, true);
  assert.equal(getColonyUpkeepMultiplier(0), 1.4);
  assert.equal(getColonyUpkeepMultiplier(50), 1);
  assert.ok(Math.abs(getColonyUpkeepMultiplier(100) - 0.6) < 0.000001);

  const unstable = getColonyUpkeepRate(20);
  const stable = getColonyUpkeepRate(80);
  assert.ok(unstable.raw.population > stable.raw.population);
  assert.ok(unstable.raw.energy > stable.raw.energy);
  assert.ok(unstable.raw.alloy > stable.raw.alloy);

  const disabled = setColonyUpkeepEnabled(state, false);
  assert.equal(disabled.settings.colonyUpkeepEnabled, false);
  assert.equal(
    normalizeState(disabled, START).settings.colonyUpkeepEnabled,
    false,
  );
});

test('research value and goodwill now materially reduce build and trade costs', () => {
  const state = startTide();
  state.planets['tide-3'].research = 100;

  assert.ok(Math.abs(getResearchCostFactor(state) - 0.68) < 0.000001);
  assert.deepEqual(getBuildCost(state), { population: 20, energy: 27, alloy: 14 });
  assert.deepEqual(getRepairCost(state), { population: 3, energy: 7, alloy: 8 });

  const initialQuote = getTradeQuote(state, 'core-energy-for-people');
  assert.ok(Math.abs(initialQuote.factor - 0.8) < 0.000001);
  assert.equal(initialQuote.required, 32);

  state.relations.starCore = 100;
  const trustedQuote = getTradeQuote(state, 'core-energy-for-people');
  assert.ok(Math.abs(trustedQuote.factor - 0.6) < 0.000001);
  assert.equal(trustedQuote.required, 24);
});

test('initial inventory can expand to about ninety ships before claiming', () => {
  let state = startTide();
  while (true) {
    const built = buildShips(state);
    if (!built.ok) break;
    state = built.state;
  }
  assert.equal(state.resources.ships, 90);
});

test('auto claims become ready every ten seconds and accrue one-sixth minute of production', () => {
  const state = startTide();
  state.lastClaimAt = START;

  assert.equal(getClaimWindow(state, START + AUTO_CLAIM_INTERVAL_MS - 1).ready, false);
  const window = getClaimWindow(state, START + AUTO_CLAIM_INTERVAL_MS);
  assert.equal(window.ready, true);
  assert.equal(window.nextClaimMs, 0);

  const result = claimAll(state, START + AUTO_CLAIM_INTERVAL_MS);
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.cycles - 1 / 6) < 0.000001);
  assert.deepEqual(result.added, { population: 7, energy: 7, alloy: 3 });
  assert.deepEqual(result.maintenance, { population: 0, energy: 0, alloy: 0 });

  let rolling = state;
  const totalAdded = { population: 0, energy: 0, alloy: 0 };
  const totalMaintenance = { population: 0, energy: 0, alloy: 0 };
  for (let index = 1; index <= 6; index += 1) {
    const claim = claimAll(rolling, START + index * AUTO_CLAIM_INTERVAL_MS);
    assert.equal(claim.ok, true);
    rolling = claim.state;
    Object.keys(totalAdded).forEach((key) => {
      totalAdded[key] += claim.added[key];
      totalMaintenance[key] += claim.maintenance[key];
    });
  }
  assert.deepEqual(totalAdded, { population: 39, energy: 45, alloy: 20 });
  assert.deepEqual(totalMaintenance, { population: 2, energy: 4, alloy: 3 });
});

test('offline accumulation is capped and colony upkeep is deducted during normal settlement', () => {
  const state = startTide();
  const result = claimAll(state, START + 3 * 60 * 60 * 1000);
  assert.equal(result.ok, true);
  assert.equal(result.cycles, MAX_OFFLINE_MS / (60 * 1000));
  assert.deepEqual(result.added, { population: 1176, energy: 1344, alloy: 605 });
  assert.deepEqual(result.colonyMaintenance, { population: 53, energy: 79, alloy: 53 });
  assert.deepEqual(result.fleetMaintenance, { population: 9, energy: 18, alloy: 15 });
  assert.deepEqual(result.maintenance, { population: 62, energy: 97, alloy: 68 });

  const withoutColonyUpkeep = setColonyUpkeepEnabled(state, false);
  const disabledResult = claimAll(withoutColonyUpkeep, START + 3 * 60 * 60 * 1000);
  assert.equal(disabledResult.colonyUpkeepEnabled, false);
  assert.deepEqual(disabledResult.colonyMaintenance, { population: 0, energy: 0, alloy: 0 });
  assert.deepEqual(disabledResult.maintenance, { population: 9, energy: 18, alloy: 15 });
});

test('five builds reach the first hostile target recommendation', () => {
  const state = buildToGate(startTide(), START);
  assert.equal(state.resources.ships, 110);
  assert.equal(getAvailableShips(state), 110);
});

test('remaining unowned planets lose exactly the required colonization fleet', () => {
  let state = claimAll(startTide(), START).state;
  let built = buildShips(state);
  assert.equal(built.ok, true);
  state = built.state;
  built = buildShips(state);
  assert.equal(built.ok, true);
  state = built.state;
  assert.equal(getAvailableShips(state), 50);

  const firstColony = colonizePlanet(state, 'red-sand-9', START + 1000);
  assert.equal(firstColony.ok, true);
  assert.equal(firstColony.state.planets['red-sand-9'].owner, 'player');
  assert.equal(firstColony.lostShips, 40);
  assert.equal(firstColony.state.resources.ships, 10);
  assert.equal(firstColony.state.fleet.damaged, 0);

  let nextCycle = claimAll(firstColony.state, START + 31 * 60 * 1000).state;
  built = buildShips(nextCycle);
  assert.equal(built.ok, true);
  nextCycle = buildShips(built.state).state;
  assert.equal(getAvailableShips(nextCycle), 50);

  const secondColony = colonizePlanet(nextCycle, 'frost-ring-2', START + 32 * 60 * 1000);
  assert.equal(secondColony.ok, true);
  assert.equal(secondColony.state.planets['frost-ring-2'].owner, 'player');
  assert.equal(secondColony.lostShips, 40);
  assert.equal(secondColony.state.resources.ships, 10);
});

test('fleet costs and expedition cap stay within available ships', () => {
  const state = buildToGate(fundCampaign(startTide()), START);
  assert.deepEqual(getBuildCost(state), { population: 30, energy: 40, alloy: 20 });
  assert.deepEqual(getRepairCost(state), { population: 5, energy: 10, alloy: 12 });
  assert.equal(getMaxInvestment(state), 110);

  const before = { ...state.resources };
  const launched = startExpedition(state, 'moon-mirror-port', 110, START + 1000);
  assert.equal(launched.ok, true);
  assert.equal(launched.state.resources.population, before.population - 110);
  assert.equal(launched.state.resources.energy, before.energy - 110);
  assert.equal(launched.state.resources.alloy, before.alloy - 110);
});

test('great victory captures a planet, damages ships, and lowers faction relations', () => {
  const prepared = buildToShips(fundCampaign(startTide()), 200, START);
  const launched = startExpedition(prepared, 'moon-mirror-port', 150, START + 1000);
  assert.equal(launched.ok, true);
  assert.equal(launched.expedition.durationSeconds, 5);

  const arrived = reconcileState(launched.state, START + 7000);
  assert.equal(arrived.arrived, true);
  assert.equal(arrived.state.lastBattleResult.won, true);
  assert.equal(arrived.state.planets['moon-mirror-port'].owner, 'player');
  assert.equal(arrived.state.planets['moon-mirror-port'].stability, 45);
  assert.equal(arrived.state.fleet.damaged, 6);
  assert.equal(arrived.state.relations.starCore, 40);
  assert.equal(getHighestResearch(arrived.state), 50);
});

test('equal recommended investment uses the new sixty-eight percent estimate', () => {
  const prepared = fundCampaign(buildToShips(startTide(), 100, START));
  const target = { recommended: 100 };
  assert.equal(getEstimatedWinChance(target, 100), 68);

  const launched = startExpedition(prepared, 'moon-mirror-port', 100, START + 1000);
  const arrived = reconcileState(launched.state, START + 7000).state;
  assert.equal(arrived.lastBattleResult.estimatedWinChance, 68);
  assert.equal(arrived.lastBattleResult.cgType, 'stalemate');
  assert.ok(['险胜', '惜败'].includes(arrived.lastBattleResult.title));
});

test('win chance reaches eighty-five percent at 1.15 and one hundred at 1.2', () => {
  const target = { recommended: 100 };
  assert.equal(getEstimatedWinChance(target, 115), 85);
  assert.equal(getEstimatedWinChance(target, 120), 100);
});

test('battle result is unchanged when reopening after arrival', () => {
  const prepared = fundCampaign(buildToGate(startTide(), START));
  const launched = startExpedition(prepared, 'moon-mirror-port', 100, START + 1000);
  const firstArrival = reconcileState(launched.state, START + 7000);
  const firstResult = firstArrival.state.lastBattleResult;
  const reopened = reconcileState(firstArrival.state, START + 60_000);
  assert.deepEqual(reopened.state.lastBattleResult, firstResult);
});

test('save and load preserve the captured planet and battle result', () => {
  const prepared = buildToShips(fundCampaign(startTide()), 200, START);
  const launched = startExpedition(prepared, 'moon-mirror-port', 150, START + 1000);
  const arrived = reconcileState(launched.state, START + 7000).state;
  const storage = new MemoryStorage();
  assert.equal(persistState(arrived, storage).ok, true);

  const loaded = loadState(storage, START + 8000);
  assert.equal(loaded.planets['moon-mirror-port'].owner, 'player');
  assert.equal(loaded.lastBattleResult.targetId, 'moon-mirror-port');

  const acknowledged = acknowledgeBattleResult(loaded);
  assert.equal(acknowledged.lastBattleResult, null);
  assert.equal(acknowledged.planets['moon-mirror-port'].owner, 'player');
});

test('offline mailbox generation fills at most three slots', () => {
  const state = startTide();
  state.pendingEvents = [];
  state.nextEventAt = START - 10 * 60 * 1000;
  const reconciled = reconcileState(state, START);
  assert.equal(reconciled.state.pendingEvents.length, 3);
  assert.equal(reconciled.changed, true);
});

test('new mail templates add two faction decisions with their previewed effects', () => {
  assert.equal(EVENT_TEMPLATES.length, 6);
  const state = startTide();
  const template = EVENT_TEMPLATES.find((item) => item.id === 'hyper-signal-capsule');
  const eventId = 'test-hyper-capsule';
  state.pendingEvents = [{
    id: eventId,
    templateId: template.id,
    source: template.source,
    title: template.title,
    body: template.body,
    planetId: 'tide-3',
    createdAt: START,
    options: structuredClone(template.options),
  }];

  const archived = chooseEvent(state, eventId, 0, START + 1000);
  assert.equal(archived.ok, true);
  assert.equal(archived.state.resources.energy, 155);
  assert.equal(archived.state.planets['tide-3'].research, 20);
  assert.equal(archived.state.relations.starCore, 54);

  const convoy = EVENT_TEMPLATES.find((item) => item.id === 'luxun-convoy-passage');
  assert.ok(convoy);
  assert.equal(convoy.options.length, 2);
  assert.equal(convoy.options[0].effects.relation.heavyWall, 4);
  assert.equal(convoy.options[1].effects.resources.alloy, 25);
  assert.match(template.options[1].preview, /海帕 -2/);
});

test('new ticker pool separates small positive research and stability gains from neutral text', () => {
  assert.equal(TICKER_TEMPLATES.length, 11);
  const researchIndex = TICKER_TEMPLATES.findIndex((item) => item.id === 'research-transfer');
  const stabilityIndex = TICKER_TEMPLATES.findIndex((item) => item.id === 'stability-recovery');
  const plainIndexes = ['archive-sync', 'route-lamps']
    .map((id) => TICKER_TEMPLATES.findIndex((item) => item.id === id));

  const researchState = startTide();
  researchState.tickerCursor = researchIndex;
  const researchAdvanced = maybeAdvanceTicker(researchState, START + 60_000).state;
  assert.equal(researchAdvanced.resources.energy, researchState.resources.energy);
  assert.equal(researchAdvanced.resources.population, researchState.resources.population);
  assert.equal(researchAdvanced.resources.alloy, researchState.resources.alloy);
  assert.equal(researchAdvanced.planets['tide-3'].research, 2);

  const stabilityState = startTide();
  stabilityState.tickerCursor = stabilityIndex;
  const stabilityAdvanced = maybeAdvanceTicker(stabilityState, START + 60_000).state;
  assert.deepEqual(stabilityAdvanced.resources, stabilityState.resources);
  assert.equal(stabilityAdvanced.planets['tide-3'].stability, 67);
  assert.equal(stabilityAdvanced.planets['tide-3'].research, 0);

  plainIndexes.forEach((index) => {
    const neutralState = startTide();
    neutralState.tickerCursor = index;
    const before = structuredClone(neutralState);
    const neutralAdvanced = maybeAdvanceTicker(neutralState, START + 60_000).state;
    assert.deepEqual(neutralAdvanced.resources, before.resources);
    assert.deepEqual(neutralAdvanced.planets, before.planets);
  });
});

test('returning a captured colony restores ten relation points', () => {
  const prepared = buildToShips(fundCampaign(startTide()), 200, START);
  const launched = startExpedition(prepared, 'moon-mirror-port', 150, START + 1000);
  const arrived = reconcileState(launched.state, START + 7000).state;
  assert.equal(arrived.relations.starCore, 40);

  const returned = returnColony(arrived, 'moon-mirror-port');
  assert.equal(returned.ok, true);
  assert.equal(returned.state.planets['moon-mirror-port'].owner, 'starCore');
  assert.equal(returned.state.relations.starCore, 50);
});

test('undersized fleet produces a crushing defeat', () => {
  const state = startTide();
  const launched = startExpedition(state, 'moon-mirror-port', 10, START + 1000);
  const arrived = reconcileState(launched.state, START + 7000).state;
  assert.equal(arrived.lastBattleResult.cgType, 'defeat');
  assert.equal(arrived.lastBattleResult.won, false);
  assert.equal(arrived.planets['moon-mirror-port'].owner, 'starCore');
});

