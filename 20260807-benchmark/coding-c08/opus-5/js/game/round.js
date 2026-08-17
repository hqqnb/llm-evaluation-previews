// ============================================================================
// game/round.js — competitive bomb-defusal match flow.
//
// FREEZE → LIVE → (PLANTED) → ROUND_END → … → HALFTIME → … → MATCH_END
// ============================================================================

import * as THREE from 'three';
import { PHASE, TEAM, OTHER_TEAM, ROUND, MONEY, SOUND_RANGE } from '../core/constants.js';
import { clamp } from '../core/util.js';
import { roundEndMoney, applyHalftimeReset } from './economy.js';

export class Match {
  constructor(game) {
    this.game = game;
    const cfg = game.cfg;
    this.maxRounds = cfg.maxRounds ?? 24;
    this.roundsToWin = Math.floor(this.maxRounds / 2) + 1;
    this.halfAt = Math.floor(this.maxRounds / 2);
    this.phase = PHASE.FREEZE;
    this.round = 0;
    this.timer = 0;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.half = 1;
    this.sideOf = { T: TEAM.T, CT: TEAM.CT };   // team → current side (after swap)
    this.buyLeft = 0;
    this.lastWinner = null;
    this.lastReason = '';
    this.roundMvp = null;
    this.plantedBy = { T: false, CT: false };
    this.history = [];
    this.tenSecondWarned = false;
    this.beepTimer = 0;
  }

  get isBuyTime() { return this.buyLeft > 0 && (this.phase === PHASE.FREEZE || this.phase === PHASE.LIVE); }
  get buyTimeLeft() { return Math.max(0, this.buyLeft); }
  get live() { return this.phase === PHASE.LIVE || this.phase === PHASE.PLANTED; }

  start() {
    this.round = 0;
    this.score.T = 0; this.score.CT = 0;
    this.lossStreak.T = 0; this.lossStreak.CT = 0;
    this.half = 1;
    this.history.length = 0;
    for (const a of this.game.actors) { a.money = MONEY.start; a.kills = a.deaths = a.assists = a.score = a.mvp = 0; a.damageDealt = 0; a.clearInventory(); }
    this.startRound();
  }

  startRound() {
    const game = this.game;
    this.round++;
    this.phase = PHASE.FREEZE;
    this.timer = ROUND.freezeTime;
    this.buyLeft = ROUND.buyTime;
    this.tenSecondWarned = false;
    this.roundMvp = null;
    game.resetRound();
    game.bus.emit('round_start', { round: this.round, score: this.score });
    game.audio?.play('round_freeze', {});
  }

  update(dt) {
    const game = this.game;
    this.timer -= dt;
    if (this.buyLeft > 0) this.buyLeft -= dt;

    switch (this.phase) {
      case PHASE.FREEZE:
        if (this.timer <= 0) {
          this.phase = PHASE.LIVE;
          this.timer = ROUND.roundTime;
          game.bus.emit('phase', { phase: this.phase });
          game.audio?.play('round_start', {});
          game.coordinator?.T?.onRoundLive?.();
          game.coordinator?.CT?.onRoundLive?.();
        }
        break;

      case PHASE.LIVE: {
        if (!this.tenSecondWarned && this.timer <= 10.5) {
          this.tenSecondWarned = true;
          game.audio?.play('ten_seconds', {});
        }
        const done = this.checkElimination();
        if (done) break;
        if (this.timer <= 0) this.endRound(TEAM.CT, 'time', '时间耗尽 · CT 守住包点');
        break;
      }

      case PHASE.PLANTED: {
        const bomb = game.bomb;
        bomb.timer = Math.max(0, this.timer);
        // accelerating beeps
        this.beepTimer -= dt;
        const period = clamp(this.timer / 40 * 1.05, 0.14, 1.0);
        if (this.beepTimer <= 0) {
          this.beepTimer = period;
          game.audio?.play(this.timer < 10 ? 'bomb_beep_fast' : 'bomb_beep', { pos: bomb.pos, vol: 0.8 });
          game.emitSound(bomb.pos, 'plant', TEAM.T, 14);
        }
        if (this.checkElimination()) break;
        if (this.timer <= 0) this.detonate();
        break;
      }

      case PHASE.ROUND_END:
        if (this.timer <= 0) this.advance();
        break;

      case PHASE.HALFTIME:
        if (this.timer <= 0) { this.swapSides(); this.startRound(); }
        break;

      default: break;
    }
  }

  /** Team wipes. A planted bomb keeps the round alive even with all T dead. */
  checkElimination() {
    const g = this.game;
    const tAlive = g.alive(TEAM.T).length;
    const ctAlive = g.alive(TEAM.CT).length;
    if (ctAlive === 0 && tAlive > 0) { this.endRound(TEAM.T, 'elim', '反恐精英全部阵亡'); return true; }
    if (tAlive === 0 && this.phase !== PHASE.PLANTED) { this.endRound(TEAM.CT, 'elim', '恐怖分子全部阵亡'); return true; }
    if (tAlive === 0 && ctAlive === 0) { this.endRound(TEAM.CT, 'elim', '双方全部阵亡'); return true; }
    return false;
  }

  // --- objective ------------------------------------------------------------
  plantBomb(actor, site) {
    const game = this.game, bomb = game.bomb;
    bomb.state = 'planted';
    bomb.pos.copy(actor.pos);
    game.world.settle(bomb.pos, 0.2, 0.3);
    bomb.site = site;
    bomb.planter = actor;
    bomb.carrier = null;
    bomb.defuser = null;
    bomb.defuseProgress = 0;
    bomb.plantProgress = 1;
    actor.inv.bomb = false;
    actor.money = Math.min(MONEY.max, actor.money + MONEY.plantReward);
    actor.score += 2;
    this.plantedBy.T = true;
    this.phase = PHASE.PLANTED;
    this.timer = ROUND.bombTime;
    bomb.timer = ROUND.bombTime;
    this.beepTimer = 0;
    actor.selectBest();
    game.audio?.play('bomb_plant_done', { pos: bomb.pos });
    game.bus.emit('plant', { actor, site, pos: bomb.pos.clone() });
    game.emitSound(bomb.pos, 'plant', actor.team, SOUND_RANGE.plant);
    for (const a of game.actors) a.bot?.onBombPlanted?.(site, bomb.pos);
    game.coordinator?.CT?.report?.('plant', { site, pos: bomb.pos.clone() });
    game.coordinator?.T?.report?.('plant', { site, pos: bomb.pos.clone() });
  }

  defuseComplete(actor) {
    const game = this.game, bomb = game.bomb;
    bomb.state = 'defused';
    bomb.defuser = actor;
    actor.money = Math.min(MONEY.max, actor.money + MONEY.defuseReward);
    actor.score += 2;
    game.audio?.play('defuse_done', { pos: bomb.pos });
    game.bus.emit('defuse_done', { actor });
    this.endRound(TEAM.CT, 'defuse', `${actor.name} 拆除了炸弹`);
  }

  detonate() {
    const game = this.game, bomb = game.bomb;
    bomb.state = 'exploded';
    game.audio?.play('bomb_explode', { pos: bomb.pos });
    game.fx?.explosion(bomb.pos, 22);
    game.fx?.shake(1.4, 1.8);
    game.combat.explode(bomb.pos, 22, 500, bomb.planter, 'c4', {});
    game.bus.emit('bomb_explode', { pos: bomb.pos.clone() });
    this.endRound(TEAM.T, 'detonate', '炸弹已引爆');
  }

  // --- round end ------------------------------------------------------------
  endRound(winner, reason, text) {
    if (this.phase === PHASE.ROUND_END || this.phase === PHASE.MATCH_END) return;
    const game = this.game;
    this.phase = PHASE.ROUND_END;
    this.timer = ROUND.roundEndTime;
    this.lastWinner = winner;
    this.lastReason = text || reason;
    this.score[winner]++;
    const loser = OTHER_TEAM[winner];
    this.lossStreak[loser] = Math.min(4, this.lossStreak[loser] + 1);
    this.lossStreak[winner] = Math.max(0, this.lossStreak[winner] - 1);

    // money
    const rewards = roundEndMoney(this, winner, reason, game.actors);
    for (const r of rewards) r.actor.money = clamp(r.actor.money + r.delta, 0, MONEY.max);

    // MVP: planter/defuser first, then most round damage
    let mvp = null;
    if (reason === 'defuse' && game.bomb.defuser) mvp = game.bomb.defuser;
    else if (reason === 'detonate' && game.bomb.planter) mvp = game.bomb.planter;
    if (!mvp) {
      for (const a of game.actors) {
        if (a.team !== winner) continue;
        if (!mvp || a.roundDamage > mvp.roundDamage) mvp = a;
      }
    }
    if (mvp) { mvp.mvp++; this.roundMvp = mvp; }

    this.history.push({ round: this.round, winner, reason });
    game.audio?.play(winner === TEAM.CT ? 'ct_win' : 't_win', {});
    game.bus.emit('round_end', { winner, reason, text: this.lastReason, score: { ...this.score }, mvp });
  }

  advance() {
    const g = this.game;
    if (this.score.T >= this.roundsToWin || this.score.CT >= this.roundsToWin) return this.finish();
    if (this.round >= this.maxRounds) return this.finish();
    if (this.round === this.halfAt && this.half === 1) {
      this.half = 2;
      this.phase = PHASE.HALFTIME;
      this.timer = ROUND.halftimeTime;
      g.bus.emit('halftime', { score: { ...this.score } });
      return;
    }
    this.startRound();
  }

  finish() {
    const g = this.game;
    this.phase = PHASE.MATCH_END;
    this.timer = 0;
    const winner = this.score.T === this.score.CT ? null : (this.score.T > this.score.CT ? TEAM.T : TEAM.CT);
    const localWon = winner && g.local && g.local.team === winner;
    g.audio?.play(localWon ? 'match_win' : 'match_lose', {});
    g.bus.emit('match_end', { winner, score: { ...this.score }, draw: !winner });
  }

  /** Swap which side each roster plays; money resets like a real halftime. */
  swapSides() {
    const g = this.game;
    for (const a of g.actors) {
      a.team = OTHER_TEAM[a.team];
      a.clearInventory();
      a.kit = false;
    }
    const t = this.score.T; this.score.T = this.score.CT; this.score.CT = t;
    const ls = this.lossStreak.T; this.lossStreak.T = this.lossStreak.CT; this.lossStreak.CT = ls;
    applyHalftimeReset(g.actors);
    g.onSidesSwapped?.();
    g.bus.emit('sides_swapped', { score: { ...this.score } });
  }
}



