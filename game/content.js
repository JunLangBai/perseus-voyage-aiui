export const CONTENT_VERSION = 1;

export const FACTIONS = {
  starCore: {
    id: 'starCore',
    name: '海帕科技',
    shortName: '海帕',
    motive: '科研网络与能源连续性',
    tone: '冷静、程序化，优先保存数据与人员记录',
  },
  heavyWall: {
    id: 'heavyWall',
    name: '陆巡重工',
    shortName: '陆巡',
    motive: '航道安全与工业秩序',
    tone: '直接、务实，优先保障产能与要塞通行',
  },
};

export const PLANETS = [
  {
    id: 'tide-3',
    name: '潮汐-3',
    page: 1,
    originOwner: 'unowned',
    flavor: '旧潮汐站仍在记录第一批殖民者的生活。',
    output: { population: 35, energy: 40, alloy: 18 },
    research: 0,
    stability: 65,
    colonizationShips: 40,
    recommended: 0,
  },
  {
    id: 'red-sand-9',
    name: '赤砂-9',
    page: 1,
    originOwner: 'unowned',
    flavor: '三座地表电站隔着沙暴向星区输电。',
    output: { population: 18, energy: 60, alloy: 22 },
    research: 0,
    stability: 60,
    colonizationShips: 40,
    recommended: 0,
  },
  {
    id: 'frost-ring-2',
    name: '霜环-2',
    page: 1,
    originOwner: 'unowned',
    flavor: '冰环科研站留下了一份未完成的舰船研究。',
    output: { population: 16, energy: 34, alloy: 52 },
    research: 25,
    stability: 60,
    colonizationShips: 40,
    recommended: 0,
  },
  {
    id: 'moon-mirror-port',
    name: '月镜港',
    page: 2,
    originOwner: 'starCore',
    flavor: '镜子阵列负责校准深空中继，也保存着最初一段求救信号。',
    output: { population: 26, energy: 58, alloy: 22 },
    research: 50,
    stability: 70,
    hostile: true,
    recommended: 100,
  },
  {
    id: 'anvil',
    name: '铁砧',
    page: 2,
    originOwner: 'heavyWall',
    flavor: '退役舰坞仍在替过路舰队提供维修和补给。',
    output: { population: 22, energy: 26, alloy: 56 },
    research: 0,
    stability: 70,
    hostile: true,
    recommended: 110,
  },
  {
    id: 'star-mesh',
    name: '星络',
    page: 2,
    originOwner: 'starCore',
    flavor: '轨道数据节点连接着星区残余科研网络。',
    output: { population: 48, energy: 44, alloy: 26 },
    research: 50,
    stability: 75,
    hostile: true,
    recommended: 160,
  },
  {
    id: 'red-bastion',
    name: '赤垒',
    page: 3,
    originOwner: 'heavyWall',
    flavor: '军事工业城把秩序和产量写进了同一套配给制度。',
    output: { population: 40, energy: 40, alloy: 70 },
    research: 25,
    stability: 75,
    hostile: true,
    recommended: 180,
  },
  {
    id: 'white-night-array',
    name: '白夜阵列',
    page: 3,
    originOwner: 'starCore',
    flavor: '面向恒星的长期阵列让这里几乎没有真正的夜晚。',
    output: { population: 22, energy: 70, alloy: 30 },
    research: 75,
    stability: 65,
    hostile: true,
    recommended: 240,
  },
  {
    id: 'zero-boundary-core',
    name: '零界核心',
    page: 3,
    originOwner: 'starCore',
    flavor: '核心实验室保存着旧殖民网络失效前的最后记录。',
    output: { population: 56, energy: 78, alloy: 48 },
    research: 100,
    stability: 80,
    hostile: true,
    recommended: 340,
  },
  {
    id: 'heavy-wall-fortress',
    name: '陆巡要塞',
    page: 4,
    originOwner: 'heavyWall',
    flavor: '要塞控制整个星区的航道，是征服终点也是权力交接点。',
    output: { population: 52, energy: 64, alloy: 90 },
    research: 25,
    stability: 85,
    hostile: true,
    recommended: 500,
    finalFortress: true,
  },
];

export const TRADE_OFFERS = [
  {
    id: 'core-energy-for-people',
    faction: 'starCore',
    name: '能源换人口',
    give: { resource: 'energy', amount: 40 },
    receive: { resource: 'population', amount: 25 },
  },
  {
    id: 'core-people-for-alloy',
    faction: 'starCore',
    name: '人口换合金',
    give: { resource: 'population', amount: 30 },
    receive: { resource: 'alloy', amount: 20 },
  },
  {
    id: 'wall-alloy-for-energy',
    faction: 'heavyWall',
    name: '合金换能源',
    give: { resource: 'alloy', amount: 40 },
    receive: { resource: 'energy', amount: 30 },
  },
  {
    id: 'wall-energy-for-alloy',
    faction: 'heavyWall',
    name: '能源换合金',
    give: { resource: 'energy', amount: 60 },
    receive: { resource: 'alloy', amount: 30 },
  },
];

export const EVENT_TEMPLATES = [
  {
    id: 'mining-shortage',
    source: '殖民地行政',
    title: '矿区能源短缺',
    body: '骨干矿区即将停摆。行政官要求现在拨款，或让居民先承受一轮限电。',
    options: [
      {
        label: '拨款应急',
        preview: '能源 -80 / 稳定 +4',
        effects: { resources: { energy: -80 }, stability: 4 },
      },
      {
        label: '暂缓处理',
        preview: '能源 +20 / 稳定 -3',
        effects: { resources: { energy: 20 }, stability: -3 },
      },
    ],
  },
  {
    id: 'star-core-escort',
    source: '海帕科技',
    title: '科研船请求护航',
    body: '一艘采样船偏离航线。海帕科技请求抽调人员，陆巡重工则建议优先维持矿区警戒。',
    options: [
      {
        label: '接受护航',
        preview: '人口 -40 / 海帕好感 +6',
        effects: { resources: { population: -40 }, relation: { starCore: 6 } },
      },
      {
        label: '维持警戒',
        preview: '陆巡好感 +3 / 海帕好感 -2',
        effects: { relation: { heavyWall: 3, starCore: -2 } },
      },
    ],
  },
  {
    id: 'frost-budget',
    source: '霜环科研组',
    title: '科研组申请预算',
    body: '霜环-2 的研究组只差最后一组舰体试验。批准预算能加快研究，驳回则能回收一批储备合金。',
    requiresPlanet: 'frost-ring-2',
    options: [
      {
        label: '批准预算',
        preview: '合金 -60 / 科研值 +20',
        effects: { resources: { alloy: -60 }, research: 20 },
      },
      {
        label: '驳回申请',
        preview: '合金 +30 / 稳定 -2',
        effects: { resources: { alloy: 30 }, stability: -2 },
      },
    ],
  },
  {
    id: 'lost-freighter',
    source: '航路调度',
    title: '旧货船在轨道失联',
    body: '失联船只最后出现在废弃轨道环。搜救可能带回幸存者，也可能只找回一船残骸。',
    options: [
      {
        label: '组织搜救',
        preview: '能源 -50 / 人口 +35',
        effects: { resources: { energy: -50, population: 35 } },
      },
      {
        label: '回收残骸',
        preview: '合金 +55 / 稳定 -2',
        effects: { resources: { alloy: 55 }, stability: -2 },
      },
    ],
  },
  {
    id: 'hyper-signal-capsule',
    source: '海帕科研船队',
    title: '漂流实验舱发回信号',
    body: '失联实验舱重新上线。海帕科技希望完整回收数据，陆巡航运则提出可以当场拆解。',
    options: [
      {
        label: '归档实验数据',
        preview: '能源 -35 / 科研值 +20 / 海帕 +4',
        effects: { resources: { energy: -35 }, research: 20, relation: { starCore: 4 } },
      },
      {
        label: '拆解实验舱',
        preview: '合金 +35 / 稳定 -2 / 海帕 -2 / 陆巡 +2',
        effects: { resources: { alloy: 35 }, stability: -2, relation: { heavyWall: 2, starCore: -2 } },
      },
    ],
  },
  {
    id: 'luxun-convoy-passage',
    source: '陆巡重工',
    title: '运输船队请求护航',
    body: '一支运送备用滤芯的船队请求穿过矿区。陆巡重工愿意补充能源，但要求优先安排护航。',
    options: [
      {
        label: '开放护航航道',
        preview: '能源 -25 / 稳定 +3 / 陆巡 +4',
        effects: { resources: { energy: -25 }, stability: 3, relation: { heavyWall: 4 } },
      },
      {
        label: '征收通行费',
        preview: '合金 +25 / 稳定 -2 / 陆巡 -2',
        effects: { resources: { alloy: 25 }, stability: -2, relation: { heavyWall: -2 } },
      },
    ],
  },
];

export const TICKER_TEMPLATES = [
  {
    id: 'supply-early',
    kind: 'good',
    text: '补给抵达，能源增加',
    effect: { resource: 'energy', requested: 6, cappedAtOnePercent: true },
  },
  {
    id: 'rationing',
    kind: 'warning',
    text: '临时配给，人口下降',
    effect: { resource: 'population', requested: -4, cappedAtOnePercent: true },
  },
  {
    id: 'debris-cleared',
    kind: 'good',
    text: '碎片清理，合金增加',
    effect: { resource: 'alloy', requested: 5, cappedAtOnePercent: false },
  },
  {
    id: 'mirror-weather',
    kind: 'plain',
    text: '月镜港发布气象警告',
    effect: null,
  },
  {
    id: 'relay-noise',
    kind: 'plain',
    text: '深空中继短暂失稳',
    effect: null,
  },
  {
    id: 'armor-alloy',
    kind: 'good',
    text: '旧装甲回炉，合金增加',
    effect: { resource: 'alloy', requested: 4, cappedAtOnePercent: false },
  },
  {
    id: 'power-draw',
    kind: 'warning',
    text: '殖民区用电短时上升',
    effect: { resource: 'energy', requested: -5, cappedAtOnePercent: true },
  },
  {
    id: 'research-transfer',
    kind: 'good',
    text: '实验成果通过异地校验',
    effect: { research: 2 },
  },
  {
    id: 'stability-recovery',
    kind: 'good',
    text: '殖民区秩序回升',
    effect: { stability: 2 },
  },
  {
    id: 'archive-sync',
    kind: 'plain',
    text: '旧殖民档案完成异地校验',
    effect: null,
  },
  {
    id: 'route-lamps',
    kind: 'plain',
    text: '旧航路信标重新点亮',
    effect: null,
  },
];

export const RESOURCE_LABELS = {
  population: '人口',
  energy: '能源',
  alloy: '合金',
  ships: '舰船',
};

export const RESOURCE_SHORT_LABELS = {
  population: '人',
  energy: '能',
  alloy: '合',
  ships: '舰',
};

