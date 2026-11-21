import * as Game from '../game/engine.js';
import {
  FACTIONS,
  PLANETS,
  RESOURCE_LABELS,
  RESOURCE_SHORT_LABELS,
} from '../game/content.js';
import {
  clearPendingTap,
  DOUBLE_TAP_WINDOW_MS,
  findFocusIndex,
  moveFocusIndex,
  templeIntent,
} from '../interaction/temple.js';
import {
  GAZE_CONFIG,
  spatialMotionFromAngles,
} from '../interaction/gaze.js';

const PLANET_BY_ID = Object.fromEntries(PLANETS.map((planet) => [planet.id, planet]));
const PAGE_LABELS = {
  1: '殖民地',
  2: '前哨航路',
  3: '深空航段',
  4: '最终要塞',
};

const elements = {
  telemetry: document.querySelector('#telemetry'),
  resources: document.querySelector('#resources'),
  viewport: document.querySelector('#viewport'),
  control: document.querySelector('#control'),
  toast: document.querySelector('#toast'),
  app: document.querySelector('#app'),
  spatialDepth: document.querySelector('#spatial-depth'),
};

class NamespacedStorage {
  constructor(baseStorage, prefix) {
    this.baseStorage = baseStorage;
    this.prefix = prefix;
  }

  getItem(key) {
    return this.baseStorage.getItem(`${this.prefix}${key}`);
  }

  setItem(key, value) {
    this.baseStorage.setItem(`${this.prefix}${key}`, value);
  }

  removeItem(key) {
    this.baseStorage.removeItem(`${this.prefix}${key}`);
  }
}

function clearDemoStorageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('reset') !== '1') return;

  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === 'perseus-voyage.save.v1' || key.startsWith('perseus-voyage.preview-fresh.')) {
      keys.push(key);
    }
  }
  keys.forEach((key) => localStorage.removeItem(key));
  params.delete('reset');
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', nextUrl);
}

class DemoPreview {
  constructor() {
    clearDemoStorageFromUrl();
    this.storage = new URLSearchParams(window.location.search).has('fresh')
      ? new NamespacedStorage(localStorage, 'perseus-voyage.preview-fresh.v9.')
      : localStorage;
    this.game = Game.loadState(this.storage, Date.now());
    this.screen = 'boot';
    this.resumeScreen = 'overview';
    this.ambientTickerText = '深空中继在线';
    this.renderedTickerText = '';
    this.mapPage = 1;
    this.selectedPlanetId = '';
    this.activeEventId = '';
    this.selectedOptionIndex = -1;
    this.investment = 0;
    this.result = null;
    this.returnArmed = false;
    this.resetArmed = false;
    this.toastTimer = null;
    this.battleTimer = null;
    this.bootTimer = null;
    this.clockTimer = null;
    this.autosaveTimer = null;
    this.focusedKey = '';
    this.focusedIndex = -1;
    this.focusContext = '';
    this.spatialMode = new URLSearchParams(window.location.search).get('flat') !== '1';
    this.singleTapTimer = null;
    this.singleTapToken = 0;
    this.templeInputState = {
      lastTapSignalAt: 0,
      pendingTapAt: 0,
      tapDownAt: 0,
      lastBackSignalAt: 0,
      lastDirectionGesture: '',
      lastDirectionAt: 0,
    };
    this.initialize();
  }

  initialize() {
    const reconciled = Game.reconcileState(this.game, Date.now());
    this.game = reconciled.state;
    if (reconciled.changed) Game.persistState(this.game, this.storage);

    if (!this.game.started) {
      this.resumeScreen = 'opening';
    } else if (this.game.lastBattleResult) {
      this.result = this.game.lastBattleResult;
      this.resumeScreen = 'result';
    } else if (this.game.fleet.expedition) {
      this.resumeScreen = 'travel';
    } else {
      this.resumeScreen = 'overview';
    }

    elements.app.addEventListener('click', (event) => this.handleClick(event));
    elements.app.addEventListener('pointermove', (event) => this.updateSpatialFromPointer(event));
    elements.app.addEventListener('pointerleave', () => this.resetSpatialMotion());
    elements.viewport.addEventListener('pointermove', (event) => this.focusFromPointer(event));
    document.addEventListener('keydown', (event) => this.handlePreviewNod(event));
    document.addEventListener('keydown', (event) => this.handleTempleKey('down', event));
    document.addEventListener('keyup', (event) => this.handleTempleKey('up', event));
    window.addEventListener('pagehide', () => {
      if (this.autosaveTimer) {
        clearInterval(this.autosaveTimer);
        this.autosaveTimer = null;
      }
      if (this.game) Game.persistState(this.game, this.storage);
    });
    this.render();
    this.bootTimer = setTimeout(() => {
      this.screen = 'menu';
      this.render();
    }, 450);
    this.clockTimer = setInterval(() => this.tick(), 1000);
    this.autosaveTimer = setInterval(() => {
      if (this.game) Game.persistState(this.game, this.storage);
    }, 60 * 1000);
  }

  tick() {
    const now = Date.now();
    const reconciled = Game.reconcileState(this.game, now);
    this.game = reconciled.state;
    let shouldPersist = reconciled.changed;

    if (reconciled.arrived) {
      this.result = this.game.lastBattleResult;
      Game.persistState(this.game, this.storage);
      this.showBattle();
      return;
    }

    if (this.screen !== 'battle' && this.screen !== 'result') {
      const ticker = Game.maybeAdvanceTicker(this.game, now);
      this.game = ticker.state;
      if (ticker.advanced) {
        shouldPersist = true;
        this.ambientTickerText = this.game.ticker.text;
        this.renderedTickerText = '';
        this.renderHeader();
      }
    }

    if (this.autoHarvest(now).ok) {
      shouldPersist = true;
      this.render();
    }

    if (shouldPersist) Game.persistState(this.game, this.storage);
    this.updateLive();
  }

  updateLive() {
    const now = Date.now();
    const claim = Game.getClaimWindow(this.game, now);
    const harvestStatus = document.querySelector('#auto-harvest-status');
    if (harvestStatus) {
      harvestStatus.textContent = claim.ready
        ? '可结算产出等待自动入库'
        : `${Math.max(1, Math.ceil(claim.nextClaimMs / 1000))} 秒后自动收获`;
    }

    if (this.game.fleet.expedition) {
      const travel = this.buildTravelData(this.game.fleet.expedition, now);
      const seconds = document.querySelector('#travel-seconds');
      const progress = document.querySelector('#travel-progress');
      if (seconds) seconds.textContent = `${travel.secondsLeft} 秒`;
      if (progress) progress.textContent = `${travel.progress}%`;
    }
  }

  render() {
    this.renderSpatialMode();
    this.renderHeader();
    this.renderResources();
    this.renderViewport();
    this.refreshFocus();
  }

  renderSpatialMode() {
    elements.app.classList.toggle('spatial-mode', this.spatialMode);
    elements.spatialDepth.hidden = !this.spatialMode;
    if (!this.spatialMode) this.resetSpatialMotion();
  }

  applySpatialMotion(motion) {
    elements.app.style.setProperty('--spatial-back-x', `${motion.backX}px`);
    elements.app.style.setProperty('--spatial-back-y', `${motion.backY}px`);
    elements.app.style.setProperty('--spatial-back-rotate', `${motion.backRotate}deg`);
    elements.app.style.setProperty('--spatial-view-x', `${motion.viewX}px`);
    elements.app.style.setProperty('--spatial-view-y', `${motion.viewY}px`);
    elements.app.style.setProperty('--spatial-view-rotate', `${motion.viewRotate}deg`);
    elements.app.style.setProperty('--spatial-view-scale', String(motion.viewScale));
    elements.app.style.setProperty('--spatial-control-x', `${motion.controlX}px`);
  }

  updateSpatialFromPointer(event) {
    if (!this.spatialMode) return;
    const bounds = elements.app.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const normalizedX = clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1);
    const normalizedY = clamp(((event.clientY - bounds.top) / bounds.height) * 2 - 1, -1, 1);
    const yaw = normalizedX * ((GAZE_CONFIG.horizontalFieldOfViewDegrees * Math.PI) / 360);
    const pitch = -normalizedY * ((GAZE_CONFIG.verticalFieldOfViewDegrees * Math.PI) / 360);
    this.applySpatialMotion(spatialMotionFromAngles(yaw, pitch));
  }

  resetSpatialMotion() {
    this.applySpatialMotion(spatialMotionFromAngles(0, 0));
  }

  renderHeader() {
    const visible = this.showsTicker();
    elements.telemetry.hidden = !visible;
    elements.telemetry.style.display = visible ? 'flex' : 'none';
    if (!visible) return;
    if (this.renderedTickerText === this.ambientTickerText && elements.telemetry.innerHTML) return;
    this.renderedTickerText = this.ambientTickerText;
    const tickerCopy = escapeHtml(this.ambientTickerText);
    elements.telemetry.innerHTML = `
      <div class="telemetry-window">
        <div class="telemetry-track">
          <div class="telemetry-group">
            <span class="telemetry-copy">${tickerCopy}</span>
            <span class="telemetry-separator">···</span>
          </div>
          <div class="telemetry-group">
            <span class="telemetry-copy">${tickerCopy}</span>
            <span class="telemetry-separator">···</span>
          </div>
        </div>
      </div>
    `;
  }

  renderResources() {
    const visible = this.screen === 'overview' || this.screen === 'fleet';
    elements.resources.hidden = !visible;
    elements.resources.style.display = visible ? 'grid' : 'none';
    if (!visible) {
      elements.resources.innerHTML = '';
      return;
    }
    const available = Game.getAvailableShips(this.game);
    const resources = [
      ['人口', this.game.resources.population, ''],
      ['能源', this.game.resources.energy, ''],
      ['合金', this.game.resources.alloy, ''],
      ['舰船', this.game.fleet.damaged ? `${available}/${this.game.resources.ships}` : available, this.game.fleet.damaged ? 'warning' : ''],
    ];
    elements.resources.innerHTML = resources.map(([label, value, extra]) => `
      <span class="resource-cell">
        <span class="resource-key">${label}</span>
        <span class="resource-value ${extra}">${value}</span>
      </span>
    `).join('');
  }

  showsTicker() {
    return !['boot', 'menu', 'opening', 'battle', 'result'].includes(this.screen);
  }

  renderViewport() {
    const renderer = {
      boot: this.renderBoot,
      menu: this.renderMenu,
      opening: this.renderOpening,
      overview: this.renderOverview,
      map: this.renderMap,
      planet: this.renderPlanet,
      colonize: this.renderColonize,
      fleet: this.renderFleet,
      mail: this.renderMail,
      'mail-detail': this.renderMailDetail,
      trade: this.renderTrade,
      expedition: this.renderExpedition,
      travel: this.renderTravel,
      battle: this.renderBattle,
      result: this.renderResult,
    }[this.screen];
    elements.viewport.innerHTML = renderer ? renderer.call(this) : this.renderOverview();
    this.updateLive();
  }

  renderBoot() {
    return `
      <section class="screen screen-fill"><div class="boot-screen">
        <strong class="boot-title">英仙座远航</strong>
        <span class="boot-caption">远征舰队系统初始化中</span>
        <div class="boot-progress-track"><div class="boot-progress-fill"></div></div>
      </div></section>
    `;
  }

  renderMenu() {
    const owned = Game.getOwnedPlanets(this.game).length;
    const started = this.game.started;
    const primary = started ? '继续远征' : '选择初始殖民地';
    const restart = started
      ? `<button class="${this.resetArmed ? 'action-button primary' : 'action-button quiet'}" data-action="menu-restart">${this.resetArmed ? '再次确认新远征' : '开始新远征'}</button>`
      : '';
    return `
      <section class="screen screen-fill"><div class="menu-screen">
        <div class="menu-panel">
          <span class="menu-eyebrow">本地远征存档</span>
          <h1 class="menu-title">英仙座远航</h1>
          <p class="menu-status">${started ? `已控制 ${owned}/10 行星座标 · 舰队 ${Game.getAvailableShips(this.game)}` : '等待建立第一座殖民地'}</p>
          <p class="menu-note">离线最多累计 30 分钟</p>
          <div class="menu-rule"></div>
          <div class="menu-actions">
            <button class="action-button primary" data-action="menu-continue">${primary}</button>
            ${restart}
            <button class="action-button quiet" data-action="menu-exit">退出游戏</button>
          </div>
        </div>
      </div></section>
    `;
  }

  renderOpening() {
    const rows = PLANETS.filter((planet) => planet.page === 1).map((planet, index) => `
      <button class="opening-row" data-action="start" data-planet="${planet.id}">
        <span class="planet-index">0${index + 1}</span>
        <span class="opening-copy">
          <strong class="opening-name">${planet.name}</strong>
          <span class="opening-flavor">${planet.flavor}</span>
        </span>
        <span class="opening-outputs">${outputLine(planet)}</span>
        <span class="planet-enter">›</span>
      </button>
    `).join('');
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">建立第一座殖民地</h1>
          <span class="screen-kicker">选择初始据点</span>
        </header>
        <p class="screen-copy">指向或上下滑选择行星，N 模拟点头建立初始殖民地。</p>
        <div class="opening-list">${rows}</div>
      </section>
    `;
  }

  renderOverview() {
    const next = this.firstNextTarget();
    const owned = Game.getOwnedPlanets(this.game).length;
    const claim = Game.getClaimWindow(this.game, Date.now());
    const harvestStatus = claim.ready
      ? '可结算产出等待自动入库'
      : `${Math.max(1, Math.ceil(claim.nextClaimMs / 1000))} 秒后自动收获`;
    const mailCount = this.game.pendingEvents.length;
    const fleetStatus = this.game.resources.ships === 0
      ? '无可用舰船'
      : this.game.fleet.damaged > 0
        ? `战损 ${this.game.fleet.damaged}`
        : '舰队完好';
    const warning = this.game.fleet.maintenanceOverdue
      ? '<p class="objective-line">[!] 维护资源不足，产出将在自动收获时抵扣。</p>'
      : '';
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">殖民地总览</h1>
          <span class="screen-kicker">${owned}/10 行星</span>
        </header>
        <div class="overview-clean">
          <p class="objective-line">${next ? `下一目标 · ${next.name}  ${next.colonizationShips ? '殖民' : '敌对'}` : '十颗行星已全部接管'}</p>
          <div class="harvest-status">
            <span class="claim-copy">
              <strong class="claim-title">行星产出自动入库</strong>
              <span class="claim-meta">${owned} 颗己方行星 · <span id="auto-harvest-status">${harvestStatus}</span></span>
            </span>
            <span class="claim-auto-status">自动</span>
          </div>
          <button class="mail-entry" data-action="mail">殖民邮件 · ${mailCount} 封待处理  ›</button>
          <div class="overview-actions">
            <button class="action-button quiet" data-action="map">星图</button>
            <button class="action-button quiet" data-action="fleet">舰队</button>
          </div>
          <div class="panel-line">
            <span class="screen-meta">可用舰船 ${Game.getAvailableShips(this.game)}</span>
            <span class="screen-meta">${fleetStatus}</span>
          </div>
          ${warning}
        </div>
      </section>
    `;
  }

  renderMap() {
    const rows = PLANETS.filter((planet) => planet.page === this.mapPage).map((planet) => {
      const state = this.game.planets[planet.id];
      const rowClass = state.owner === 'player' ? 'planet-button owned' : 'planet-button';
      const marker = state.owner === 'player'
        ? '控制'
        : planet.hostile
          ? '敌对'
          : '殖民';
      return `
        <button class="${rowClass}" data-action="open-planet" data-planet="${planet.id}">
          <span class="planet-level">${marker}</span>
          <span class="planet-button-copy">
            <strong class="planet-button-name">${planet.name}</strong>
            <span class="planet-button-meta">${ownerLabel(state.owner)}</span>
          </span>
          <span class="planet-enter">›</span>
        </button>
      `;
    }).join('');
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">星图</h1>
          <span class="screen-kicker">${this.mapPage}/4 · ${PAGE_LABELS[this.mapPage]}</span>
        </header>
        <div class="planet-list">${rows}</div>
        <footer class="map-footer map-navigation">
          <button class="action-button quiet compact" data-action="page-delta" data-delta="-1">上一页</button>
          <button class="action-button quiet compact" data-action="page-delta" data-delta="1">下一页</button>
          <button class="action-button quiet compact" data-action="overview">返回总览</button>
        </footer>
      </section>
    `;
  }

  renderPlanet() {
    const planet = PLANET_BY_ID[this.selectedPlanetId];
    if (!planet) return this.renderMap();
    const state = this.game.planets[planet.id];
    const isOwned = state.owner === 'player';
    const isEnemy = Boolean(planet.hostile) && !isOwned;
    const canColonize = planet.originOwner === 'unowned' && !isOwned;
    const requirementLabel = planet.colonizationShips
      ? isOwned
        ? '殖民状态'
        : '殖民需求'
      : '推荐投入';
    const requirementValue = planet.colonizationShips
      ? isOwned
        ? '已接入'
        : planet.colonizationShips
      : planet.recommended || '—';
    const primary = isEnemy
      ? '<button class="action-button primary" data-action="prepare-expedition">配置远征</button>'
      : canColonize
        ? '<button class="action-button primary" data-action="open-colonize">殖民</button>'
      : isOwned && planet.originOwner !== 'unowned'
        ? `<button class="${this.returnArmed ? 'action-button primary' : 'action-button quiet'}" data-action="return-colony">${this.returnArmed ? '再次确认归还' : '归还殖民地'}</button>`
        : '';
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">${planet.name}</h1>
          <span class="screen-kicker">${ownerLabel(state.owner)}${planet.hostile ? ' · 敌对' : ''}</span>
        </header>
        <div class="detail-clean">
          <p class="detail-clean-copy">${planet.flavor}</p>
          <div class="detail-clean-stats">
            <div class="detail-clean-stat"><span class="detail-clean-key">每分钟产出</span><span class="detail-clean-value">${outputLine(planet)}</span></div>
            <div class="detail-clean-stat"><span class="detail-clean-key">稳定度</span><span class="detail-clean-value">${Math.round(state.stability)}</span></div>
            <div class="detail-clean-stat"><span class="detail-clean-key">科研值</span><span class="detail-clean-value">${state.research} / 100</span></div>
            <div class="detail-clean-stat"><span class="detail-clean-key">${requirementLabel}</span><span class="detail-clean-value">${requirementValue}</span></div>
          </div>
          <div class="detail-clean-actions">
            <button class="action-button quiet" data-action="map">返回星图</button>
            ${primary}
          </div>
        </div>
      </section>
    `;
  }

  renderFleet() {
    const available = Game.getAvailableShips(this.game);
    const build = Game.getBuildCost(this.game);
    const repair = Game.getRepairCost(this.game);
    const researchCost = Game.getResearchCostFactor(this.game);
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">远征舰队</h1>
          <span class="screen-kicker">最高科研值 ${Game.getHighestResearch(this.game)} · 成本 x${researchCost.toFixed(2)}</span>
        </header>
        <div class="fleet-clean">
          <div class="fleet-hero">
            <strong class="fleet-hero-number">${available}</strong>
            <span class="fleet-hero-copy">可用舰船<br>总量 ${this.game.resources.ships} · 战损 ${this.game.fleet.damaged}</span>
          </div>
          <div class="fleet-action-row">
            <button class="action-button primary" data-action="build">建造 20</button>
            <button class="action-button" data-action="repair">维修 10</button>
          </div>
          <span class="fleet-cost-inline">建造：人 ${build.population} / 能 ${build.energy} / 合 ${build.alloy}</span>
          <span class="fleet-cost-inline">维修：人 ${repair.population} / 能 ${repair.energy} / 合 ${repair.alloy}</span>
          ${this.game.fleet.maintenanceOverdue ? '<p class="objective-line">[!] 维护资源不足，请先征收产出。</p>' : ''}
          <div class="fleet-tools">
            <button class="action-button quiet" data-action="trade">阵营贸易</button>
            <button class="action-button quiet" data-action="overview">返回总览</button>
          </div>
        </div>
      </section>
    `;
  }

  renderColonize() {
    const planet = PLANET_BY_ID[this.selectedPlanetId];
    if (!planet) return this.renderMap();
    const available = Game.getAvailableShips(this.game);
    const required = planet.colonizationShips;
    const canStart = available >= required;
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">${planet.name}</h1>
          <span class="screen-kicker">殖民</span>
        </header>
        <div class="expedition-clean">
          <div class="expedition-top">
            ${expeditionMetric('可用舰船', available)}
            ${expeditionMetric('殖民需求', required)}
            ${expeditionMetric('预计结果', canStart ? '可殖民' : '不足')}
          </div>
          <p class="expedition-alert">达到所需舰船后即可殖民。成功后，${required} 艘殖民舰队会全部损耗。</p>
          <div class="expedition-actions">
            <button class="action-button quiet" data-action="planet">返回</button>
            <button class="action-button ${canStart ? 'primary' : 'disabled'}" data-action="confirm-colonize">确认殖民</button>
          </div>
        </div>
      </section>
    `;
  }

  renderMail() {
    const rows = this.game.pendingEvents.map((mail, index) => `
      <button class="${mail.templateId === 'lost-freighter' ? 'mail-row alarm' : 'mail-row'}" data-action="open-mail" data-event="${mail.id}">
        <span class="mail-index">0${index + 1}</span>
        <span class="mail-copy">
          <strong class="mail-title">${mail.title}</strong>
          <span class="mail-source">${mail.planetId ? `${mail.source} / ${PLANET_BY_ID[mail.planetId].name}` : mail.source}</span>
        </span>
        <span class="planet-enter">›</span>
      </button>
    `).join('');
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">殖民邮件</h1>
          <span class="screen-kicker">${this.game.pendingEvents.length}/3 待处理</span>
        </header>
        ${rows ? `<div class="mail-list">${rows}</div>` : '<div class="empty-box"><span>[ EMPTY ]</span><span>下一封邮件将在 30 至 120 秒内抵达。</span></div>'}
        <footer class="map-footer">
          <span class="screen-meta">离线计时仍会生成邮件</span>
          <button class="action-button compact" data-action="overview">返回总览</button>
        </footer>
      </section>
    `;
  }

  renderMailDetail() {
    const mail = this.game.pendingEvents.find((item) => item.id === this.activeEventId);
    if (!mail) return this.renderMail();
    const options = mail.options.map((option, index) => `
      <button class="choice-button ${index === this.selectedOptionIndex ? 'selected' : ''}" data-action="select-option" data-option="${index}">
        <span>${option.label}</span>
        <span class="choice-preview">${option.preview}</span>
      </button>
    `).join('');
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">${mail.title}</h1>
          <span class="screen-kicker">${mail.source}</span>
        </header>
        <div class="mail-detail">
          <p class="mail-body">${mail.body}</p>
          ${options}
          <div class="action-row">
            <button class="action-button quiet compact" data-action="mail">返回邮箱</button>
          </div>
        </div>
      </section>
    `;
  }

  renderTrade() {
    const rows = Game.TRADE_OFFERS.map((offer) => {
      const quote = Game.getTradeQuote(this.game, offer.id);
      return `
        <article class="trade-row">
          <span class="trade-copy">
            <strong class="trade-title">${FACTIONS[offer.faction].shortName} / ${offer.name}</strong>
            <span class="trade-meta">好感加成 ${Math.round((1 - quote.factor) * 100)}%</span>
          </span>
          <span class="trade-price">${resourceLabel(offer.give.resource)} ${quote.required} → ${resourceLabel(offer.receive.resource)} ${offer.receive.amount}</span>
          <button class="action-button compact" data-action="trade-offer" data-offer="${offer.id}">交换</button>
        </article>
      `;
    }).join('');
    return `
      <section class="screen screen-fill trade-screen">
        <header class="screen-head">
          <h1 class="screen-title">阵营贸易</h1>
          <span class="screen-kicker trade-relations">海帕 ${signed(this.game.relations.starCore)} · 陆巡 ${signed(this.game.relations.heavyWall)}</span>
        </header>
        <div class="scroll-content"><div class="trade-list">${rows}</div></div>
        <footer class="map-footer trade-footer">
          <span class="screen-meta">好感越高，支付量越低</span>
          <button class="action-button compact" data-action="overview">返回总览</button>
        </footer>
      </section>
    `;
  }

  renderExpedition() {
    const planet = PLANET_BY_ID[this.selectedPlanetId];
    if (!planet) return this.renderMap();
    const max = Game.getMaxInvestment(this.game);
    const investment = clamp(this.investment, 0, max);
    const available = Game.getAvailableShips(this.game);
    const winChance = Game.getEstimatedWinChance(planet, investment);
    const risk = winChance === 0
      ? '[!] 投入低于最低建议，远征几乎没有胜算'
      : winChance === 50
        ? '[~] 势均力敌，预计胜负各半'
        : winChance < 50
          ? `[~] 当前投入偏低，预计胜率 ${winChance}%`
          : `[+] 当前投入占优，预计胜率 ${winChance}%`;
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">${planet.name}</h1>
          <span class="screen-kicker">敌对目标</span>
        </header>
        <div class="expedition-clean">
          <div class="expedition-top">
            <div class="expedition-metric">
              <span class="expedition-metric-key">可用舰船</span>
              <strong class="expedition-metric-value">${available}</strong>
            </div>
            <div class="expedition-metric">
              <span class="expedition-metric-key">推荐投入</span>
              <strong class="expedition-metric-value">${planet.recommended}</strong>
            </div>
            <div class="expedition-metric">
              <span class="expedition-metric-key">预计胜率</span>
              <strong class="expedition-metric-value">${winChance}%</strong>
            </div>
          </div>
          <p class="expedition-alert">${risk}</p>
          <p class="expedition-rule">出征舰队不能超过可用舰船；每 10 艘消耗人口、能源、合金各 10。</p>
          <div class="investment-clean">
            <button class="action-button" data-action="adjust" data-delta="-10">−10</button>
            <div class="investment-value-clean">
              <strong class="investment-value-number">${investment}</strong>
              <span class="investment-value-caption">出征舰船 / 上限 ${max}</span>
            </div>
            <button class="action-button" data-action="adjust" data-delta="10">+10</button>
          </div>
          <div class="expedition-actions">
            <button class="action-button quiet" data-action="planet">返回</button>
            <button class="action-button primary" data-action="confirm-expedition">确认远征</button>
          </div>
        </div>
      </section>
    `;
  }

  renderTravel() {
    const travel = this.buildTravelData(this.game.fleet.expedition, Date.now());
    if (!travel) return this.renderOverview();
    return `
      <section class="screen screen-fill">
        <header class="screen-head">
          <h1 class="screen-title">远征舰队航行中</h1>
          <span id="travel-seconds" class="screen-kicker">${travel.secondsLeft} 秒</span>
        </header>
        <div class="travel-stage">
          <div class="travel-endpoints"><span>${travel.fromLabel}</span><span>${travel.toLabel}</span></div>
          <div class="travel-track">
            <div class="travel-line"></div>
            <div class="travel-progress" style="width: ${travel.progress}%;"></div>
          </div>
          <div class="travel-caption"><span>航线占用：唯一远征舰队</span><span id="travel-progress">${travel.progress}%</span></div>
          <div class="status-note">结果已在出发时确定。关闭页面不会取消本次远征。</div>
          <button class="action-button" data-action="overview">返回总览等待</button>
        </div>
      </section>
    `;
  }

  renderBattle() {
    const result = this.result;
    return `
      <section class="screen screen-fill">
        <div class="battle-stage ${result.cgType}">
          <div class="battle-cg">
            <div class="battle-grid-line battle-grid-horizontal"></div>
            <div class="battle-grid-line battle-grid-vertical"></div>
            <div class="battle-scan"></div>
            <div class="battle-planet">
              <div class="battle-planet-core"></div>
              <div class="battle-planet-ring planet-ring-a"></div>
              <div class="battle-planet-ring planet-ring-b"></div>
            </div>
            <div class="battle-fleet">
              <div class="battle-ship"></div>
              <div class="battle-ship"></div>
              <div class="battle-ship"></div>
              <div class="battle-ship"></div>
            </div>
            <div class="battle-enemy">
              <div class="battle-enemy-ship"></div>
              <div class="battle-enemy-ship"></div>
              <div class="battle-enemy-ship"></div>
            </div>
            <div class="battle-laser battle-laser-a"></div>
            <div class="battle-laser battle-laser-b"></div>
            <div class="battle-impact"></div>
          </div>
          <div class="battle-copy">
            <span class="battle-signal">FLEET CONTACT</span>
            <strong class="battle-title">${result.title}</strong>
            <span class="battle-subtitle">${result.targetName} / 战损 ${result.lostShips}</span>
          </div>
        </div>
      </section>
    `;
  }

  renderResult() {
    const result = this.result;
    if (!result) return this.renderOverview();
    const target = PLANET_BY_ID[result.targetId];
    const owned = Game.getOwnedPlanets(this.game).length;
    return `
      <section class="screen">
        <header class="screen-head">
          <h1 class="screen-title">远征结算</h1>
        </header>
        <div class="result-layout">
          <div class="result-hero">
            <strong class="result-title">${result.title}</strong>
            <span class="screen-kicker">${result.won ? '占领成功' : '远征失败'}</span>
            <span class="result-copy">${result.text}</span>
            <span class="screen-meta">${owned >= 10 ? '十星区已全部接管' : '修复舰队后继续推进'}</span>
          </div>
          <div class="result-stats">
            <div class="open-panel">
              <div class="panel-line"><span class="panel-line-label">目标</span><span class="panel-line-value">${result.targetName}</span></div>
              <div class="panel-line"><span class="panel-line-label">投入</span><span class="panel-line-value">${result.investment} / ${result.recommended}</span></div>
              <div class="panel-line"><span class="panel-line-label">战损</span><span class="panel-line-value">${result.lostShips} 舰</span></div>
              <div class="panel-line"><span class="panel-line-label">新产出</span><span class="panel-line-value">${result.won && target ? outputLine(target) : '未接入'}</span></div>
            </div>
            <button class="action-button primary" data-action="finish-result">返回总览</button>
          </div>
        </div>
      </section>
    `;
  }

  visibleFocusables() {
    const roots = [elements.viewport];
    const candidates = roots.flatMap((root) => [...root.querySelectorAll('[data-action]')]);
    if (this.screen === 'map') {
      candidates.sort((left, right) => {
        const priority = (element) => {
          if (element.matches('.planet-button')) return 0;
          if (element.matches('.page-tab')) return 1;
          return 2;
        };
        return priority(left) - priority(right);
      });
    }
    return candidates.filter((element) => (
      !element.disabled
      && !element.classList.contains('disabled')
      && !element.hidden
      && element.getClientRects().length > 0
    ));
  }

  focusFromPointer(event) {
    const element = event.target.closest?.('[data-action]');
    if (!element || !elements.viewport.contains(element)) return;
    const candidates = this.visibleFocusables();
    const index = candidates.indexOf(element);
    if (index >= 0 && this.focusKeyFor(element) !== this.focusedKey) {
      this.setFocusedIndex(index, candidates);
    }
  }

  focusKeyFor(element) {
    const data = element.dataset;
    const parts = [
      data.action,
      data.planet,
      data.page,
      data.delta,
      data.event,
      data.option,
      data.offer,
    ].filter((value) => value !== undefined && value !== '');
    return parts.join(':');
  }

  preferredFocus(candidates) {
    if (this.screen === 'map') {
      const planet = candidates.find((element) => element.matches('.planet-button'));
      if (planet) return planet;
    }
    if (this.screen === 'mail-detail') {
      const firstOption = candidates.find((element) => element.dataset.action === 'select-option');
      if (firstOption) return firstOption;
    }
    if (this.screen === 'expedition') {
      const increase = candidates.find((element) => (
        element.dataset.action === 'adjust' && element.dataset.delta === '10'
      ));
      if (increase) return increase;
    }
    return candidates.find((element) => element.classList.contains('primary')) || candidates[0];
  }

  refreshFocus() {
    const candidates = this.visibleFocusables();
    const context = this.screen;
    if (candidates.length === 0) {
      this.focusedKey = '';
      this.focusedIndex = -1;
      this.focusContext = context;
      elements.control.hidden = true;
      return;
    }

    const descriptors = candidates.map((element) => ({ id: this.focusKeyFor(element) }));
    let index = this.focusContext === context
      ? findFocusIndex(descriptors, this.focusedKey)
      : -1;
    if (index < 0) {
      index = candidates.indexOf(this.preferredFocus(candidates));
    }
    this.focusContext = context;
    this.setFocusedIndex(index, candidates);
  }

  setFocusedIndex(index, candidates = this.visibleFocusables()) {
    if (candidates.length === 0) return;
    const nextIndex = Math.max(0, Math.min(candidates.length - 1, index));
    candidates.forEach((element) => element.classList.remove('focused'));
    const focused = candidates[nextIndex];
    focused.classList.add('focused');
    this.focusedIndex = nextIndex;
    this.focusedKey = this.focusKeyFor(focused);
    elements.control.hidden = false;
    const label = focused.textContent.replace(/\s+/g, ' ').trim();
    elements.control.innerHTML = `
      <span class="control-prefix">${this.spatialMode ? '3D视线' : '镜腿'}</span>
      <span class="control-position">${nextIndex + 1}/${candidates.length}</span>
      <span class="control-focus">当前：${escapeHtml(label)}</span>
      <span class="control-help">${this.spatialMode ? '移动指向 · N 点头确认 · Enter 备用' : '上下选择 · N 点头确认 · Enter 备用'}</span>
    `;
    focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  moveFocus(delta) {
    const candidates = this.visibleFocusables();
    if (candidates.length === 0) return;
    const current = findFocusIndex(
      candidates.map((element) => ({ id: this.focusKeyFor(element) })),
      this.focusedKey,
    );
    const next = moveFocusIndex(current, candidates.length, delta);
    this.setFocusedIndex(next, candidates);
  }

  activateFocus() {
    const candidates = this.visibleFocusables();
    const focused = candidates.find((element) => this.focusKeyFor(element) === this.focusedKey);
    if (focused) focused.click();
  }

  clearSingleTapTimer() {
    if (this.singleTapTimer) {
      clearTimeout(this.singleTapTimer);
      this.singleTapTimer = null;
    }
    this.singleTapToken += 1;
  }

  cancelPendingTempleTap() {
    this.clearSingleTapTimer();
    clearPendingTap(this.templeInputState);
  }

  scheduleSingleTap() {
    this.clearSingleTapTimer();
    const token = this.singleTapToken;
    this.singleTapTimer = setTimeout(() => {
      if (token !== this.singleTapToken) return;
      this.singleTapTimer = null;
      clearPendingTap(this.templeInputState);
      this.activateFocus();
    }, DOUBLE_TAP_WINDOW_MS);
  }

  applyTempleIntent(intent) {
    if (intent.type === 'previous') {
      this.cancelPendingTempleTap();
      this.moveFocus(-1);
      return;
    }
    if (intent.type === 'next') {
      this.cancelPendingTempleTap();
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
      this.scheduleSingleTap();
    }
  }

  handleTempleKey(phase, event) {
    const intent = templeIntent(
      event,
      phase,
      this.templeInputState,
      Date.now(),
    );
    if (!intent) return;
    event.preventDefault();
    if (intent.type !== 'consume') this.applyTempleIntent(intent);
  }

  handlePreviewNod(event) {
    if (event.code !== 'KeyN' || event.repeat) return;
    event.preventDefault();
    this.activateFocus();
  }

  handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    this.focusedKey = this.focusKeyFor(button);
    const action = button.dataset.action;
    const dataset = button.dataset;
    if (action === 'page' || action === 'page-delta') {
      this.focusedKey = '';
      this.focusContext = '';
    }

    if (action === 'menu-continue') return this.continueFromMenu();
    if (action === 'menu-restart') return this.reset();
    if (action === 'menu-exit') return this.requestExit();
    if (action === 'start') return this.start(dataset.planet);
    if (action === 'map') return this.openMap();
    if (action === 'overview') return this.openOverview();
    if (action === 'fleet') return this.setScreen('fleet');
    if (action === 'mail') return this.setScreen('mail');
    if (action === 'build') return this.build();
    if (action === 'repair') return this.repair();
    if (action === 'page') return this.setPage(Number(dataset.page));
    if (action === 'page-delta') return this.setPage(this.mapPage + Number(dataset.delta));
    if (action === 'open-planet') return this.openPlanet(dataset.planet);
    if (action === 'planet') return this.setScreen('planet');
    if (action === 'open-colonize') return this.openColonize();
    if (action === 'confirm-colonize') return this.confirmColonize();
    if (action === 'prepare-expedition') return this.prepareExpedition();
    if (action === 'adjust') return this.adjustInvestment(Number(dataset.delta));
    if (action === 'preset') return this.setPreset(dataset.mode);
    if (action === 'confirm-expedition') return this.startExpedition();
    if (action === 'trade') return this.setScreen('trade');
    if (action === 'trade-offer') return this.trade(dataset.offer);
    if (action === 'open-mail') return this.openMail(dataset.event);
    if (action === 'select-option') return this.selectOption(Number(dataset.option));
    if (action === 'return-colony') return this.returnColony();
    if (action === 'reset') return this.reset();
    if (action === 'finish-result') return this.finishResult();
  }

  setScreen(screen) {
    if (screen === 'overview' && this.autoHarvest(Date.now()).ok) {
      Game.persistState(this.game, this.storage);
    }
    this.screen = screen;
    this.returnArmed = false;
    this.resetArmed = false;
    this.render();
  }

  continueFromMenu() {
    this.screen = this.resumeScreen || (this.game.started ? 'overview' : 'opening');
    if (this.screen === 'overview' && this.autoHarvest(Date.now()).ok) {
      Game.persistState(this.game, this.storage);
    }
    this.render();
  }

  openOverview() {
    if (this.screen === 'result') return this.finishResult();
    this.screen = this.game.started ? 'overview' : 'opening';
    if (this.screen === 'overview' && this.autoHarvest(Date.now()).ok) {
      Game.persistState(this.game, this.storage);
    }
    this.render();
  }

  start(planetId) {
    const result = Game.startGame(this.game, planetId, Date.now());
    if (!result.ok) return this.showToast(result.message);
    this.game = result.state;
    this.autoHarvest(Date.now());
    Game.persistState(this.game, this.storage);
    this.screen = 'overview';
    this.resumeScreen = 'overview';
    this.render();
    this.showToast(result.message);
  }

  autoHarvest(now = Date.now()) {
    if (!this.game || !this.game.started) return { ok: false, state: this.game };
    if (!Game.getClaimWindow(this.game, now).ready) {
      return { ok: false, state: this.game };
    }
    const result = Game.claimAll(this.game, now);
    if (result.ok) this.game = result.state;
    return result;
  }

  build() {
    const result = Game.buildShips(this.game);
    if (!result.ok) return this.showToast(result.message);
    this.game = result.state;
    Game.persistState(this.game, this.storage);
    this.render();
    this.showToast(result.message);
  }

  repair() {
    const result = Game.repairShips(this.game);
    if (!result.ok) return this.showToast(result.message);
    this.game = result.state;
    Game.persistState(this.game, this.storage);
    this.render();
    this.showToast(result.message);
  }

  openMap() {
    if (!this.game.started) return this.showToast('先选择第一颗殖民地。');
    this.screen = 'map';
    this.render();
  }

  setPage(page) {
    this.mapPage = clamp(page, 1, 4);
    this.screen = 'map';
    this.render();
  }

  openPlanet(planetId) {
    if (!PLANET_BY_ID[planetId]) return;
    this.selectedPlanetId = planetId;
    this.mapPage = PLANET_BY_ID[planetId].page;
    this.returnArmed = false;
    this.screen = 'planet';
    this.render();
  }

  prepareExpedition() {
    const planet = PLANET_BY_ID[this.selectedPlanetId];
    if (!planet || !planet.hostile) return;
    this.investment = Math.min(planet.recommended, Game.getMaxInvestment(this.game));
    this.screen = 'expedition';
    this.render();
  }

  openColonize() {
    const planet = PLANET_BY_ID[this.selectedPlanetId];
    if (!planet || planet.originOwner !== 'unowned') {
      return this.showToast('该行星不需要殖民。');
    }
    this.screen = 'colonize';
    this.render();
  }

  confirmColonize() {
    const result = Game.colonizePlanet(this.game, this.selectedPlanetId, Date.now());
    if (!result.ok) return this.showToast(result.message);
    this.game = result.state;
    Game.persistState(this.game, this.storage);
    this.screen = 'planet';
    this.render();
    this.showToast(result.message);
  }

  adjustInvestment(delta) {
    const max = Game.getMaxInvestment(this.game);
    const next = clamp(this.investment + delta, 0, max);
    if (next === this.investment) {
      this.showToast(delta < 0 ? '已达到最低投入。' : '已达到可用舰船上限。');
      return;
    }
    this.investment = next;
    this.screen = 'expedition';
    this.render();
  }

  setPreset(mode) {
    const planet = PLANET_BY_ID[this.selectedPlanetId];
    const max = Game.getMaxInvestment(this.game);
    let value = planet.recommended;
    if (mode === 'half') value = Math.ceil(planet.recommended * 0.5);
    if (mode === 'max') value = max;
    this.investment = clamp(value, 0, max);
    this.render();
  }

  startExpedition() {
    if (this.investment <= 0) return this.showToast('请至少投入 10 艘舰船。');
    const result = Game.startExpedition(this.game, this.selectedPlanetId, this.investment, Date.now());
    if (!result.ok) return this.showToast(result.message);
    this.game = result.state;
    Game.persistState(this.game, this.storage);
    this.screen = 'travel';
    this.render();
    this.showToast(result.message);
  }

  trade(offerId) {
    const result = Game.tradeResources(this.game, offerId);
    if (!result.ok) return this.showToast(result.message);
    this.game = result.state;
    Game.persistState(this.game, this.storage);
    this.render();
    this.showToast(result.message);
  }

  openMail(eventId) {
    this.activeEventId = eventId;
    this.selectedOptionIndex = -1;
    this.screen = 'mail-detail';
    this.focusedKey = '';
    this.focusContext = '';
    this.render();
  }

  selectOption(index) {
    const result = Game.chooseEvent(this.game, this.activeEventId, index, Date.now());
    if (!result.ok) return this.showToast(result.message);
    this.game = result.state;
    Game.persistState(this.game, this.storage);
    this.screen = 'mail';
    this.activeEventId = '';
    this.selectedOptionIndex = -1;
    this.render();
    this.showToast(result.message);
  }

  returnColony() {
    if (!this.returnArmed) {
      this.returnArmed = true;
      this.render();
      this.showToast('再次确认：归还后停止该行星产出。');
      return;
    }
    const result = Game.returnColony(this.game, this.selectedPlanetId);
    if (!result.ok) return this.showToast(result.message);
    this.game = result.state;
    Game.persistState(this.game, this.storage);
    this.returnArmed = false;
    this.render();
    this.showToast(result.message);
  }

  reset() {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.render();
      this.showToast('再次确认：将清空当前存档。');
      return;
    }
    Game.resetSavedState(this.storage);
    this.game = Game.createDefaultState(Date.now());
    this.screen = 'opening';
    this.resumeScreen = 'opening';
    this.mapPage = 1;
    this.resetArmed = false;
    this.render();
    this.showToast('存档已重置。');
  }

  requestExit() {
    if (!Game.persistState(this.game, this.storage).ok) {
      this.showToast('存档写入失败，无法安全退出。');
      return;
    }
    window.close();
  }

  showBattle() {
    clearTimeout(this.battleTimer);
    this.screen = 'battle';
    this.render();
    this.battleTimer = setTimeout(() => this.openResult(), 4200);
  }

  openResult() {
    clearTimeout(this.battleTimer);
    this.screen = 'result';
    this.render();
  }

  finishResult() {
    if (this.game.lastBattleResult) {
      this.game = Game.acknowledgeBattleResult(this.game);
      Game.persistState(this.game, this.storage);
    }
    this.result = null;
    this.screen = 'overview';
    this.resumeScreen = 'overview';
    if (this.autoHarvest(Date.now()).ok) {
      Game.persistState(this.game, this.storage);
    }
    this.render();
  }

  goBack() {
    if (this.screen === 'menu' || this.screen === 'boot') {
    } else if (this.screen === 'mail-detail') {
      this.activeEventId = '';
      this.selectedOptionIndex = -1;
      this.setScreen('mail');
    } else if (this.screen === 'planet') {
      this.setScreen('map');
    } else if (this.screen === 'expedition') {
      this.setScreen('planet');
    } else if (this.screen === 'colonize') {
      this.setScreen('planet');
    } else if (this.screen === 'battle') {
      this.openResult();
    } else if (this.screen === 'result') {
      this.finishResult();
    } else if (this.screen === 'overview' || this.screen === 'opening') {
      this.screen = 'menu';
      this.render();
    } else if (this.screen === 'map') {
      this.openOverview();
    } else if (this.screen === 'trade') {
      this.setScreen('fleet');
    } else {
      this.openOverview();
    }
  }

  showToast(message) {
    clearTimeout(this.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    this.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 2400);
  }

  firstNextTarget() {
    return PLANETS
      .filter((planet) => this.game.planets[planet.id].owner !== 'player')
      .sort((left, right) => left.page - right.page || (left.recommended || 0) - (right.recommended || 0))[0] || null;
  }

  relationLine() {
    return `海帕 ${signed(this.game.relations.starCore)} / 陆巡 ${signed(this.game.relations.heavyWall)}`;
  }

  buildTravelData(expedition, now) {
    if (!expedition) return null;
    const target = PLANET_BY_ID[expedition.targetId];
    const owned = Game.getOwnedPlanets(this.game);
    const fromPage = owned.length ? Math.max(...owned.map((planet) => planet.page)) : 1;
    const total = Math.max(1000, expedition.arrivedAt - expedition.startedAt);
    const elapsed = clamp(now - expedition.startedAt, 0, total);
    const remaining = Math.max(0, expedition.arrivedAt - now);
    return {
      fromLabel: `PAGE 0${fromPage} / ${PAGE_LABELS[fromPage]}`,
      toLabel: `PAGE 0${target.page} / ${target.name}`,
      secondsLeft: Math.ceil(remaining / 1000),
      progress: Math.round((elapsed / total) * 100),
      durationClass: `travel-dot duration-${expedition.durationSeconds}`,
    };
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function signed(value) {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function outputLine(planet) {
  return `${RESOURCE_SHORT_LABELS.population}+${planet.output.population} ${RESOURCE_SHORT_LABELS.energy}+${planet.output.energy} ${RESOURCE_SHORT_LABELS.alloy}+${planet.output.alloy}`;
}

function ownerLabel(owner) {
  if (owner === 'player') return '己方';
  if (owner === 'unowned') return '无阵营';
  return FACTIONS[owner] ? FACTIONS[owner].shortName : '未知';
}

function resourceLabel(key) {
  return RESOURCE_LABELS[key] || key;
}

function planetNumber(label, value) {
  return `<span class="planet-number"><span class="planet-number-key">${label}</span><span>+${value}</span></span>`;
}

function statRow(label, value) {
  return `<div class="stat-row"><span class="stat-key">${label}</span><span class="stat-value">${value}</span></div>`;
}

function fleetStat(label, value) {
  return `<div class="fleet-stat"><span class="fleet-stat-key">${label}</span><span class="fleet-stat-value">${value}</span></div>`;
}

function summaryBlock(label, value) {
  return `<div class="summary-block"><span class="summary-key">${label}</span><span class="summary-value">${value}</span></div>`;
}

function expeditionMetric(label, value) {
  return `<div class="expedition-metric"><span class="expedition-metric-key">${label}</span><span class="expedition-metric-value">${value}</span></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

new DemoPreview();

