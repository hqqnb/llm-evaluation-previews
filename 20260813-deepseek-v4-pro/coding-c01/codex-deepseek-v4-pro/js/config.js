// ---------- 小说《极光》（Aurora, Kim Stanley Robinson, 2015）飞船设定 ----------

export const SHIP = {
  // —— 原著明确给出的尺寸/参数 ——
  spineLength: 10000,          // 主轴长 10 km
  spineRadius: 72,             // 主轴半径（原著未明示，按比例演绎）
  biomeLength: 4000,           // 每个生态舱长 4 km
  biomeRadius: 500,            // 生态舱直径 1 km → 半径 500 m
  biomeCountPerRing: 12,       // 每环 12 个生态舱（30° 相接）
  ringMajorRadius: (4000 * 12) / (2 * Math.PI), // 环中心线半径 ≈ 7.64 km（环直径 ≈ 15.3 km）
  spokeCount: 6,               // 六根辐条连接主轴与外环
  hubRingRadius: 700,          // 内结构环（轴承锁紧环，演绎）
  hubRingTube: 80,
  bearingRadius: 780,
  bearingTube: 90,
  spinGravity: 0.83,           // 旋转产生 0.83g
  ringAY: 2700,                // 环A 位于主轴前段（原著未指明前后，视觉安排）
  ringBY: -2700,               // 环B 位于主轴后段
  population: 2122,            // 全舰约 2122 人（另有“约 2000 人”说法）
  launchYear: 2545,
  cruiseSpeed: 0.1,            // ≈ 十分之一光速巡航
  destination: '天仓五（Tau Ceti）· 宜居卫星“极光”',
};

// 环境类型参数：用于程序化生成生态舱内部
export const ARCHETYPES = {
  coast:   { ground: ['#3e6b43', '#6f9a58'], water: '#2c6f8e', sky: '#8fc7e8', fog: '#9fb8c8', fogD: 0.0016, light: '#fff3d6', trees: 'broad', treeN: 120, grass: 0.6, rock: 0.05, hills: 0.45, weather: 'none', building: 'hut', waterBody: 'lake' },
  farm:    { ground: ['#4d7a3d', '#82a955'], water: '#3b7f9e', sky: '#ffdca8', fog: '#c8c2a8', fogD: 0.0015, light: '#ffe6b0', trees: 'broad', treeN: 90, grass: 0.75, rock: 0.03, hills: 0.35, weather: 'none', building: 'farm', waterBody: 'pond' },
  alpine:  { ground: ['#7d8891', '#d6dde2'], water: '#3f6f8e', sky: '#bfe0f5', fog: '#cdd8e0', fogD: 0.0016, light: '#f4f9ff', trees: 'pine', treeN: 100, grass: 0.15, rock: 0.5, hills: 1.0, weather: 'snow', building: 'none', waterBody: 'none' },
  taiga:   { ground: ['#546b50', '#c9d7cf'], water: '#3a6880', sky: '#a9cfe8', fog: '#bccbd4', fogD: 0.0017, light: '#eaf5ff', trees: 'pine', treeN: 200, grass: 0.25, rock: 0.2, hills: 0.6, weather: 'snow', building: 'none', waterBody: 'none' },
  river:   { ground: ['#5d8a4a', '#8fae62'], water: '#3d7c96', sky: '#c8e8e0', fog: '#b8ccc0', fogD: 0.0016, light: '#f2ffe8', trees: 'broad', treeN: 80, grass: 0.7, rock: 0.06, hills: 0.5, weather: 'mist', building: 'terrace', waterBody: 'river' },
  plateau: { ground: ['#9a8a5d', '#c7b07a'], water: '#3a6d80', sky: '#e6d9a8', fog: '#cfc2a0', fogD: 0.0018, light: '#fff0d0', trees: 'broad', treeN: 20, grass: 0.35, rock: 0.5, hills: 0.8, weather: 'none', building: 'none', waterBody: 'none' },
  steppe:  { ground: ['#7d9450', '#b3b96a'], water: '#3c7288', sky: '#cfe0f0', fog: '#c2cbb0', fogD: 0.0016, light: '#fff2cc', trees: 'broad', treeN: 8, grass: 0.9, rock: 0.04, hills: 0.3, weather: 'none', building: 'yurt', waterBody: 'none' },
  med:     { ground: ['#7d8a55', '#b0a06c'], water: '#2f6f92', sky: '#cfe8f5', fog: '#c8d4c8', fogD: 0.0015, light: '#fff0d2', trees: 'broad', treeN: 70, grass: 0.5, rock: 0.15, hills: 0.6, weather: 'none', building: 'hut', waterBody: 'none' },
  savanna: { ground: ['#a08a4c', '#c9b065'], water: '#38778e', sky: '#e8d9a8', fog: '#cdbf96', fogD: 0.0016, light: '#ffedc0', trees: 'acacia', treeN: 45, grass: 0.8, rock: 0.05, hills: 0.25, weather: 'none', building: 'hut', waterBody: 'none' },
  jungle:  { ground: ['#2f5b33', '#56804a'], water: '#2a6d78', sky: '#a8d8c0', fog: '#5f8a72', fogD: 0.0030, light: '#d8ffd8', trees: 'jungle', treeN: 260, grass: 0.7, rock: 0.02, hills: 0.5, weather: 'rain', building: 'none', waterBody: 'none' },
  tropical:{ ground: ['#356a3a', '#6c9a55'], water: '#2f7d86', sky: '#b8e8d8', fog: '#7ba98b', fogD: 0.0026, light: '#e2ffe0', trees: 'jungle', treeN: 240, grass: 0.75, rock: 0.02, hills: 0.55, weather: 'rain', building: 'none', waterBody: 'river' },
  alpine2: { ground: ['#66705c', '#b8c4ac'], water: '#3f6f8e', sky: '#c8e2f0', fog: '#c2ccd0', fogD: 0.0016, light: '#f2f8ff', trees: 'pine', treeN: 160, grass: 0.3, rock: 0.4, hills: 0.9, weather: 'mist', building: 'none', waterBody: 'lake' },
  prairie: { ground: ['#7d9a52', '#a8b86c'], water: '#3c7288', sky: '#d4e8f5', fog: '#c5cdb2', fogD: 0.0015, light: '#fff2d0', trees: 'broad', treeN: 12, grass: 0.95, rock: 0.02, hills: 0.2, weather: 'none', building: 'none', waterBody: 'none' },
  boreal:  { ground: ['#4c6152', '#9fb3a2'], water: '#315f78', sky: '#a8c8e0', fog: '#aebcc6', fogD: 0.0017, light: '#eaf4ff', trees: 'pine', treeN: 170, grass: 0.3, rock: 0.25, hills: 0.5, weather: 'none', building: 'hut', waterBody: 'lake' },
  pampa:   { ground: ['#8a9458', '#c0bd78'], water: '#38728a', sky: '#d8e8f2', fog: '#c6ccb2', fogD: 0.0015, light: '#fff4d4', trees: 'broad', treeN: 10, grass: 0.95, rock: 0.02, hills: 0.15, weather: 'none', building: 'none', waterBody: 'none' },
  desert:  { ground: ['#b08a58', '#d9b877'], water: '#3a6c80', sky: '#f0dfb0', fog: '#d5c39a', fogD: 0.0018, light: '#fff0cc', trees: 'cactus', treeN: 50, grass: 0.08, rock: 0.35, hills: 0.5, weather: 'none', building: 'none', waterBody: 'none' },
  forest:  { ground: ['#4a6b3c', '#7c9a56'], water: '#336f88', sky: '#b8d8e8', fog: '#b3c2ac', fogD: 0.0016, light: '#fff0d4', trees: 'broad', treeN: 180, grass: 0.55, rock: 0.08, hills: 0.6, weather: 'none', building: 'hut', waterBody: 'none' },
  rainforest:{ ground: ['#3c6036', '#6a915a'], water: '#2d6d80', sky: '#a8d0c8', fog: '#6d8f80', fogD: 0.0028, light: '#dffff0', trees: 'pine', treeN: 230, grass: 0.65, rock: 0.03, hills: 0.65, weather: 'mist', building: 'none', waterBody: 'none' },
  patagonia:{ ground: ['#7a7d68', '#b7b89b'], water: '#356a82', sky: '#bcd4e8', fog: '#bcc3bc', fogD: 0.0017, light: '#eef6ff', trees: 'broad', treeN: 25, grass: 0.55, rock: 0.45, hills: 0.85, weather: 'snow', building: 'none', waterBody: 'none' },
  generic:  { ground: ['#5c7052', '#93a87a'], water: '#336f88', sky: '#bcd8e8', fog: '#b3c2b2', fogD: 0.0016, light: '#f2f8e8', trees: 'broad', treeN: 80, grass: 0.5, rock: 0.08, hills: 0.4, weather: 'none', building: 'hut', waterBody: 'none' },
};

// 24 个生态舱（依据 kimstanleyrobinson.info 原著资料页整理）
export const BIOMES = [
  { id: 'tasmania',   name: '塔斯马尼亚', en: 'Tasmania',  ring: 'A', type: 'coast',   note: '温带海岸与森林' },
  { id: 'himalayas',  name: '喜马拉雅', en: 'Himalayas',  ring: 'A', type: 'alpine',  note: '高山雪峰' },
  { id: 'yangtze',    name: '长江',    en: 'Yangtze',     ring: 'A', type: 'river',   note: '稻田与河流' },
  { id: 'siberia',    name: '西伯利亚', en: 'Siberia',    ring: 'A', type: 'taiga',   note: '雪原针叶林' },
  { id: 'iran',       name: '伊朗',    en: 'Iran',        ring: 'A', type: 'plateau', note: '干旱高原' },
  { id: 'mongolia',   name: '蒙古',    en: 'Mongolia',    ring: 'A', type: 'steppe',  note: '游牧草原（菲娅游历之地）' },
  { id: 'steppes',    name: '欧亚草原', en: 'The Steppes', ring: 'A', type: 'steppe', note: '大草原' },
  { id: 'balkans',    name: '巴尔干',  en: 'The Balkans', ring: 'A', type: 'med',     note: '地中海式丘陵' },
  { id: 'kenya',      name: '肯尼亚',  en: 'Kenya',       ring: 'A', type: 'savanna', note: '稀树草原' },
  { id: 'bengal',     name: '孟加拉',  en: 'Bengal',      ring: 'A', type: 'jungle',  note: '季风雨林' },
  { id: 'indonesia',  name: '印度尼西亚', en: 'Indonesia', ring: 'A', type: 'tropical', note: '热带雨林' },
  { id: 'hokkaido',   name: '北海道',  en: 'Hokkaido',    ring: 'A', type: 'coast',   note: '温带湖泊森林' },
  { id: 'nova_scotia', name: '新斯科舍', en: 'Nova Scotia', ring: 'B', type: 'farm',  note: '德维（总工程师）一家的农庄' },
  { id: 'sierra',     name: '内华达山脉', en: 'Sierra',   ring: 'B', type: 'alpine2', note: '高山针叶林' },
  { id: 'prairie',    name: '大草原',  en: 'Prairie',     ring: 'B', type: 'prairie', note: '高草草原' },
  { id: 'labrador',   name: '拉布拉多', en: 'Labrador',   ring: 'B', type: 'boreal',  note: '寒带海岸（孩子长大才知身在飞船）' },
  { id: 'pampas',     name: '潘帕斯',  en: 'Pampas',      ring: 'B', type: 'pampa',   note: '潘帕草原' },
  { id: 'sonora',     name: '索诺拉',  en: 'Sonora',      ring: 'B', type: 'desert',  note: '沙漠仙人掌' },
  { id: 'piedmont',   name: '皮埃蒙特(?)', en: 'Piedmont', ring: 'B', type: 'forest', note: '丘陵阔叶林' },
  { id: 'costa_rica', name: '哥斯达黎加', en: 'Costa Rica', ring: 'B', type: 'tropical', note: '热带雨林' },
  { id: 'amazonia',   name: '亚马逊',  en: 'Amazonia',    ring: 'B', type: 'jungle',  note: '茂密丛林' },
  { id: 'olympia',    name: '奥林匹亚', en: 'Olympia',    ring: 'B', type: 'rainforest', note: '温带雨林' },
  { id: 'patagonia',  name: '巴塔哥尼亚', en: 'Patagonia', ring: 'B', type: 'patagonia', note: '风蚀山地草原' },
  { id: 'biome12',    name: '第 12 生态舱', en: 'Biome 12', ring: 'B', type: 'generic', note: '名称待考（原著资料未载）' },
];

// 外观部件描述（原著设定 / 合理演绎 标注）
export const PARTS = [
  {
    id: 'spine', name: '主轴（Spine）', kind: 'novel',
    desc: '贯穿全舰的中央长杆，长 10 公里。两个环如同套在车轴上的轮子。内部有轨道车、舰桥与 AI 量子核心，轴线方向为失重区。',
  },
  {
    id: 'ringA', name: '环 A（旧世界生态）', kind: 'novel',
    desc: '由 12 个生态舱相接成的环形，舱直径 1 公里、长 4 公里。环 A 承载东半球“旧世界”生态：塔斯马尼亚、喜马拉雅、长江、西伯利亚、蒙古等。',
  },
  {
    id: 'ringB', name: '环 B（新世界生态）', kind: 'novel',
    desc: '与环 A 对向旋转，承载西半球“新世界”生态：新斯科舍、拉布拉多、哥斯达黎加、亚马逊等。返回地球时取走的正是环 B 与主轴。',
  },
  {
    id: 'spokes', name: '辐条与轴承环', kind: 'novel',
    desc: '每个外环通过六根辐条与主轴相连；主轴上另有“内结构环”锁紧外环。两环反向旋转以抵消角动量。',
  },
  {
    id: 'bridge', name: '舰桥（主轴前端）', kind: 'infer',
    desc: '指挥与观景中枢，设有对地通信天线。舰桥的精密布局为视觉演绎，小说未逐件描述。',
  },
  {
    id: 'engine', name: '聚变发动机（尾段）', kind: 'novel',
    desc: '小说设定为聚变推进，出航时由土星轨道激光阵列助推；抵达与返航时借助磁场制动与引力弹弓减速（decel）。',
  },
  {
    id: 'decel', name: '减速磁场（Decel）', kind: 'novel',
    desc: '小说描写返航减速时“外壳先是暗红，继而发亮”——强磁场与恒星风相互作用制动的可视效果。可在下方开关展开演示。',
  },
  {
    id: 'biomes', name: '生态舱（Biome）', kind: 'novel',
    desc: '每舱直径 1 km、长 4 km，十二舱以 30° 相接，舱间闸门“两端各斜置 15°”。旋转提供 0.83g。点击任一舱段进入内部。',
  },
];
