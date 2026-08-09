(function () {
  const W = {
    knife: {
      id: "knife", slot: "melee", name: "战术刀", price: 0, dmg: 52, heavyDmg: 105, rate: 1.45,
      range: 1.8, move: 1.02, killReward: 1500, auto: false, switchTime: 0.32, icon: "刀"
    },
    glock: {
      id: "glock", slot: "pistol", name: "Glock-18", price: 200, dmg: 28, armorPen: 0.47,
      rpm: 400, mag: 20, reserve: 120, reload: 2.3, spread: 0.020, move: 0.98, killReward: 300,
      auto: false, switchTime: 0.42, tracer: true, zoomFov: 0, falloff: 16, icon: "Glock"
    },
    usp: {
      id: "usp", slot: "pistol", name: "USP-S", price: 200, dmg: 32, armorPen: 0.50,
      rpm: 380, mag: 12, reserve: 24, reload: 2.2, spread: 0.013, move: 0.98, killReward: 300,
      auto: false, switchTime: 0.42, tracer: true, zoomFov: 0, falloff: 18, icon: "USP"
    },
    deagle: {
      id: "deagle", slot: "pistol", name: "沙漠之鹰", price: 700, dmg: 55, armorPen: 0.78,
      rpm: 267, mag: 7, reserve: 35, reload: 2.7, spread: 0.035, move: 0.96, killReward: 300,
      auto: false, switchTime: 0.5, tracer: true, zoomFov: 0, falloff: 30, icon: "Deagle"
    },
    mp5: {
      id: "mp5", slot: "smg", name: "MP5-SD", price: 1500, dmg: 28, armorPen: 0.55,
      rpm: 720, mag: 30, reserve: 120, reload: 2.8, spread: 0.032, move: 1.0, killReward: 600,
      auto: true, switchTime: 0.5, tracer: true, zoomFov: 0, falloff: 14, icon: "MP5"
    },
    mp7: {
      id: "mp7", slot: "smg", name: "MP7", price: 1700, dmg: 30, armorPen: 0.60,
      rpm: 780, mag: 30, reserve: 120, reload: 2.9, spread: 0.034, move: 1.0, killReward: 600,
      auto: true, switchTime: 0.5, tracer: true, zoomFov: 0, falloff: 15, icon: "MP7"
    },
    nova: {
      id: "nova", slot: "shotgun", name: "Nova", price: 1050, dmg: 16, pellets: 8, armorPen: 0.30,
      rpm: 75, mag: 8, reserve: 32, reload: 3.8, spread: 0.09, move: 0.95, killReward: 900,
      auto: false, switchTime: 0.6, tracer: false, zoomFov: 0, falloff: 11, icon: "Nova"
    },
    ak47: {
      id: "ak47", slot: "rifle", name: "AK-47", price: 2700, dmg: 36, armorPen: 0.78,
      rpm: 600, mag: 30, reserve: 90, reload: 2.5, spread: 0.016, move: 0.92, killReward: 300,
      auto: true, switchTime: 0.55, tracer: true, zoomFov: 0, falloff: 40, icon: "AK"
    },
    m4a4: {
      id: "m4a4", slot: "rifle", name: "M4A4", price: 3100, dmg: 33, armorPen: 0.72,
      rpm: 666, mag: 30, reserve: 90, reload: 2.6, spread: 0.015, move: 0.92, killReward: 300,
      auto: true, switchTime: 0.55, tracer: true, zoomFov: 0, falloff: 40, icon: "M4"
    },
    awp: {
      id: "awp", slot: "sniper", name: "AWP", price: 4750, dmg: 115, armorPen: 0.98,
      rpm: 41, mag: 10, reserve: 30, reload: 3.8, spread: 0.0015, move: 0.82, killReward: 100,
      auto: false, switchTime: 0.75, tracer: true, zoomFov: 38, zoomMove: 0.55, falloff: 90, icon: "AWP"
    },
    he: { id: "he", slot: "grenade", name: "高爆手雷", price: 300, dmg: 96, radius: 6.2, killReward: 300, icon: "HE" },
    flash: { id: "flash", slot: "grenade", name: "闪光弹", price: 200, radius: 13, killReward: 300, icon: "FL" },
    smoke: { id: "smoke", slot: "grenade", name: "烟雾弹", price: 300, duration: 16, killReward: 300, icon: "SM" },
    molotov: { id: "molotov", slot: "grenade", name: "燃烧瓶", price: 400, radius: 2.8, duration: 7, killReward: 300, icon: "FB" }
  };

  const BUYS = {
    pistols: [
      { id: "glock", team: "T", desc: "标准 T 手枪，20 发弹匣" },
      { id: "usp", team: "CT", desc: "消音手枪，精度高" },
      { id: "deagle", desc: "高伤害大口径手枪" }
    ],
    smgs: [
      { id: "mp5", desc: "消音冲锋枪，机动性强" },
      { id: "mp7", desc: "高射速冲锋枪" }
    ],
    shotguns: [{ id: "nova", desc: "近距离多弹丸霰弹" }],
    rifles: [
      { id: "ak47", team: "T", desc: "T 主力步枪，高穿透" },
      { id: "m4a4", team: "CT", desc: "CT 主力步枪，可控后坐力" }
    ],
    snipers: [{ id: "awp", desc: "一击必杀，开镜射击" }],
    equipment: [
      { id: "kevlar", price: 650, desc: "防弹衣（减少身体伤害）" },
      { id: "helmet", price: 350, desc: "防弹头盔（需防弹衣）" },
      { id: "defuse", price: 400, team: "CT", desc: "拆弹器（拆包 5 秒）" }
    ],
    grenades: [
      { id: "he", desc: "高爆手雷" },
      { id: "flash", desc: "闪光弹" },
      { id: "smoke", desc: "烟雾弹" },
      { id: "molotov", desc: "燃烧瓶" }
    ]
  };

  const CATS = [
    ["pistols", "手枪", "1"], ["smgs", "冲锋枪", "2"], ["shotguns", "霰弹枪", "3"],
    ["rifles", "步枪", "4"], ["snipers", "狙击枪", "5"], ["equipment", "装备", "6"], ["grenades", "投掷物", "7"]
  ];

  const DIFF = {
    easy: {
      label: "简单", reaction: [0.8, 1.2], aimError: 0.13, burst: [1, 2], burstDelay: [0.35, 0.7],
      strafe: 0.35, nadeChance: 0.35, headChance: 0.05, keepDistance: 0.65, movePeek: 0.5, useCover: 0.25
    },
    normal: {
      label: "普通", reaction: [0.45, 0.75], aimError: 0.062, burst: [2, 4], burstDelay: [0.18, 0.35],
      strafe: 0.75, nadeChance: 0.65, headChance: 0.14, keepDistance: 0.85, movePeek: 0.75, useCover: 0.55
    },
    hard: {
      label: "困难", reaction: [0.2, 0.4], aimError: 0.024, burst: [3, 6], burstDelay: [0.08, 0.16],
      strafe: 1.0, nadeChance: 0.9, headChance: 0.28, keepDistance: 1.0, movePeek: 1.0, useCover: 0.9
    }
  };

  const NAMES = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India",
    "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo",
    "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu",
    "幽灵", "猎鹰", "毒蛇", "灰狼", "雷鹰", "黑豹", "雄狮", "眼镜蛇", "山猫", "战隼"
  ];

  const PHYS = {
    gravity: 24, jump: 8.2, walkSpeed: 5.1, crouchSpeed: 2.7, walkQuietSpeed: 1.7,
    sprintSpeed: 6.6, accel: 60, airAccel: 12, eyeStand: 1.62, eyeCrouch: 0.92,
    halfW: 0.34, standH: 1.78, crouchH: 1.05, step: 0.32
  };

  window.TFPS.W = W;
  window.TFPS.BUYS = BUYS;
  window.TFPS.CATS = CATS;
  window.TFPS.DIFF = DIFF;
  window.TFPS.NAMES = NAMES;
  window.TFPS.PHYS = PHYS;
})();
