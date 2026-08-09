(function () {
  const game = new window.TFPS.Game();
  const ui = new window.TFPS.UI(game);
  game.ui = ui;
  window.TFPS.game = game;
  window.TFPS.ui = ui;

  // Error capture for automated testing
  window.__tfpsErrors = [];
  window.addEventListener("error", e => {
    window.__tfpsErrors.push(String(e.message || e.error));
    if (window.__tfpsErrors.length > 50) window.__tfpsErrors.splice(0, 20);
    console.error(e.error || e.message);
  });
  window.addEventListener("unhandledrejection", e => {
    window.__tfpsErrors.push("unhandled: " + e.reason);
    if (window.__tfpsErrors.length > 50) window.__tfpsErrors.splice(0, 20);
  });

  // Debug / automation API
  window.TFPS.debug = {
    start(settings) {
      game.startMatch(Object.assign({ map: "dust2", team: "CT", bots: 4, diff: "normal", winScore: 8 }, settings || {}));
    },
    teleport(x, z, yaw) {
      const p = game.player;
      if (p) { p.pos.set(x, 0, z); if (yaw != null) p.yaw = yaw; }
    },
    give(id) {
      const p = game.player;
      if (p) { p.buyWeapon(id); p.weapon.ammo = window.TFPS.W[id].mag; p.weapon.reserve = window.TFPS.W[id].reserve; }
    },
    damage(n) {
      if (game.player) game.player.applyDamage(n || 50, null, "chest", false);
    },
    kill(team) {
      for (const p of game.players) {
        if (p.team === team) p.applyDamage(999, null, "head", true);
      }
    },
    plant() {
      const p = game.player;
      if (!p) return;
      const site = game.findPlantSite(p);
      if (site) game.plantBomb(p, game.nearestSpot(site, p.pos));
    },
    nextRound() {
      game.roundEndT = 0.01;
    },
    skipFreeze() { game.freezeTime = 0.01; },
    skipWarmup() { game.warmupT = 0.01; },
    setTime(t) { game.roundTime = t; },
    god() {
      const p = game.player;
      if (p) { p.health = 9999; p.armor = 999; }
    },
    allAlive() {
      for (const p of game.players) if (!p.alive) p.applyDamage(-999, null, null, false);
    },
    cameraPos() { return game.camera.position.toArray(); },
    playerPos() { return game.player ? game.player.pos.toArray() : null; },
    status() {
      return {
        state: game.state, roundState: game.roundState, round: game.roundNumber,
        score: game.score, map: game.mapId, time: game.time,
        players: game.players.map(p => ({ name: p.name, team: p.team, alive: p.alive, hp: Math.round(p.health), pos: [p.pos.x, p.pos.y, p.pos.z] })),
        errors: window.__tfpsErrors.slice()
      };
    }
  };

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    try {
      if (game.state === "playing" && !game.paused) {
        game.update(dt);
      } else {
        game.effects.update(dt);
      }
      game.render();
    } catch (err) {
      window.__tfpsErrors.push("loop: " + (err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err));
      if (window.__tfpsErrors.length > 50) window.__tfpsErrors.splice(0, 20);
      console.error(err);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
