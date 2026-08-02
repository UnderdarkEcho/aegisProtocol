import { canShoot, grenadeDamageAt, previewShot, resolveShot } from './combat';
import { getDefensiveCover } from './cover';
import { createDebugFlags, type DebugFlags } from './debug';
import { keyOf, neighbors8, rebuildCoverEdges } from './grid';
import { computePlayerVision, hasLineOfSight } from './los';
import { findPath, reachableTiles } from './pathfinding';
import {
  livingPickupCount,
  PICKUP_LABEL,
  pickupAt,
  spawnPickups,
} from './pickups';
import {
  grantXp,
  killXp,
  missionBonusXp,
} from './progression';
import { createRng } from './rng';
import type {
  AbilityId,
  GameEvent,
  MissionState,
  Pickup,
  ShotPreview,
  UnitState,
  Vec2,
} from './types';

export type Listener = (e: GameEvent) => void;

export class Game {
  state: MissionState;
  /** Test cheats — toggled from debug icon bar */
  debug: DebugFlags = createDebugFlags();
  private rng: () => number;
  private listeners: Listener[] = [];

  constructor(state: MissionState) {
    this.state = state;
    this.rng = createRng(state.seed);
    this.refreshVision();
  }

  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(type: GameEvent['type'], payload: Record<string, unknown> = {}) {
    const e = { type, payload };
    this.state.log.push(e);
    for (const l of this.listeners) l(e);
  }

  startMission() {
    this.state.phase = 'player';
    this.state.turn = 1;
    this.refreshAp('player');
    this.refreshVision();
    this.emit('turnStart', { team: 'player', turn: this.state.turn });
    if (this.state.missionType === 'deadline' && this.state.turnLimit != null) {
      this.emit('toast', {
        text: `PROBE ONLINE · ICE WAKE IN ${this.state.turnLimit} CYCLES`,
        danger: true,
      });
    } else {
      this.emit('toast', { text: 'PROBE TEAM ONLINE', danger: false });
    }
  }

  selectUnit(id: string | null) {
    if (!id) {
      this.state.selectedId = null;
      return;
    }
    const u = this.state.units.get(id);
    if (!u || !u.alive) return;
    if (this.state.phase === 'player' && u.def.team !== 'player') return;
    const changed = this.state.selectedId !== id;
    this.state.selectedId = id;
    if (changed && u.def.team === 'player') {
      this.emit('unitSelected', { unitId: id });
    }
  }

  getSelected(): UnitState | null {
    if (!this.state.selectedId) return null;
    return this.state.units.get(this.state.selectedId) ?? null;
  }

  getReachable(unitId: string) {
    const u = this.state.units.get(unitId);
    if (!u) return { blue: new Map(), yellow: new Map() };
    const ghost = this.freeCyc() ? { ...u, ap: Math.max(u.ap, 2) } : u;
    return reachableTiles(this.state, ghost);
  }

  private hasAp(u: UnitState, cost: number): boolean {
    return this.freeCyc() || u.ap >= cost;
  }

  private spendAp(u: UnitState, cost: number) {
    if (!this.freeCyc()) u.ap = Math.max(0, u.ap - cost);
  }

  previewAttack(attackerId: string, targetId: string): ShotPreview | null {
    const a = this.state.units.get(attackerId);
    const d = this.state.units.get(targetId);
    if (!a || !d) return null;
    if (!hasLineOfSight(this.state, a.pos, d.pos)) return null;
    return previewShot(this.state, a, d);
  }

  private freeCyc(): boolean {
    return this.debug.freeCyc;
  }

  tryMove(unitId: string, to: Vec2): boolean {
    if (this.state.phase !== 'player') return false;
    const u = this.state.units.get(unitId);
    if (!u || !u.alive || u.def.team !== 'player') return false;
    if (!this.freeCyc() && u.ap <= 0) return false;

    // Free-CYC: treat as full 2-cycle mobility budget
    const ghost = this.freeCyc() ? { ...u, ap: 2 } : u;
    const { blue, yellow } = reachableTiles(this.state, ghost);
    const k = keyOf(to.x, to.y);
    const result = blue.get(k) ?? yellow.get(k);
    if (!result) return false;

    const cost = blue.has(k) ? 1 : 2;
    if (!this.freeCyc() && u.ap < cost) return false;

    u.pos = { ...to };
    if (!this.freeCyc()) u.ap -= cost;
    u.overwatching = false;
    this.emit('move', { unitId, path: result.path, cost: this.freeCyc() ? 0 : cost });
    this.tryCollectPickup(u);
    this.onUnitMovedPort(u);
    this.afterPlayerAction(u);
    return true;
  }

  tryShoot(attackerId: string, targetId: string): boolean {
    if (this.state.phase !== 'player') return false;
    const a = this.state.units.get(attackerId);
    const d = this.state.units.get(targetId);
    if (!a || !d || a.def.team !== 'player') return false;
    if (!this.freeCyc() && a.ap < 1) return false;
    const los = hasLineOfSight(this.state, a.pos, d.pos);
    if (!canShoot(this.state, a, d, los)) return false;

    this.performShot(a, d);
    if (!this.freeCyc()) a.ap -= 1;
    a.overwatching = false;
    this.afterPlayerAction(a);
    return true;
  }

  tryOverwatch(unitId: string): boolean {
    if (this.state.phase !== 'player') return false;
    const u = this.state.units.get(unitId);
    if (!u || !u.alive) return false;
    if (!this.freeCyc() && u.ap < 1) return false;
    if (!this.freeCyc()) u.ap = 0;
    u.overwatching = true;
    this.emit('overwatch', { unitId });
    this.emit('toast', { text: `${u.def.name} · trap.daemon ARMED`, danger: false });
    this.afterPlayerAction(u);
    return true;
  }

  tryGrenade(unitId: string, target: Vec2): boolean {
    if (this.state.phase !== 'player') return false;
    const u = this.state.units.get(unitId);
    if (!u || !u.alive || !this.hasAp(u, 1)) return false;
    if (!u.def.abilities.includes('grenade')) return false;
    if ((u.cooldowns.grenade ?? 0) > 0 && !this.freeCyc()) return false;
    const dist = Math.hypot(target.x - u.pos.x, target.y - u.pos.y);
    if (dist > 5.5) return false;

    this.spendAp(u, 1);
    if (!this.freeCyc()) u.cooldowns.grenade = 99;
    u.overwatching = false;
    this.resolveGrenade(u, target);
    this.afterPlayerAction(u);
    return true;
  }

  tryBreach(unitId: string, target: Vec2): boolean {
    if (this.state.phase !== 'player') return false;
    const u = this.state.units.get(unitId);
    if (!u || !this.hasAp(u, 1) || !u.def.abilities.includes('breach')) return false;
    if ((u.cooldowns.breach ?? 0) > 0 && !this.freeCyc()) return false;
    const dist = Math.hypot(target.x - u.pos.x, target.y - u.pos.y);
    if (dist > 2.2) return false;

    let hitProp = false;
    for (const p of this.state.props.values()) {
      if (p.destroyed) continue;
      if (p.pos.x === target.x && p.pos.y === target.y) {
        this.destroyProp(p.id);
        hitProp = true;
      }
    }
    if (!hitProp) return false;
    this.spendAp(u, 1);
    if (!this.freeCyc()) u.cooldowns.breach = 3;
    this.emit('toast', { text: 'strip.sys · COMPONENT REMOVED', danger: false });
    this.afterPlayerAction(u);
    return true;
  }

  trySuppress(unitId: string, targetId: string): boolean {
    if (this.state.phase !== 'player') return false;
    const u = this.state.units.get(unitId);
    const t = this.state.units.get(targetId);
    if (!u || !t || !this.hasAp(u, 1) || !u.def.abilities.includes('suppress')) return false;
    if (!hasLineOfSight(this.state, u.pos, t.pos)) return false;
    t.suppressed = true;
    this.spendAp(u, 1);
    this.emit('toast', { text: `${t.def.name} · throttle.sys APPLIED`, danger: false });
    this.afterPlayerAction(u);
    return true;
  }

  trySmoke(unitId: string, target: Vec2): boolean {
    if (this.state.phase !== 'player') return false;
    const u = this.state.units.get(unitId);
    if (!u || !this.hasAp(u, 1) || !u.def.abilities.includes('smoke')) return false;
    if ((u.cooldowns.smoke ?? 0) > 0 && !this.freeCyc()) return false;
    const dist = Math.hypot(target.x - u.pos.x, target.y - u.pos.y);
    if (dist > 6.5) return false;

    for (const n of [{ ...target }, ...neighbors8(target.x, target.y)]) {
      this.state.smokeTiles.add(keyOf(n.x, n.y));
    }
    this.applySmokeFlags();
    this.spendAp(u, 1);
    if (!this.freeCyc()) u.cooldowns.smoke = 4;
    this.emit('toast', { text: 'noise.sys · SECTOR OBFUSCATED', danger: false });
    this.afterPlayerAction(u);
    return true;
  }

  tryHeal(unitId: string, targetId: string): boolean {
    if (this.state.phase !== 'player') return false;
    const u = this.state.units.get(unitId);
    const t = this.state.units.get(targetId);
    if (!u || !t || !this.hasAp(u, 1) || !u.def.abilities.includes('heal')) return false;
    if ((u.cooldowns.heal ?? 0) > 0 && !this.freeCyc()) return false;
    if (t.def.team !== 'player') return false;
    const dist = Math.hypot(t.pos.x - u.pos.x, t.pos.y - u.pos.y);
    if (dist > 1.5) return false;
    const before = t.hp;
    t.hp = Math.min(t.def.maxHp, t.hp + 4);
    const healed = t.hp - before;
    this.spendAp(u, 1);
    if (!this.freeCyc()) u.cooldowns.heal = 3;
    this.emit('heal', {
      unitId: t.id,
      healerId: u.id,
      amount: healed,
      pos: { ...t.pos },
    });
    this.emit('toast', {
      text: `${t.def.name} · patch.sys +${healed} INT`,
      danger: false,
    });
    this.afterPlayerAction(u);
    return true;
  }

  tryHunker(unitId: string): boolean {
    if (this.state.phase !== 'player') return false;
    const u = this.state.units.get(unitId);
    if (!u || !this.hasAp(u, 1) || !u.def.abilities.includes('hunker')) return false;
    if (!this.freeCyc()) u.ap = 0;
    // Flag only — combat math doubles cover. Never mutate def.defense (stacking bug).
    u.hunkered = true;
    this.emit('toast', { text: `${u.def.name} · sandbox.sys LOCKED`, danger: false });
    this.afterPlayerAction(u);
    return true;
  }

  isMissionOver(): boolean {
    return this.state.phase === 'victory' || this.state.phase === 'defeat';
  }

  endPlayerTurn() {
    if (this.state.phase !== 'player' || this.isMissionOver()) return;
    this.state.phase = 'enemy';
    this.emit('turnStart', { team: 'enemy', turn: this.state.turn });
    this.emit('toast', { text: 'HOSTILE PROCESSES — THEIR CYCLE', danger: true });
  }

  /** Called by AI controller after enemy actions complete. */
  endEnemyTurn() {
    if (this.isMissionOver()) return;
    if (this.state.phase !== 'enemy') return;
    // Port channel advances at the end of the hostile cycle (must survive fire)
    if (this.tickPortLink()) return;
    this.state.turn += 1;
    this.state.phase = 'player';
    this.clearTurnFlags();
    this.refreshAp('player');
    this.tickCooldowns('player');
    this.refreshVision();
    this.maybeSpawnPickup();
    this.emit('turnStart', { team: 'player', turn: this.state.turn });
    // Deadline: after advancing past the cycle budget, ICE wakes fully
    if (
      this.state.missionType === 'deadline' &&
      this.state.turnLimit != null &&
      this.state.turn > this.state.turnLimit
    ) {
      this.failDeadline();
      return;
    }
    if (
      this.state.missionType === 'deadline' &&
      this.state.turnLimit != null &&
      this.state.turn === this.state.turnLimit
    ) {
      this.emit('toast', {
        text: `ICE WAKE · LAST CYCLE (${this.state.turnLimit})`,
        danger: true,
      });
    }
    this.checkMissionEnd();
  }

  /** Cycles remaining before deadline loss (null if unlimited). */
  cyclesRemaining(): number | null {
    if (this.state.missionType !== 'deadline' || this.state.turnLimit == null) {
      return null;
    }
    return Math.max(0, this.state.turnLimit - this.state.turn + 1);
  }

  private failDeadline() {
    if (this.isMissionOver()) return;
    this.state.phase = 'defeat';
    this.emit('missionEnd', {
      result: 'defeat',
      reason: 'deadline',
      turn: this.state.turn,
      turnLimit: this.state.turnLimit,
      hostilesRemaining: this.hostilesRemaining(),
    });
    this.emit('toast', {
      text: 'ICE WAKE COMPLETE · DEADLINE MISSED',
      danger: true,
    });
  }

  /** Collect loot node under unit feet (player only). */
  tryCollectPickup(u: UnitState): boolean {
    if (u.def.team !== 'player' || !u.alive) return false;
    const pk = pickupAt(this.state, u.pos);
    if (!pk || pk.collected) return false;
    pk.collected = true;
    const msg = this.applyPickup(u, pk);
    this.emit('pickupCollected', {
      pickupId: pk.id,
      kind: pk.kind,
      amount: pk.amount,
      unitId: u.id,
      pos: { ...pk.pos },
    });
    this.emit('toast', { text: msg, danger: false });
    this.refreshVision();
    return true;
  }

  private applyPickup(u: UnitState, pk: Pickup): string {
    const label = PICKUP_LABEL[pk.kind];
    if (pk.kind === 'cycles') {
      const before = u.ap;
      u.ap = Math.min(u.maxAp, u.ap + pk.amount);
      const gained = u.ap - before;
      return `${label} · +${gained} CYC`;
    }
    if (pk.kind === 'integrity') {
      const before = u.hp;
      u.hp = Math.min(u.def.maxHp, u.hp + pk.amount);
      const gained = u.hp - before;
      return `${label} · +${gained} INT (${u.def.name})`;
    }
    if (pk.kind === 'scan') {
      const n = this.revealFog(pk.amount);
      return `${label} · REVEALED ${n} SECTORS`;
    }
    // purge — clear suppress + shave cooldowns
    u.suppressed = false;
    for (const k of Object.keys(u.cooldowns) as AbilityId[]) {
      const v = u.cooldowns[k];
      if (v != null && v > 0) u.cooldowns[k] = Math.max(0, v - 2);
    }
    return `${label} · DEBUFFS CLEARED · COOLDOWNS −2`;
  }

  /** Reveal up to `count` unexplored tiles (prefer near board center / unknowns). */
  private revealFog(count: number): number {
    const unknown: Vec2[] = [];
    for (let y = 0; y < this.state.height; y++) {
      for (let x = 0; x < this.state.width; x++) {
        if (!this.state.explored[y]![x]) unknown.push({ x, y });
      }
    }
    let revealed = 0;
    while (revealed < count && unknown.length > 0) {
      const i = Math.floor(this.rng() * unknown.length);
      const t = unknown.splice(i, 1)[0]!;
      this.state.explored[t.y]![t.x] = true;
      // Also open a small blob for readable reveal
      for (const n of neighbors8(t.x, t.y)) {
        if (
          n.x >= 0 &&
          n.y >= 0 &&
          n.x < this.state.width &&
          n.y < this.state.height &&
          !this.state.explored[n.y]![n.x]
        ) {
          this.state.explored[n.y]![n.x] = true;
        }
      }
      revealed++;
    }
    return revealed;
  }

  /** Chance to drop a new data node mid-mission (cap active pickups). */
  private maybeSpawnPickup() {
    const live = livingPickupCount(this.state);
    if (live >= 5) return;
    if (this.rng() > 0.45) return;
    const spawned = spawnPickups(
      this.state,
      1,
      this.state.seed + this.state.turn * 9973,
      `pk_t${this.state.turn}`,
    );
    for (const p of spawned) {
      this.emit('pickupSpawned', {
        pickupId: p.id,
        kind: p.kind,
        pos: { ...p.pos },
      });
    }
    if (spawned.length > 0) {
      this.emit('toast', {
        text: `NEW NODE · ${PICKUP_LABEL[spawned[0]!.kind]}`,
        danger: false,
      });
    }
  }

  performShot(attacker: UnitState, defender: UnitState) {
    let result = resolveShot(this.state, attacker, defender, this.rng);

    // Debug: player always connects
    if (this.debug.alwaysHit && attacker.def.team === 'player' && !result.hit) {
      const raw =
        attacker.def.weapon.damageMin +
        Math.floor(
          this.rng() *
            (attacker.def.weapon.damageMax - attacker.def.weapon.damageMin + 1),
        );
      const dmg = Math.max(1, raw - defender.def.armor);
      result = {
        hit: true,
        crit: false,
        damage: dmg,
        killed: defender.hp - dmg <= 0,
        graze: false,
      };
    }

    // Debug: god mode — probes take no INT loss
    if (this.debug.godMode && defender.def.team === 'player' && result.hit) {
      result = { ...result, damage: 0, killed: false };
    }

    if (!result.hit) {
      this.emit('miss', {
        attackerId: attacker.id,
        targetId: defender.id,
        from: { ...attacker.pos },
        to: { ...defender.pos },
      });
      return result;
    }
    defender.hp -= result.damage;
    this.emit('shot', {
      attackerId: attacker.id,
      targetId: defender.id,
      damage: result.damage,
      crit: result.crit,
      from: { ...attacker.pos },
      to: { ...defender.pos },
    });
    this.emit('damage', {
      unitId: defender.id,
      damage: result.damage,
      crit: result.crit,
      pos: { ...defender.pos },
    });
    if (defender.hp <= 0) {
      defender.hp = 0;
      defender.alive = false;
      defender.overwatching = false;
      this.registerKill(defender, attacker.id);
      this.checkMissionEnd();
    }
    return result;
  }

  resolveGrenade(thrower: UnitState, target: Vec2) {
    this.emit('grenade', { unitId: thrower.id, target: { ...target } });

    // Destroy cover in blast
    for (const p of this.state.props.values()) {
      if (p.destroyed) continue;
      const d = Math.hypot(p.pos.x - target.x, p.pos.y - target.y);
      if (d <= 1.6) this.destroyProp(p.id);
    }

    for (const u of this.state.units.values()) {
      if (!u.alive) continue;
      const dmg = grenadeDamageAt(target, u.pos, this.rng);
      if (dmg <= 0) continue;
      const final = Math.max(1, dmg - u.def.armor);
      u.hp -= final;
      this.emit('damage', {
        unitId: u.id,
        damage: final,
        crit: false,
        pos: { ...u.pos },
        grenade: true,
      });
      if (u.hp <= 0) {
        u.hp = 0;
        u.alive = false;
        this.registerKill(u, thrower.id);
      }
    }
    this.checkMissionEnd();
  }

  /** Record a kill and award XP when a player scores it. */
  private registerKill(victim: UnitState, killerId: string) {
    this.emit('kill', { unitId: victim.id, killerId });
    // Channel host crashed — sever the port uplink
    if (victim.def.team === 'player' && this.state.portLinkUnitId === victim.id) {
      this.severPortLink('dead');
    }
    // Probe crash: lifetime XP is kept on the unit (HUD persists roster on player kill).
    if (victim.def.team !== 'enemy') return;
    const killer = this.state.units.get(killerId);
    if (!killer || killer.def.team !== 'player' || !killer.alive) return;
    const amount = killXp(victim.def.classId);
    const result = grantXp(killer, amount, { gateAbilities: true });
    if (result.gained <= 0) return;
    this.emit('xp', {
      unitId: killer.id,
      amount: result.gained,
      xp: killer.xp,
      level: killer.level,
      source: 'kill',
      victimId: victim.id,
    });
    if (result.leveled) {
      this.emit('levelUp', {
        unitId: killer.id,
        level: killer.level,
        newAbilities: result.newAbilities,
      });
      this.emit('toast', {
        text: `${killer.def.name} · LVL ${killer.level}` +
          (result.newAbilities.length
            ? ` · +${result.newAbilities.length} EXE`
            : ''),
        danger: false,
      });
    }
  }

  /**
   * End-of-breach XP for the whole squad. Call once on missionEnd.
   * Living probes get full mission bonus; dead still bank half (death never wipes XP).
   */
  awardMissionXp(victory: boolean, reason: string): void {
    const bonus = missionBonusXp(victory, reason);
    for (const u of this.state.units.values()) {
      if (u.def.team !== 'player') continue;
      // Dead probes keep lifetime XP and still earn half the mission scrap
      const amount = u.alive ? bonus : Math.max(1, Math.floor(bonus / 2));
      const result = grantXp(u, amount, { gateAbilities: true });
      if (result.gained <= 0) continue;
      this.emit('xp', {
        unitId: u.id,
        amount: result.gained,
        xp: u.xp,
        level: u.level,
        source: 'mission',
        alive: u.alive,
      });
      if (result.leveled) {
        this.emit('levelUp', {
          unitId: u.id,
          level: u.level,
          newAbilities: result.newAbilities,
        });
      }
    }
  }

  destroyProp(propId: string) {
    const p = this.state.props.get(propId);
    if (!p || p.destroyed) return;
    p.destroyed = true;
    p.hp = 0;
    p.level = 0;
    rebuildCoverEdges(this.state.tiles, this.state.props);
    this.emit('coverDestroyed', { propId, pos: { ...p.pos } });
  }

  /** Activated living enemies only — inactive pods never act. */
  enemyUnits(): UnitState[] {
    return [...this.state.units.values()].filter(
      (u) => u.alive && u.def.team === 'enemy' && u.activated,
    );
  }

  playerUnits(): UnitState[] {
    return [...this.state.units.values()].filter(
      (u) => u.alive && u.def.team === 'player',
    );
  }

  tryEnemyMove(unitId: string, to: Vec2): boolean {
    const u = this.state.units.get(unitId);
    if (!u || !u.alive || !u.activated || u.ap <= 0) return false;
    if (u.def.team !== 'enemy') return false;
    const path = findPath(this.state, u.pos, to, unitId, u.def.mobility * u.ap);
    if (!path || path.cost === 0) return false;
    const cost = path.cost <= u.def.mobility ? 1 : 2;
    if (u.ap < cost) return false;

    // Step tile-by-tile for overwatch
    for (let i = 1; i < path.path.length; i++) {
      const step = path.path[i]!;
      u.pos = { ...step };
      this.triggerOverwatch(u);
      if (!u.alive) {
        this.emit('move', { unitId, path: path.path.slice(0, i + 1), cost });
        return true;
      }
    }
    u.ap -= cost;
    this.emit('move', { unitId, path: path.path, cost });
    this.refreshVision();
    return true;
  }

  tryEnemyShoot(attackerId: string, targetId: string): boolean {
    const a = this.state.units.get(attackerId);
    const d = this.state.units.get(targetId);
    if (!a || !d || a.ap < 1) return false;
    if (!a.activated || a.def.team !== 'enemy') return false;
    const los = hasLineOfSight(this.state, a.pos, d.pos);
    if (!canShoot(this.state, a, d, los)) return false;
    this.performShot(a, d);
    a.ap -= 1;
    return true;
  }

  tryEnemyGrenade(unitId: string, target: Vec2): boolean {
    const u = this.state.units.get(unitId);
    if (!u || !u.alive || !u.activated || u.ap < 1) return false;
    if (u.def.team !== 'enemy') return false;
    if (!u.def.abilities.includes('grenade')) return false;
    if ((u.cooldowns.grenade ?? 0) > 0) return false;
    const dist = Math.hypot(target.x - u.pos.x, target.y - u.pos.y);
    if (dist > 5.5) return false;

    u.ap -= 1;
    u.cooldowns.grenade = 99;
    this.resolveGrenade(u, target);
    return true;
  }

  private triggerOverwatch(mover: UnitState) {
    if (mover.def.team !== 'enemy') return;
    for (const u of this.playerUnits()) {
      if (!u.overwatching || !u.alive) continue;
      if (!hasLineOfSight(this.state, u.pos, mover.pos)) continue;
      const dist = Math.hypot(u.pos.x - mover.pos.x, u.pos.y - mover.pos.y);
      if (dist > u.def.weapon.range) continue;
      this.emit('toast', { text: `trap.daemon: ${u.def.name}`, danger: false });
      this.performShot(u, mover);
      u.overwatching = false;
      if (!mover.alive) break;
    }
  }

  private afterPlayerAction(u: UnitState) {
    this.refreshVision();
    this.checkPodActivation();
    this.checkMissionEnd();
    // Auto-select next unit with AP if current empty (skip when free-CYC)
    if (u.ap <= 0 && !this.freeCyc()) {
      const next = this.playerUnits().find((p) => p.ap > 0 && p.id !== u.id);
      if (next) this.selectUnit(next.id);
    }
  }

  refreshVision() {
    if (this.debug.revealAll) {
      for (let y = 0; y < this.state.height; y++) {
        for (let x = 0; x < this.state.width; x++) {
          this.state.explored[y]![x] = true;
        }
      }
    }
    const { tiles, enemyIds } = computePlayerVision(this.state);
    for (const k of tiles) {
      const [xs, ys] = k.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (this.state.explored[y]) this.state.explored[y]![x] = true;
    }
    // Full map vision when debug reveal is on
    if (this.debug.revealAll) {
      const all = new Set<string>();
      const allEnemies = new Set<string>();
      for (let y = 0; y < this.state.height; y++) {
        for (let x = 0; x < this.state.width; x++) all.add(keyOf(x, y));
      }
      for (const e of this.state.units.values()) {
        if (e.alive && e.def.team === 'enemy') {
          allEnemies.add(e.id);
          this.state.lastKnownEnemyPos.set(e.id, { ...e.pos });
        }
      }
      this.state.visibleTiles = all;
      this.state.visibleEnemyIds = allEnemies;
      return;
    }
    this.state.visibleTiles = tiles;
    this.state.visibleEnemyIds = enemyIds;
    // Stamp last-known tiles for enemies currently in LOS (ghosts use these when LOS breaks)
    for (const id of enemyIds) {
      const e = this.state.units.get(id);
      if (e?.alive && e.def.team === 'enemy') {
        this.state.lastKnownEnemyPos.set(id, { x: e.pos.x, y: e.pos.y });
      }
    }
    // Drop ghosts for dead hostiles
    for (const id of [...this.state.lastKnownEnemyPos.keys()]) {
      const e = this.state.units.get(id);
      if (!e || !e.alive || e.def.team !== 'enemy') {
        this.state.lastKnownEnemyPos.delete(id);
      }
    }
  }

  checkPodActivation() {
    for (const pod of this.state.pods.values()) {
      if (pod.activated) continue;
      const seen = pod.memberIds.some((id) => this.state.visibleEnemyIds.has(id));
      if (!seen) continue;
      pod.activated = true;
      for (const id of pod.memberIds) {
        const m = this.state.units.get(id);
        if (m) m.activated = true;
      }
      this.emit('podActivated', { podId: pod.id });
      this.emit('toast', { text: 'CLUSTER WOKEN — HOSTILES ACTIVE', danger: true });
      // Scamper: move members toward nearest cover (avoid stacking)
      const claimed = new Set<string>();
      for (const id of pod.memberIds) {
        const m = this.state.units.get(id);
        if (!m || !m.alive) continue;
        claimed.add(keyOf(m.pos.x, m.pos.y));
      }
      for (const id of pod.memberIds) {
        const m = this.state.units.get(id);
        if (!m || !m.alive) continue;
        const cover = this.findNearestCoverTile(m, claimed);
        if (cover) {
          const path = findPath(this.state, m.pos, cover, m.id, m.def.mobility);
          if (path && path.cost > 0) {
            claimed.delete(keyOf(m.pos.x, m.pos.y));
            m.pos = { ...cover };
            claimed.add(keyOf(cover.x, cover.y));
            this.emit('move', { unitId: m.id, path: path.path, cost: 0, scamper: true });
          }
        }
      }
      this.refreshVision();
    }
  }

  private findNearestCoverTile(u: UnitState, claimed?: Set<string>): Vec2 | null {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const row of this.state.tiles) {
      for (const t of row) {
        if (!t.walkable || t.blocked || t.cover.length === 0) continue;
        const tk = keyOf(t.x, t.y);
        if (claimed?.has(tk)) continue;
        // unoccupied
        let occ = false;
        for (const o of this.state.units.values()) {
          if (o.alive && o.pos.x === t.x && o.pos.y === t.y && o.id !== u.id) occ = true;
        }
        for (const p of this.state.props.values()) {
          if (!p.destroyed && p.pos.x === t.x && p.pos.y === t.y) occ = true;
        }
        if (occ) continue;
        // Prefer live cover edges
        const live = t.cover.some((e) => {
          const prop = this.state.props.get(e.propId);
          return prop != null && !prop.destroyed;
        });
        if (!live) continue;
        const d = Math.hypot(t.x - u.pos.x, t.y - u.pos.y);
        if (d < bestD && d <= u.def.mobility + 1) {
          bestD = d;
          best = { x: t.x, y: t.y };
        }
      }
    }
    return best;
  }

  private applySmokeFlags() {
    for (const u of this.state.units.values()) {
      u.inSmoke = this.state.smokeTiles.has(keyOf(u.pos.x, u.pos.y));
    }
  }

  private refreshAp(team: 'player' | 'enemy') {
    for (const u of this.state.units.values()) {
      if (u.def.team === team && u.alive) {
        u.ap = u.maxAp;
        u.overwatching = false;
      }
    }
  }

  private tickCooldowns(team: 'player' | 'enemy') {
    for (const u of this.state.units.values()) {
      if (u.def.team !== team) continue;
      for (const k of Object.keys(u.cooldowns) as AbilityId[]) {
        const v = u.cooldowns[k];
        if (v != null && v > 0) u.cooldowns[k] = v - 1;
      }
    }
  }

  private clearTurnFlags() {
    for (const u of this.state.units.values()) {
      u.suppressed = false;
      // Clear hunker without touching base defense
      u.hunkered = false;
    }
    // Smoke dissipates every other turn
    if (this.state.turn % 2 === 0) {
      this.state.smokeTiles.clear();
      this.applySmokeFlags();
    } else {
      this.applySmokeFlags();
    }
  }

  /** True if any living player stands on the far-side data port. */
  isOnDataPort(u: UnitState): boolean {
    return this.state.dataPortTiles.some((t) => t.x === u.pos.x && t.y === u.pos.y);
  }

  /**
   * After a move: cancel channel if the linker stepped off; nudge if they stepped on.
   * Standing on the pylon alone never wins — must arm link.sys and hold.
   */
  private onUnitMovedPort(u: UnitState) {
    if (u.def.team !== 'player') return;
    if (this.state.portLinkUnitId === u.id && !this.isOnDataPort(u)) {
      this.severPortLink('moved');
      return;
    }
    if (this.isOnDataPort(u) && this.state.portLinkUnitId !== u.id && !this.state.dataPortSecured) {
      this.emit('toast', {
        text: `${u.def.name} · ON DATA PORT — RUN link.sys TO CHANNEL`,
        danger: false,
      });
    }
  }

  /** Arm the uplink while standing on a data port tile (1 CYC). */
  tryLinkPort(unitId: string): boolean {
    if (this.state.phase !== 'player' || this.isMissionOver()) return false;
    const u = this.state.units.get(unitId);
    if (!u || !u.alive || u.def.team !== 'player') return false;
    if (!this.isOnDataPort(u)) return false;
    if (!this.hasAp(u, 1)) return false;

    this.spendAp(u, 1);
    u.overwatching = false;
    // Switching host resets progress; same host can re-arm without reset
    if (this.state.portLinkUnitId !== u.id) {
      this.state.portLinkProgress = 0;
    }
    this.state.portLinkUnitId = u.id;
    const need = this.state.portLinkRequired;
    this.emit('toast', {
      text: `${u.def.name} · link.sys ARMED — HOLD ${need} HOSTILE CYCLE${need === 1 ? '' : 'S'}`,
      danger: false,
    });
    this.afterPlayerAction(u);
    return true;
  }

  /** Drop an in-progress port channel (step-off, crash, or reset). */
  private severPortLink(reason: 'moved' | 'dead' | 'reset') {
    if (!this.state.portLinkUnitId && this.state.portLinkProgress === 0) return;
    this.state.portLinkUnitId = null;
    this.state.portLinkProgress = 0;
    if (reason === 'moved') {
      this.emit('toast', { text: 'PORT LINK SEVERED — LEFT PYLON', danger: true });
    } else if (reason === 'dead') {
      this.emit('toast', { text: 'PORT LINK SEVERED — CHANNEL HOST CRASHED', danger: true });
    }
  }

  /**
   * After each hostile cycle: if the channel host is still alive on the pylon,
   * advance progress. Completing the required holds secures the port.
   */
  private tickPortLink(): boolean {
    if (this.state.dataPortSecured || this.isMissionOver()) return false;
    const id = this.state.portLinkUnitId;
    if (!id) return false;
    const u = this.state.units.get(id);
    if (!u || !u.alive) {
      this.severPortLink('dead');
      return false;
    }
    if (!this.isOnDataPort(u)) {
      this.severPortLink('moved');
      return false;
    }

    this.state.portLinkProgress += 1;
    const need = this.state.portLinkRequired;
    const cur = this.state.portLinkProgress;
    if (cur < need) {
      this.emit('toast', {
        text: `PORT SYNC ${cur}/${need} — HOLD THE PYLON`,
        danger: false,
      });
      return false;
    }

    this.state.dataPortSecured = true;
    this.emit('toast', {
      text: `${u.def.name} · DATA PORT LINKED — EXFIL OPEN`,
      danger: false,
    });
    return this.checkMissionEnd();
  }

  /**
   * Debug / force path: instantly complete the port channel for the unit.
   * Normal play never wins by mere presence — use tryLinkPort + hold.
   */
  checkDataPort(u: UnitState): boolean {
    if (this.isMissionOver() || u.def.team !== 'player' || !u.alive) return false;
    if (!this.isOnDataPort(u)) return false;
    this.state.portLinkUnitId = u.id;
    this.state.portLinkProgress = this.state.portLinkRequired;
    this.state.dataPortSecured = true;
    this.emit('toast', {
      text: `${u.def.name} · DATA PORT LINKED — EXFIL OPEN`,
      danger: false,
    });
    return this.checkMissionEnd();
  }

  /**
   * Win: all hostiles eliminated OR data port channel completed (link + hold).
   * Lose: all player units eliminated (or deadline — handled in endEnemyTurn).
   * Idempotent — emits missionEnd only once.
   */
  checkMissionEnd(): boolean {
    if (this.isMissionOver()) return true;

    const playersAlive = this.playerUnits().length;
    const enemiesAlive = this.hostilesRemaining();

    if (playersAlive === 0) {
      this.state.phase = 'defeat';
      this.emit('missionEnd', {
        result: 'defeat',
        reason: 'squad_wiped',
        hostilesRemaining: enemiesAlive,
      });
      this.emit('toast', { text: 'PROBE TEAM CRASHED — LINK SEVERED', danger: true });
      return true;
    }

    // Safety: if somehow past limit during player phase
    if (
      this.state.missionType === 'deadline' &&
      this.state.turnLimit != null &&
      this.state.turn > this.state.turnLimit
    ) {
      this.failDeadline();
      return true;
    }

    // Infiltrate win: channel finished (not mere presence on the pylon)
    if (this.state.dataPortSecured) {
      const porter = this.playerUnits().find((p) => this.isOnDataPort(p));
      this.state.phase = 'victory';
      this.emit('missionEnd', {
        result: 'victory',
        reason: 'data_port',
        unitId: porter?.id ?? this.state.portLinkUnitId,
        squadAlive: playersAlive,
        hostilesRemaining: enemiesAlive,
      });
      this.emit('toast', {
        text: 'DATA PORT SECURED — BREACH SUCCESS',
        danger: false,
      });
      return true;
    }

    if (enemiesAlive === 0) {
      this.state.phase = 'victory';
      this.emit('missionEnd', {
        result: 'victory',
        reason: 'hostiles_eliminated',
        squadAlive: playersAlive,
      });
      this.emit('toast', { text: 'NODE CLEAN — ALL HOSTILES KILLED', danger: false });
      return true;
    }

    return false;
  }

  hostilesRemaining(): number {
    return [...this.state.units.values()].filter(
      (u) => u.alive && u.def.team === 'enemy',
    ).length;
  }

  squadAliveCount(): number {
    return this.playerUnits().length;
  }

  abilityReady(u: UnitState, id: AbilityId): boolean {
    // link.sys is contextual (on data port) — not stored on class kits
    if (id === 'link') {
      if (!this.isOnDataPort(u) || this.state.dataPortSecured) return false;
      return this.freeCyc() || u.ap >= 1;
    }
    if (id !== 'move' && !u.def.abilities.includes(id)) return false;
    if (!this.freeCyc() && (u.cooldowns[id] ?? 0) > 0) return false;
    if (this.freeCyc()) return true;
    if (id === 'move') return u.ap >= 1;
    if (id === 'overwatch' || id === 'hunker') return u.ap >= 1;
    if (id === 'shoot' || id === 'grenade' || id === 'breach' || id === 'suppress' || id === 'smoke' || id === 'heal')
      return u.ap >= 1;
    return u.ap >= 1;
  }

  // ── Debug cheats ─────────────────────────────────────────

  debugClearFog() {
    this.debug.revealAll = true;
    this.refreshVision();
    this.emit('toast', { text: 'DBG · FOG CLEARED', danger: false });
  }

  debugToggleFreeCyc() {
    this.debug.freeCyc = !this.debug.freeCyc;
    this.emit('toast', {
      text: this.debug.freeCyc ? 'DBG · FREE CYC ON' : 'DBG · FREE CYC OFF',
      danger: false,
    });
  }

  debugToggleGod() {
    this.debug.godMode = !this.debug.godMode;
    this.emit('toast', {
      text: this.debug.godMode ? 'DBG · GOD MODE ON' : 'DBG · GOD MODE OFF',
      danger: false,
    });
  }

  debugToggleAlwaysHit() {
    this.debug.alwaysHit = !this.debug.alwaysHit;
    this.emit('toast', {
      text: this.debug.alwaysHit ? 'DBG · ALWAYS HIT ON' : 'DBG · ALWAYS HIT OFF',
      danger: false,
    });
  }

  debugHealTeam() {
    for (const u of this.playerUnits()) {
      u.hp = u.def.maxHp;
      u.ap = u.maxAp;
      u.suppressed = false;
      u.cooldowns = {};
    }
    this.emit('toast', { text: 'DBG · TEAM RESTORED', danger: false });
  }

  debugKillHostiles() {
    for (const u of this.state.units.values()) {
      if (u.def.team === 'enemy' && u.alive) {
        u.hp = 0;
        u.alive = false;
      }
    }
    this.emit('toast', { text: 'DBG · HOSTILES WIPED', danger: false });
    this.checkMissionEnd();
  }

  debugWinPort() {
    const u = this.getSelected() ?? this.playerUnits()[0];
    if (!u) return;
    const port = this.state.dataPortTiles[0];
    if (port) u.pos = { ...port };
    this.checkDataPort(u);
  }

  debugRefillCyc() {
    for (const u of this.playerUnits()) u.ap = u.maxAp;
    this.emit('toast', { text: 'DBG · CYC REFILLED', danger: false });
  }

  /** Instant +XP for testing progression (selected probe or first). */
  debugGrantXp(amount = 80) {
    const u = this.getSelected() ?? this.playerUnits()[0];
    if (!u) return;
    const result = grantXp(u, amount, { gateAbilities: true });
    this.emit('xp', {
      unitId: u.id,
      amount: result.gained,
      xp: u.xp,
      level: u.level,
      source: 'debug',
    });
    if (result.leveled) {
      this.emit('levelUp', {
        unitId: u.id,
        level: u.level,
        newAbilities: result.newAbilities,
      });
      this.emit('toast', {
        text: `${u.def.name} · LVL ${u.level} (+${amount} XP)`,
        danger: false,
      });
    } else {
      this.emit('toast', {
        text: `${u.def.name} · +${amount} XP`,
        danger: false,
      });
    }
  }

  // expose cover helper for UI
  getCoverVs(defenderId: string, from: Vec2) {
    const d = this.state.units.get(defenderId);
    if (!d) return null;
    return getDefensiveCover(this.state, d, from);
  }
}
