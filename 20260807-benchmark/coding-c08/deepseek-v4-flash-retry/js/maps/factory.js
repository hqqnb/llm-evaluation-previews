(function () {
  const THREE = window.THREE;
  const TEX = window.TFPS.TEX;
  const MB = window.TFPS.MapBuilder;

  function buildFactory(scene) {
    const b = new MB(scene, "night");
    b.setBounds(0, 52, -52, 4);
    const CON = b.mat("concrete"), MET = b.mat("metal"), DARK = b.mat("darkWall");
    const CRW = b.mat("crateWood"), CRM = b.mat("crateMetal"), FLR = b.mat("metalFloor");
    const W = (cx, cz, w, d, h, m, o) => b.wall(cx, cz, w, d, h, m || DARK, o);

    // Ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 76), new THREE.MeshLambertMaterial({ map: TEX.get("concrete") }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(26, 0, -24);
    ground.receiveShadow = true;
    b.decor(ground, { cast: false });

    // Outer boundary
    W(26, 4, 52, 0.6, 6);
    W(26, -52, 52, 0.6, 6);
    W(0, -24, 0.6, 56, 6);
    W(52, -24, 0.6, 56, 6);

    // T spawn area x18..34 z0..4 with three exits (west/central/east)
    W(22.5, 2, 3, 0.5, 5);
    W(29, 2, 2, 0.5, 5);
    b.crate(20, 0, 2, 1.2, 1.2, 1.2, "metal");
    b.crate(32, 0, 2, 1.2, 1.2, 1.2, "wood");

    // A route: west corridor x6..16 z-6..2
    W(6, -2, 0.5, 8, 5);
    W(16, -4, 0.5, 4, 5);
    W(11, -6, 10, 0.5, 5);
    b.crate(9, 0, -3, 1.2, 1.2, 1.2, "metal");
    // A site x2..16 z-20..-36
    W(2, -28, 0.5, 16, 5);
    W(16, -28, 0.5, 16, 5);
    W(9, -20, 14, 0.5, 5); // south wall with opening x6..12
    W(9, -36, 14, 0.5, 5); // north wall with opening x8..12 (CT connector)
    W(5.5, -28, 6, 0.5, 5);
    // Vault room (inner)
    W(6, -24, 0.5, 4, 4);
    W(6, -32, 0.5, 4, 4);
    b.box(9, 1.0, -28, 6, 2.0, 8, CON); // vault block (center)
    b.stairs(9, -21.5, 3, "n", 6, 0.34, 0.35, CON);
    b.crate(13, 0, -24, 1.4, 1.2, 1.4, "metal");
    b.crate(12, 0, -33, 1.4, 1.2, 1.4, "wood");
    b.barrel(4, 0, -24, 0.36, 0.95, 0x8a2f2f);
    b.barrel(4, 0, -32, 0.36, 0.95, 0x8a2f2f);
    b.sandbag(14, 0, -30, 1.6, 0.6, 0.6);

    // CT connector to A: x6..14 z-46..-42, then south to A north door
    W(6, -44, 0.5, 4, 5);
    W(14, -44, 0.5, 4, 5);
    W(7, -42, 2, 0.5, 5);
    W(13, -42, 2, 0.5, 5);
    b.crate(8, 0, -39, 1.2, 1.2, 1.2, "wood");

    // B route: east corridor x36..46 z-6..2
    W(36, -4, 0.5, 4, 5);
    W(46, -2, 0.5, 8, 5);
    W(41, -6, 10, 0.5, 5);
    b.crate(43, 0, -3, 1.2, 1.2, 1.2, "metal");
    // Stairs up to B upper at x44..48 z-8..-20
    b.stairs(46, -17.5, 3, "n", 7, 0.29, 0.3, CON);
    // B site upper floor x28..50 z-20..-36 y2
    b.box(39, 1.0, -28, 22, 0.2, 16, FLR, { cast: false });
    W(28, -28, 0.5, 16, 5);   // west wall
    W(50, -28, 0.5, 16, 5);   // east wall
    W(39, -20, 22, 0.5, 5);   // south wall with opening x44..48 (stairs)
    W(29, -36, 2, 0.5, 5);
    W(37, -36, 6, 0.5, 5);
    W(47, -36, 6, 0.5, 5);   // north wall with openings x30..34 and x40..44
    W(33, -28, 10, 0.5, 5);
    // Server room block
    b.box(36, 3.0, -30, 5, 2.0, 8, CON);
    b.stairs(36, -19.5, 2.5, "s", 3, 0.34, 0.35, CON);
    b.crate(46, 2, -24, 1.4, 1.2, 1.4, "metal");
    b.crate(44, 2, -33, 1.4, 1.2, 1.4, "wood");
    b.crate(30, 2, -24, 1.3, 1.3, 1.3, "metal");
    b.barrel(48, 2, -28, 0.36, 0.95, 0x2f4d8a);
    b.barrel(29, 2, -33, 0.36, 0.95, 0x2f4d8a);
    b.sandbag(32, 2, -31, 1.6, 0.6, 0.6);
    // CT connector to B: x38..46 z-46..-42, stairs up at x40..44 z-40..-38
    W(38, -44, 0.5, 4, 5);
    W(46, -44, 0.5, 4, 5);
    W(39, -42, 2, 0.5, 5);
    W(45, -42, 2, 0.5, 5);
    b.stairs(42, -38.5, 3, "s", 7, 0.29, 0.3, CON);
    W(30, -40, 0.5, 4, 5);
    W(34, -40, 0.5, 4, 5);

    // Central corridor x22..30 z-4..-40
    W(22, -22, 0.5, 36, 5);
    W(30, -22, 0.5, 36, 5);
    W(23, -4, 2, 0.5, 5);
    W(29, -4, 2, 0.5, 5);
    W(26, -40, 8, 0.5, 5);
    // Central crates
    b.crate(24, 0, -14, 1.4, 1.2, 1.4, "metal");
    b.crate(28, 0, -20, 1.4, 1.2, 1.4, "wood");
    b.crate(24, 0, -28, 1.4, 1.2, 1.4, "metal");
    b.crate(28, 0, -34, 1.4, 1.2, 1.4, "wood");
    b.barrel(26, 0, -25, 0.36, 0.95, 0x8a7a2f);

    // CT spawn x14..38 z-46..-40
    W(14, -43, 0.5, 6, 5);
    W(38, -43, 0.5, 6, 5);
    W(26, -46, 24, 0.5, 5);
    b.crate(16, 0, -42, 1.3, 1.2, 1.3, "metal");
    b.crate(36, 0, -42, 1.3, 1.2, 1.3, "metal");
    b.sign(25.5, 2.3, -46.5, 2, 1, "CT SPAWN", "#24455f");
    b.sign(10.5, 2.3, -19.5, 2, 1, "A VAULT", "#4a4a3a");
    b.sign(40.5, 4.3, -20.5, 2, 1, "B SERVER", "#4a4a3a");

    // Pipes/lamps
    b.lamp(26, 3.6, -2, 0xbfe0ff, 2.2, 30);
    b.lamp(26, 3.6, -20, 0xbfe0ff, 2.2, 30);
    b.lamp(26, 3.6, -38, 0xbfe0ff, 2.2, 30);
    b.lamp(9, 3.6, -28, 0xbfe0ff, 2.0, 28);
    b.lamp(39, 5.6, -28, 0xbfe0ff, 2.0, 28);
    b.lamp(26, 3.6, -44, 0xbfe0ff, 2.0, 28);

    // Spawns
    b.addSpawn("t", 19, 2, 0);
    b.addSpawn("t", 25, 2.5, 0);
    b.addSpawn("t", 33, 2, 0);
    b.addSpawn("t", 19.5, 3, 0);
    b.addSpawn("t", 33.5, 3, 0);
    b.addSpawn("t", 25.5, 1.5, 0);
    b.addSpawn("ct", 18, -43, Math.PI);
    b.addSpawn("ct", 26, -43, Math.PI);
    b.addSpawn("ct", 34, -43, Math.PI);
    b.addSpawn("ct", 22, -44, Math.PI);
    b.addSpawn("ct", 30, -44, Math.PI);
    b.addSpawn("ct", 26, -45, Math.PI);

    b.addSite("a", 9, -28, 5, [{ x: 8, z: -26 }, { x: 12, z: -30 }, { x: 5, z: -30 }, { x: 10, z: -33 }], "A 金库");
    b.addSite("b", 39, -28, 5.5, [{ x: 38, z: -26 }, { x: 42, z: -30 }, { x: 36, z: -32 }, { x: 44, z: -32 }], "B 服务器");

    // Nav
    const N = (id, x, z, y, f) => b.addNav(id, x, z, y, f);
    const L = (a, c) => b.linkNav(a, c);
    N("ts1", 26, 2, 0); N("ts2", 12, 2, 0); N("ts3", 40, 2, 0);
    N("al1", 10, -2, 0); N("al2", 8, -10, 0); N("al3", 8, -16, 0);
    N("as1", 8, -24, 0); N("as2", 8, -30, 0); N("as3", 5, -28, 0); N("as4", 12, -28, 0);
    N("ca1", 10, -38, 0); N("ca2", 10, -43, 0);
    N("bl1", 42, -2, 0); N("bl2", 44, -8, 0); N("bl3", 46, -16, 0);
    N("bup1", 46, -22, 2); N("bup2", 40, -28, 2); N("bup3", 34, -28, 2);
    N("bs1", 38, -26, 2); N("bs2", 44, -30, 2); N("bs3", 34, -32, 2);
    N("cb1", 42, -38, 0); N("cb2", 42, -43, 0);
    N("mid1", 26, -8, 0); N("mid2", 26, -16, 0); N("mid3", 26, -24, 0);
    N("mid4", 26, -32, 0); N("mid5", 26, -38, 0);
    N("ct1", 26, -43, 0); N("ct2", 20, -43, 0); N("ct3", 32, -43, 0);

    L("ts1", "ts2"); L("ts1", "ts3"); L("ts1", "mid1");
    L("ts2", "al1"); L("al1", "al2"); L("al2", "al3"); L("al3", "as1");
    L("as1", "as2"); L("as1", "as3"); L("as2", "as4"); L("as4", "as2");
    L("as2", "ca1"); L("ca1", "ca2");
    L("ts3", "bl1"); L("bl1", "bl2"); L("bl2", "bl3"); L("bl3", "bup1");
    L("bup1", "bup2"); L("bup2", "bup3"); L("bs1", "bup2"); L("bs2", "bup2"); L("bs3", "bup3");
    L("bup1", "bs1"); L("bup1", "bs2"); L("bup3", "bs3");
    L("bs1", "cb1"); L("cb1", "cb2");
    L("mid1", "mid2"); L("mid2", "mid3"); L("mid3", "mid4"); L("mid4", "mid5");
    L("mid5", "ct1"); L("ct1", "ct2"); L("ct1", "ct3"); L("ct2", "ca2"); L("ct3", "cb2");
    L("as3", "as1"); L("as4", "as2");

    const map = Object.assign(b.build(), {
      id: "factory",
      name: "工业堡垒",
      shortName: "Factory",
      desc: "夜间工业仓库：近距离转角战、垂直双层结构、中央走廊与双包点。节奏紧凑，拼枪快。",
      sky: "night",
      ambient: 0xcfe4ff,
      fog: 0x2a3644,
      ambienceKind: "night",
      plans: {
        tRoutes: [
          { name: "A金库强攻", site: "a", nodes: ["ts2", "al1", "al2", "al3", "as1", "as2"] },
          { name: "中央转A", site: "a", nodes: ["ts1", "mid1", "mid2", "mid3", "mid4", "mid5", "ct1", "ct2", "ca2", "ca1", "as2"] },
          { name: "B服务器快攻", site: "b", nodes: ["ts3", "bl1", "bl2", "bl3", "bup1", "bs1"] },
          { name: "中央转B", site: "b", nodes: ["ts1", "mid1", "mid2", "mid3", "mid4", "mid5", "ct1", "ct3", "cb2", "cb1", "bs1"] }
        ],
        ctHolds: [
          { node: "as1", site: "a", area: "A金库" },
          { node: "as2", site: "a", area: "A内" },
          { node: "ca1", site: "a", area: "A通道" },
          { node: "bs1", site: "b", area: "B服务器" },
          { node: "bup3", site: "b", area: "B西" },
          { node: "mid3", site: null, area: "中央" },
          { node: "ct1", site: null, area: "CT出生点" }
        ],
        retake: {
          a: ["ct1", "ct2", "ca2", "ca1", "as2"],
          b: ["ct1", "ct3", "cb2", "cb1", "bs1"]
        }
      }
    });
    return map;
  }

  window.TFPS.MAPS = window.TFPS.MAPS || {};
  window.TFPS.MAPS.factory = buildFactory;
})();
