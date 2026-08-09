(function () {
  const THREE = window.THREE;
  const TEX = window.TFPS.TEX;
  const MB = window.TFPS.MapBuilder;

  function buildOutpost(scene) {
    const b = new MB(scene, "snow");
    b.setBounds(0, 80, -80, 6);
    const SNW = b.mat("snowWall"), CON = b.mat("concrete"), MET = b.mat("metal");
    const CRW = b.mat("crateWood"), CRM = b.mat("crateMetal");
    const W = (cx, cz, w, d, h, m, o) => b.wall(cx, cz, w, d, h, m || SNW, o);

    // Ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), new THREE.MeshLambertMaterial({ map: TEX.get("snow") }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(40, 0, -40);
    ground.receiveShadow = true;
    b.decor(ground, { cast: false });
    // Ice lake
    const ice = new THREE.Mesh(new THREE.PlaneGeometry(18, 10), new THREE.MeshLambertMaterial({ map: TEX.get("ice") }));
    ice.rotation.x = -Math.PI / 2; ice.position.set(40, 0.02, -60);
    b.decor(ice, { cast: false });

    // Outer boundary
    W(40, 6, 80, 0.7, 5);
    W(40, -80, 80, 0.7, 5);
    W(0, -37, 0.7, 86, 5);
    W(80, -37, 0.7, 86, 5);

    // T spawn x6..24 z-2..6
    W(24, 0, 0.5, 6, 5);
    W(8, -2, 4, 0.5, 5);
    W(17, -2, 6, 0.5, 5); // openings x10..14 (A) and x20..24 (east road)
    b.crate(10, 0, 3, 1.4, 1.2, 1.4, "metal");
    b.crate(20, 0, 3, 1.4, 1.2, 1.4, "wood");

    // West corridor to A: x4..14 z-6..-36
    W(4, -21, 0.5, 30, 5);
    W(14, -21, 0.5, 30, 5);
    W(9, -6, 10, 0.5, 5);
    W(9, -36, 10, 0.5, 5);
    b.crate(8, 0, -16, 1.4, 1.2, 1.4, "wood");
    b.crate(10, 0, -28, 1.4, 1.2, 1.4, "metal");
    // A site x2..22 z-50..-36
    W(2, -43, 0.5, 14, 5);
    W(22, -43, 0.5, 14, 5);
    W(12, -50, 20, 0.5, 5); // north wall with opening x16..22
    W(12, -36, 20, 0.5, 5); // south wall with opening x6..14 (west corridor)
    W(7, -43, 10, 0.5, 5);
    // Bunker block
    b.box(8, 1.0, -43, 6, 2.0, 8, CON);
    b.stairs(8, -38.5, 3, "n", 6, 0.34, 0.2, CON);
    b.crate(16, 0, -40, 1.4, 1.2, 1.4, "metal");
    b.crate(18, 0, -46, 1.4, 1.2, 1.4, "wood");
    b.barrel(4, 0, -40, 0.36, 0.95, 0x6f6f4a);
    b.sandbag(20, 0, -42, 1.6, 0.6, 0.6);
    // A watchtower
    W(4.5, -46.5, 0.3, 3, 3, CON);
    W(7.5, -46.5, 0.3, 3, 3, CON);
    W(6, -48.5, 3, 0.3, 3, CON);
    b.box(6, 2.6, -47, 2.8, 0.2, 2.8, CON, { cast: false });
    b.stairs(6, -45.4, 2, "n", 5, 0.54, 0.25, MET);

    // South road to B: z-8..-2 x24..56 then north corridor x56..76 z-14..-42
    W(56, -4, 0.5, 4, 5);
    W(56, -11, 0.5, 2, 5);
    W(42, -8, 28, 0.5, 5); // road north wall x28..56 (opening x24..28)
    W(66, -14, 20, 0.5, 5); // B corridor south wall x56..76
    W(66, -42, 20, 0.5, 5); // B corridor north wall x56..76
    W(76, -28, 0.5, 28, 5); // B corridor east wall
    W(56, -28, 0.5, 28, 5); // B corridor west wall with opening x62..70 at z-42? (door)
    W(64, -42, 8, 0.5, 5);
    b.crate(32, 0, -5, 1.4, 1.2, 1.4, "metal");
    b.crate(48, 0, -5, 1.4, 1.2, 1.4, "wood");
    b.crate(60, 0, -22, 1.4, 1.2, 1.4, "metal");
    b.crate(70, 0, -28, 1.4, 1.2, 1.4, "wood");
    b.barrel(44, 0, -6, 0.36, 0.95, 0x8a6f2f);
    b.barrel(64, 0, -34, 0.36, 0.95, 0x8a6f2f);

    // B site x56..78 z-58..-42
    W(78, -50, 0.5, 16, 5);
    W(56, -50, 0.5, 16, 5);
    W(67, -58, 22, 0.5, 5); // north wall with opening x60..68 (CT corridor)
    W(67, -42, 22, 0.5, 5); // south wall with opening x62..70
    W(62, -50, 12, 0.5, 5);
    b.box(66, 1.0, -50, 6, 2.0, 8, CON);
    b.stairs(66, -44.5, 3, "n", 6, 0.34, 0.2, CON);
    b.crate(60, 0, -46, 1.4, 1.2, 1.4, "wood");
    b.crate(72, 0, -46, 1.4, 1.2, 1.4, "metal");
    b.crate(60, 0, -54, 1.4, 1.2, 1.4, "metal");
    b.crate(72, 0, -54, 1.4, 1.2, 1.4, "wood");
    b.barrel(76, 0, -52, 0.36, 0.95, 0x6f7a3a);
    b.sandbag(58, 0, -48, 1.6, 0.6, 0.6);
    // B watchtower
    W(68.5, -52.5, 0.3, 3, 3, CON);
    W(71.5, -52.5, 0.3, 3, 3, CON);
    W(70, -54.5, 3, 0.3, 3, CON);
    b.box(70, 2.6, -53, 2.8, 0.2, 2.8, CON, { cast: false });
    b.stairs(70, -50.4, 2, "n", 5, 0.54, 0.25, MET);

    // Mid hill x32..48 z-36..-28 y2.2
    b.box(40, 1.1, -32, 16, 2.2, 8, CON);
    b.stairs(40, -26, 3, "n", 4, 0.55, 0.4, CON);   // south stairs
    b.stairs(40, -38, 3, "s", 4, 0.55, 0.4, CON);   // north stairs
    b.crate(36, 2.2, -32, 1.4, 1.2, 1.4, "metal");
    b.crate(44, 2.2, -32, 1.4, 1.2, 1.4, "wood");
    b.barrel(40, 2.2, -30, 0.36, 0.95, 0x6f7a3a);
    b.sandbag(34, 2.2, -30, 1.6, 0.6, 0.6);
    b.sandbag(46, 2.2, -34, 1.6, 0.6, 0.6);
    // Mid approach south: x24..56 z-8..-28 (open area bounded by walls)
    W(24, -16, 0.5, 16, 5);
    W(56, -16, 0.5, 16, 5);
    W(40, -28, 32, 0.5, 5); // wall south of hill with opening x36..44
    W(38, -28, 4, 0.5, 5); W(44, -28, 4, 0.5, 5);

    // CT spawn x48..70 z-78..-68
    W(48, -73, 0.5, 10, 5);
    W(70, -73, 0.5, 10, 5);
    W(59, -78, 22, 0.5, 5);
    b.crate(52, 0, -72, 1.4, 1.2, 1.4, "metal");
    b.crate(66, 0, -72, 1.4, 1.2, 1.4, "wood");
    b.sign(59.5, 2.3, -77.5, 2, 1, "CT SPAWN", "#24455f");

    // CT west corridor to mid/A: x30..48 z-62..-56
    W(48, -59, 0.5, 6, 5);
    W(30, -59, 0.5, 6, 5);
    W(36, -62, 12, 0.5, 5);
    W(42, -56, 12, 0.5, 5);
    // CT A connector: x24..30 z-56..-50
    W(27, -53, 6, 0.5, 5);
    W(30, -53, 0.5, 6, 5);
    // CT B corridor: x56..68 z-68..-58
    W(56, -63, 0.5, 10, 5);
    W(68, -63, 0.5, 10, 5);
    W(58, -68, 4, 0.5, 5);
    W(66, -68, 4, 0.5, 5);
    W(62, -58, 12, 0.5, 5);
    b.crate(34, 0, -60, 1.3, 1.2, 1.3, "metal");
    b.crate(60, 0, -62, 1.3, 1.2, 1.3, "wood");

    b.sign(21.5, 2.3, -35.5, 2, 1, "A BUNKER", "#4a4a3a");
    b.sign(61, 2.3, -42.5, 2, 1, "B COMPOUND", "#4a4a3a");
    b.sign(40, 4.3, -29, 1.5, 0.9, "MID HILL", "#4a4a3a");
    b.lamp(8, 3.6, -8, 0xcfe8ff, 1.0, 20);
    b.lamp(8, 3.6, -44, 0xcfe8ff, 1.2, 24);
    b.lamp(66, 3.6, -48, 0xcfe8ff, 1.2, 24);
    b.lamp(40, 3.6, -12, 0xcfe8ff, 1.0, 22);
    b.lamp(40, 3.6, -56, 0xcfe8ff, 1.0, 22);
    b.lamp(59, 3.6, -72, 0xcfe8ff, 1.0, 22);

    // Spawns
    b.addSpawn("t", 8, 4, 0);
    b.addSpawn("t", 14, 4, 0);
    b.addSpawn("t", 21, 4, 0);
    b.addSpawn("t", 11, 1, 0);
    b.addSpawn("t", 17, 1, 0);
    b.addSpawn("t", 8, 0, 0);
    b.addSpawn("ct", 52, -72, Math.PI);
    b.addSpawn("ct", 59, -72, Math.PI);
    b.addSpawn("ct", 66, -72, Math.PI);
    b.addSpawn("ct", 55, -75, Math.PI);
    b.addSpawn("ct", 63, -75, Math.PI);
    b.addSpawn("ct", 59, -70, Math.PI);

    b.addSite("a", 12, -43, 6, [{ x: 10, z: -42 }, { x: 16, z: -44 }, { x: 8, z: -46 }, { x: 14, z: -48 }], "A 地堡");
    b.addSite("b", 67, -50, 6, [{ x: 64, z: -48 }, { x: 70, z: -50 }, { x: 66, z: -54 }, { x: 68, z: -44 }], "B 营地");

    // Nav
    const N = (id, x, z, y, f) => b.addNav(id, x, z, y, f);
    const L = (a, c) => b.linkNav(a, c);
    N("ts1", 12, 2, 0); N("ts2", 20, 2, 0);
    N("al1", 8, -10, 0); N("al2", 8, -22, 0); N("al3", 8, -34, 0);
    N("as1", 8, -40, 0); N("as2", 12, -44, 0); N("as3", 6, -46, 0); N("as4", 16, -42, 0);
    N("ms1", 30, -8, 0); N("ms2", 36, -16, 0); N("ms3", 40, -22, 0);
    N("mt1", 40, -30, 2.2); N("mt2", 40, -34, 2.2);
    N("mn1", 40, -42, 0); N("mn2", 40, -52, 0); N("mn3", 40, -60, 0);
    N("br1", 44, -6, 0); N("br2", 52, -6, 0); N("br3", 60, -14, 0);
    N("br4", 64, -24, 0); N("br5", 64, -36, 0); N("bs1", 64, -44, 0);
    N("bs2", 68, -48, 0); N("bs3", 60, -50, 0); N("bs4", 72, -52, 0);
    N("ct1", 56, -72, 0); N("ct2", 60, -66, 0); N("ct3", 52, -66, 0); N("ct4", 44, -62, 0);
    N("ca1", 36, -60, 0); N("ca2", 28, -56, 0); N("ca3", 22, -52, 0); N("ca4", 18, -48, 0);
    N("cb1", 58, -62, 0); N("cb2", 62, -56, 0);

    L("ts1", "ts2"); L("ts1", "al1"); L("ts2", "ms1"); L("ts2", "br1");
    L("al1", "al2"); L("al2", "al3"); L("al3", "as1");
    L("as1", "as2"); L("as1", "as3"); L("as2", "as4"); L("as2", "as3");
    L("as4", "ca4"); L("ca4", "ca3"); L("ca3", "ca2"); L("ca2", "ca1");
    L("ms1", "ms2"); L("ms2", "ms3"); L("ms3", "mt1"); L("mt1", "mt2");
    L("mt2", "mn1"); L("mn1", "mn2"); L("mn2", "mn3"); L("mn3", "ct4");
    L("br1", "br2"); L("br2", "br3"); L("br3", "br4"); L("br4", "br5"); L("br5", "bs1");
    L("bs1", "bs2"); L("bs1", "bs3"); L("bs2", "bs4"); L("bs3", "bs2");
    L("ct1", "ct2"); L("ct1", "ct3"); L("ct3", "ct4"); L("ct2", "cb1");
    L("ct4", "ca1"); L("cb1", "cb2"); L("cb2", "bs1"); L("ca1", "ca2");
    L("mn2", "ca1"); L("mn3", "ct4"); L("mn2", "cb1"); L("ct4", "ca1");
    L("ct2", "ct3");

    const map = Object.assign(b.build(), {
      id: "outpost",
      name: "霜线前哨",
      shortName: "Outpost",
      desc: "雪地远距离图：中央高地、冰湖开阔带、双哨塔与超长狙击线。节奏偏慢，讲究控图与架枪。",
      sky: "snow",
      ambient: 0xe8f2ff,
      fog: 0xccd9e4,
      ambienceKind: "snow",
      plans: {
        tRoutes: [
          { name: "A地堡推进", site: "a", nodes: ["ts1", "al1", "al2", "al3", "as1", "as2"] },
          { name: "中央高地转A", site: "a", nodes: ["ts2", "ms1", "ms2", "ms3", "mt1", "mt2", "mn1", "mn2", "ca1", "ca2", "ca3", "ca4", "as4"] },
          { name: "南线转B", site: "b", nodes: ["ts2", "br1", "br2", "br3", "br4", "br5", "bs1"] },
          { name: "中央高地转B", site: "b", nodes: ["ts2", "ms1", "ms2", "ms3", "mt1", "mt2", "mn1", "mn2", "cb1", "cb2", "bs1"] }
        ],
        ctHolds: [
          { node: "as1", site: "a", area: "A地堡" },
          { node: "as2", site: "a", area: "A内" },
          { node: "ca2", site: "a", area: "A通道" },
          { node: "bs1", site: "b", area: "B营地" },
          { node: "bs3", site: "b", area: "B西" },
          { node: "mn1", site: null, area: "中央高地" },
          { node: "ct4", site: null, area: "CT侧" }
        ],
        retake: {
          a: ["ct4", "ca1", "ca2", "ca3", "ca4", "as4"],
          b: ["ct4", "cb1", "cb2", "bs1"]
        }
      }
    });
    return map;
  }

  window.TFPS.MAPS = window.TFPS.MAPS || {};
  window.TFPS.MAPS.outpost = buildOutpost;
})();
