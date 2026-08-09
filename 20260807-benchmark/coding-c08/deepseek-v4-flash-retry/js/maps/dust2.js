(function () {
  const THREE = window.THREE;
  const TEX = window.TFPS.TEX;
  const MB = window.TFPS.MapBuilder;

  function buildDust2(scene) {
    const b = new MB(scene, "sand");
    b.setBounds(0, 64, -56, 6);
    const SW = b.mat("sand"), CON = b.mat("concrete"), MET = b.mat("metal");
    const CRW = b.mat("crateWood"), CRM = b.mat("crateMetal");
    const W = (cx, cz, w, d, h, m, o) => b.wall(cx, cz, w, d, h, m || SW, o);

    // Ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), new THREE.MeshLambertMaterial({ map: TEX.get("sandGround") }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(32, 0, -25);
    ground.receiveShadow = true;
    b.decor(ground, { cast: false });

    // Outer boundary
    W(32, 6, 64, 0.6, 5);
    W(32, -56, 64, 0.6, 5);
    W(64, -25, 0.6, 62, 5);
    W(0, -25, 0.6, 62, 5);

    // T spawn: area x0..22 z-4..6 ; openings: B tunnel x3..9, mid x14..22, A long x22 z-1..3
    W(22, -4.5, 0.5, 1, 4);           // east wall above B tunnel opening
    W(22, 4.5, 0.5, 3, 4);            // east wall below A long entrance
    W(11, -4, 5, 0.5, 4);             // north wall between B and mid openings
    W(2, 1, 4, 10, 4);                // T spawn west inner wall (visual)
    // B tunnel corridor x3..9 z-4..-38
    W(2.4, -21, 0.5, 34, 4);
    W(9.6, -21, 0.5, 34, 4);
    // B tunnel bend props
    b.crate(6, 0, -12, 1.2, 1.2, 1.2, "metal");
    // B doors opening x5..11 at z-38
    W(2.5, -38, 5, 0.5, 4);
    W(13.5, -38, 5, 0.5, 4);

    // Mid corridor x14..22 z-4..-14
    W(14, -8, 0.5, 8, 4);
    W(22, -8, 0.5, 8, 4);
    // Mid open area x14..38 z-14..-24
    W(14, -18, 0.5, 12, 4);
    W(38, -17, 0.5, 6, 4);            // east wall with catwalk opening z-20..-24
    W(36, -24, 4, 0.5, 4);            // wall right of mid doors x34..38
    W(21, -24, 14, 0.5, 4);           // wall left of mid doors x14..28
    // Mid props: Xbox crate + cover
    b.crate(27, 0, -18, 2.0, 1.3, 1.4, "wood");
    b.crate(25, 0, -19.6, 1.1, 1.1, 1.1, "metal");
    b.crate(34.5, 0, -18.5, 1.2, 1.2, 1.2, "wood");
    // Mid doors (double)
    b.doubleDoor(31, -24, 6, 2.6, MET, { axis: "x" });

    // A long corridor: x22..58 z-5..5, turn north at x52..58 to z-38
    W(40, 5, 36, 0.5, 4);             // A long south wall x22..58
    W(37, -5, 30, 0.5, 4);            // A long north wall x22..52 (opening x52..58 at corner)
    W(58, -21.5, 0.5, 33, 4);         // east wall of A long north segment
    W(52, -21.5, 0.5, 33, 4);         // west wall
    W(60, -38, 4, 0.5, 4);            // wall right of A long doors x56..62
    W(48, -38, 4, 0.5, 4);            // wall left of A long doors x46..50
    // A long props/crates
    b.crate(30, 0, 0, 1.4, 1.2, 1.4, "wood");
    b.crate(37, 0, 3, 1.6, 1.3, 1.1, "metal");
    b.crate(44, 0, -2, 1.4, 1.4, 1.4, "wood");
    b.crate(50, 0, 2, 1.1, 1.1, 1.1, "metal");
    b.crate(55, 0, -12, 1.5, 1.3, 1.5, "wood");
    b.crate(55, 0, -24, 1.3, 1.2, 1.3, "metal");
    b.barrel(31, 0, -3, 0.34, 0.9, 0x6f7a3a);
    b.barrel(47, 0, 0.5, 0.34, 0.9, 0x6f7a3a);
    b.sandbag(53.5, 0, -20, 1.4, 0.55, 0.6);
    b.sandbag(53.5, 0, -24, 1.4, 0.55, 0.6);

    // CT spawn x26..44 z-24..-38 ; B corridor x14..26 z-38..-44 ; A corridor x44..46 z-30..-36
    W(26, -29, 0.5, 10, 4);           // CT west wall z-34..-24 (opening z-34..-38)
    W(44, -27, 0.5, 8, 4);            // CT east wall z-31..-23 (opening z-31..-38)
    W(35, -38, 18, 0.5, 4);           // CT north wall x26..44
    W(20, -41, 12, 0.5, 4);           // B corridor south wall x14..26 z-38
    W(20, -44, 12, 0.5, 4);           // B corridor north wall x14..26 z-44
    W(14, -41, 0.5, 6, 4);            // B corridor west wall
    W(26, -41, 0.5, 6, 4);            // B corridor east wall
    // A corridor
    W(45, -33, 0.5, 6, 4);            // short connector x44..46
    b.sign(45.6, 2.2, -29, 0.7, 1.6, "A", "#6b3b2a", { rotY: 0 });

    // A site x46..62 z-30..-52
    W(62, -41, 0.5, 22, 5);           // A east wall z-30..-52
    W(54, -52, 16, 0.5, 5);           // A north wall x46..62
    // A west wall has CT door opening z-30..-36 and catwalk opening z-38..-42
    W(46, -37, 0.5, 2, 4);            // A west wall between CT door and catwalk
    W(46, -47, 0.5, 10, 4);           // A west wall z-42..-52
    W(52, -52, 0.5, 0.6, 5);
    // A ramp (elevated) x46..54 z-44..-52 top y1.0
    b.box(50, 0.5, -48, 8, 1.0, 8, CON);
    b.stairs(51.5, -42.8, 3, "n", 3, 0.33, 0.35, CON);
    // A pit x54..60 z-40..-48 (lowered)
    b.box(57, -0.9, -44, 6, 0.18, 8, CON, { cast: false });
    b.box(54, -0.35, -40, 0.5, 0.7, 8, CON, { noCollide: true });
    b.stairs(58.5, -40.5, 4, "s", 3, 0.3, 0.35, CON); // pit entrance from south
    // A site crates
    b.crate(52, 0, -43, 1.5, 1.2, 1.5, "wood");
    b.crate(53.5, 0, -42, 1.2, 1.2, 1.2, "metal");
    b.crate(50.5, 0, -47, 1.4, 1.1, 1.4, "wood");
    b.crate(57, 0, -50, 1.6, 1.3, 1.2, "wood");
    b.barrel(48, 0, -40, 0.35, 0.9, 0x5f6b35);
    b.sandbag(60.5, 0, -43, 1.5, 0.6, 0.6);
    b.sandbag(60.5, 0, -47, 1.5, 0.6, 0.6);

    // A short catwalk: stairs up at x38 z-21, platform y1.45 to x50 z-36, stairs down into site
    b.stairs(37, -21, 4, "e", 4, 0.35, 0.35, CON);
    b.box(41.5, 1.4, -24.5, 6, 0.1, 5, CON, { cast: false });
    b.box(47.5, 1.4, -31, 6, 0.1, 8, CON, { cast: false });
    b.stairs(50.5, -34.5, 3.5, "e", 4, 0.35, 0.35, CON);
    // railings
    b.box(41.5, 2.1, -22, 6, 0.8, 0.08, MET, { noCollide: true });
    b.box(41.5, 2.1, -27, 6, 0.8, 0.08, MET, { noCollide: true });
    b.box(44, 2.1, -31, 0.08, 0.8, 8, MET, { noCollide: true });
    b.box(50, 2.1, -31, 0.08, 0.8, 8, MET, { noCollide: true });
    b.box(47.5, 2.1, -35, 6, 0.8, 0.08, MET, { noCollide: true });
    b.pillar(38.5, -24.5, 0.22, 1.45, CON);
    b.pillar(43.5, -24.5, 0.22, 1.45, CON);
    b.pillar(43.5, -35, 0.22, 1.45, CON);

    // B site x0..16 z-38..-52
    W(8, -52, 16, 0.5, 5);            // B north wall
    W(0, -45, 0.5, 14, 5);            // B west wall
    W(16, -39, 0.5, 2, 5);            // B east wall z-38..-40
    W(16, -46, 0.5, 4, 5);            // B east wall z-44..-48 (opening z-40..-44)
    W(16, -50, 0.5, 4, 5);            // B east wall z-48..-52
    W(2.5, -38, 5, 0.5, 4);           // B south wall left of B doors
    W(13.5, -38, 5, 0.5, 4);          // B south wall right of B doors
    // B platform x2..8 z-46..-52 top y1.15
    b.box(5, 0.55, -49, 6, 1.1, 6, CON);
    b.stairs(8, -48.5, 1.6, "e", 5, 0.22, 0.18, CON);
    // B site crates
    b.crate(12, 0, -44, 1.4, 1.2, 1.4, "wood");
    b.crate(13.5, 0, -45.5, 1.1, 1.1, 1.1, "metal");
    b.crate(4, 0, -42, 1.5, 1.2, 1.4, "wood");
    b.crate(9.5, 0, -50, 1.3, 1.2, 1.3, "metal");
    b.barrel(2.5, 0, -44, 0.35, 0.9, 0x6f7a3a);

    // Arch details at key doorways
    b.arch(31, -24, 6, 2.7, 0.4, SW);          // mid doors frame
    b.arch(53.5, -38, 6, 2.7, 0.4, SW);        // A long doors
    b.arch(8, -38, 6, 2.7, 0.4, SW);           // B doors
    b.arch(46, -32, 4, 2.7, 0.35, SW);         // CT -> A door
    b.arch(46, -40, 4, 2.7, 0.35, SW);         // catwalk -> A door
    b.arch(16, -42, 4, 2.7, 0.35, SW);         // CT -> B door

    // Signs
    b.sign(47.5, 2.3, -38.6, 1.8, 0.9, "A SITE", "#6b3b2a");
    b.sign(5.5, 2.3, -38.8, 1.8, 0.9, "B SITE", "#6b3b2a");
    b.sign(20, 2.3, -5, 1.8, 0.9, "T SPAWN", "#4a4a3a");
    b.sign(34, 2.3, -35, 1.8, 0.9, "CT SPAWN", "#24455f");
    b.sign(22.5, 2.3, -18, 1.2, 0.9, "MID", "#4a4a3a", { rotY: 0 });
    b.sign(55.5, 2.3, -4.5, 1.6, 0.9, "A LONG", "#4a4a3a", { rotY: 0 });
    b.sign(5, 2.3, -5, 1.6, 0.9, "B TUNNEL", "#4a4a3a", { rotY: 0 });

    // Lamps
    b.lamp(20, 3.4, -3, 0xfff0c8, 1.2, 22);
    b.lamp(31, 3.4, -16, 0xfff0c8, 1.0, 20);
    b.lamp(31, 3.4, -30, 0xfff0c8, 1.0, 20);
    b.lamp(52, 3.4, -42, 0xfff0c8, 1.2, 22);
    b.lamp(8, 3.4, -44, 0xfff0c8, 1.2, 22);
    b.lamp(55, 3.4, 0, 0xfff0c8, 0.8, 18);

    // Spawns
    b.addSpawn("t", 6, 2, 0);
    b.addSpawn("t", 12, 2.5, 0);
    b.addSpawn("t", 18, 2, 0);
    b.addSpawn("t", 10, -1, 0);
    b.addSpawn("t", 3, 1, 0);
    b.addSpawn("t", 15, 3, 0);
    b.addSpawn("ct", 30, -36, Math.PI);
    b.addSpawn("ct", 34, -36, Math.PI);
    b.addSpawn("ct", 38, -36, Math.PI);
    b.addSpawn("ct", 42, -36, Math.PI);
    b.addSpawn("ct", 32, -32, Math.PI);
    b.addSpawn("ct", 40, -32, Math.PI);

    // Bomb sites
    b.addSite("a", 53, -44, 5.5, [{ x: 52, z: -46 }, { x: 54, z: -42 }, { x: 48, z: -44 }, { x: 57, z: -47 }], "A 包点");
    b.addSite("b", 8, -44, 5.5, [{ x: 8, z: -44 }, { x: 5, z: -46 }, { x: 12, z: -46 }, { x: 6, z: -41 }], "B 包点");

    // Nav graph
    const N = (id, x, z, y, f) => b.addNav(id, x, z, y, f);
    const L = (a, c) => b.linkNav(a, c);
    N("ts1", 8, 1, 0, { spawn: 1 });
    N("ts2", 18, 2, 0, { spawn: 1 });
    N("ts3", 6, -2, 0, { spawn: 1 });
    N("md1", 18, -6, 0);
    N("md2", 20, -11, 0);
    N("md3", 26, -18, 0);
    N("md4", 31, -17, 0);
    N("md5", 31, -22, 0);
    N("md6", 31, -28, 0);
    N("ct1", 33, -33, 0);
    N("ct2", 38, -35, 0);
    N("ct3", 42, -32, 0);
    N("ca1", 44.5, -33, 0);
    N("ca2", 46.5, -35, 0);
    N("ca3", 47.5, -38, 0);
    N("as4", 51, -40, 0);
    N("as1", 56, -43, 0);
    N("as2", 53, -46, 0);
    N("as3", 50, -47, 1.0);
    N("as5", 48, -42, 0);
    N("cb1", 24, -41, 0);
    N("cb2", 20, -41, 0);
    N("cb3", 15.3, -41.5, 0);
    N("bs1", 12, -42, 0);
    N("bs2", 9, -45, 0);
    N("bs3", 5, -49, 1.15);
    N("bs4", 3, -41, 0);
    N("al1", 24, 1, 0);
    N("al2", 32, 1, 0);
    N("al3", 40, 1, 0);
    N("al4", 48, 1, 0);
    N("al5", 53, 0, 0);
    N("al6", 53, -8, 0);
    N("al7", 53, -16, 0);
    N("al8", 53, -24, 0);
    N("al9", 53, -32, 0);
    N("al10", 53, -37, 0);
    N("bt1", 6, -8, 0);
    N("bt2", 6, -14, 0);
    N("bt3", 6, -20, 0);
    N("bt4", 6, -26, 0);
    N("bt5", 6, -32, 0);
    N("bt6", 8, -37, 0);
    N("asw1", 36.8, -20, 0);
    N("asw2", 42, -25, 1.4);
    N("asw3", 47, -31, 1.4);
    N("asw4", 48, -34, 1.4);
    N("asw5", 47, -39, 0);

    // Links: spawn exits
    L("ts1", "ts2"); L("ts1", "ts3"); L("ts2", "al1"); L("ts3", "bt1"); L("ts1", "md1");
    // A long
    L("al1", "al2"); L("al2", "al3"); L("al3", "al4"); L("al4", "al5"); L("al5", "al6");
    L("al6", "al7"); L("al7", "al8"); L("al8", "al9"); L("al9", "al10"); L("al10", "as4");
    L("al10", "as1"); L("al9", "as1");
    // Mid
    L("md1", "md2"); L("md2", "md3"); L("md3", "md4"); L("md4", "md5"); L("md5", "md6");
    L("md6", "ct1"); L("ct1", "ct2"); L("ct2", "ct3"); L("ct1", "ca1"); L("ca1", "ca2");
    L("ca2", "ca3"); L("ca3", "as5"); L("ca3", "as4"); L("as5", "as4"); L("as4", "as2"); L("as4", "as1"); L("as2", "as3");
    // Catwalk
    L("md4", "asw1"); L("asw1", "asw2"); L("asw2", "asw3"); L("asw3", "asw4"); L("asw4", "asw5"); L("asw5", "as5"); L("asw5", "as3");
    // B tunnels
    L("bt1", "bt2"); L("bt2", "bt3"); L("bt3", "bt4"); L("bt4", "bt5"); L("bt5", "bt6"); L("bt6", "bs1"); L("bt6", "bs2"); L("bs1", "bs2"); L("bs2", "bs3"); L("bs1", "bs4");
    // CT B corridor
    L("ct2", "cb1"); L("cb1", "cb2"); L("cb2", "cb3"); L("cb3", "bs1"); L("cb1", "bs4");
    // CT spawn interconnects
    L("md6", "ct2"); L("ct2", "ct3"); L("ct3", "ca1");
    L("ct1", "md6"); L("ct1", "ct2");

    const map = Object.assign(b.build(), {
      id: "dust2",
      name: "Dust2 复刻",
      shortName: "Dust2",
      desc: "经典 Dust2 结构：A大 / A小 / 中路 / B洞 / 双门 / Xbox / 警家长门 / A坑 / B平台，完整进攻与回防路线。",
      sky: "sand",
      ambient: 0xfff1d8,
      fog: 0xd8c29a,
      ambienceKind: "desert",
      plans: {
        tRoutes: [
          { name: "A大推进", site: "a", nodes: ["ts2", "al1", "al2", "al3", "al4", "al5", "al6", "al7", "al8", "al9", "al10", "as4"] },
          { name: "A小夹击", site: "a", nodes: ["ts1", "md1", "md2", "md3", "md4", "asw1", "asw2", "asw3", "asw4", "asw5", "as5"] },
          { name: "中路转A", site: "a", nodes: ["ts1", "md1", "md2", "md3", "md4", "md5", "md6", "ct1", "ca1", "ca2", "ca3", "as4"] },
          { name: "B洞快攻", site: "b", nodes: ["ts3", "bt1", "bt2", "bt3", "bt4", "bt5", "bt6", "bs1"] },
          { name: "B洞+CT夹B", site: "b", nodes: ["ts3", "bt1", "bt2", "bt3", "bt4", "bt5", "bt6", "bs1"] }
        ],
        ctHolds: [
          { node: "as4", site: "a", area: "A包点" },
          { node: "asw5", site: "a", area: "A小" },
          { node: "ca1", site: "a", area: "警家" },
          { node: "bs2", site: "b", area: "B包点" },
          { node: "bs1", site: "b", area: "B门" },
          { node: "md6", site: null, area: "中路" },
          { node: "ct2", site: null, area: "警家" }
        ],
        retake: {
          a: ["ct1", "ca1", "ca2", "ca3", "as4"],
          b: ["ct1", "cb1", "cb2", "cb3", "bs1"]
        }
      }
    });
    return map;
  }

  window.TFPS.MAPS = window.TFPS.MAPS || {};
  window.TFPS.MAPS.dust2 = buildDust2;
})();
