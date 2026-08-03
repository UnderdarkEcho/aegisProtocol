import { describe, expect, it } from 'vitest';
import { createMission } from '../content/map';
import { previewShot, resolveShot } from './combat';
import { getDefensiveCover, tileCoverLevel } from './cover';
import { Game } from './game';
import { hasLineOfSight, computePlayerVision } from './los';
import { findPath, reachableTiles } from './pathfinding';
import { createRng } from './rng';

describe('combat math', () => {
  it('applies full cover penalty (40) when facing barrier', () => {
    const state = createMission(42);
    const atk = state.units.get('p_mark')!;
    const def = state.units.get('e_pmc1')!;
    // barrier b1 at (10,14); defender south gets N-facing cover
    def.pos = { x: 10, y: 15 };
    atk.pos = { x: 10, y: 12 };

    const cover = getDefensiveCover(state, def, atk.pos);
    expect(cover.level).toBe(2);
    expect(cover.penalty).toBe(40);
    expect(cover.flanked).toBe(false);

    const preview = previewShot(state, atk, def);
    expect(preview.coverPenalty).toBe(40);
    expect(preview.flanked).toBe(false);
    expect(preview.reason).toBe('FULL COVER');
    expect(preview.hitChance).toBeGreaterThanOrEqual(1);
    expect(preview.hitChance).toBeLessThanOrEqual(99);
  });

  it('applies half cover penalty (20)', () => {
    const state = createMission(1);
    const atk = state.units.get('p_mark')!;
    const def = state.units.get('e_pmc1')!;
    // half crate b2 at (11,11); stand south → cover faces N
    def.pos = { x: 11, y: 12 };
    atk.pos = { x: 11, y: 9 };

    const cover = getDefensiveCover(state, def, atk.pos);
    expect(cover.level).toBe(1);
    expect(cover.penalty).toBe(20);
    expect(cover.flanked).toBe(false);
  });

  it('detects flank from open side of cover', () => {
    const state = createMission(1);
    const atk = state.units.get('p_mark')!;
    const def = state.units.get('e_pmc1')!;
    def.pos = { x: 10, y: 15 }; // N-facing cover vs b1
    atk.pos = { x: 14, y: 15 }; // pure east — open side

    const cover = getDefensiveCover(state, def, atk.pos);
    expect(cover.flanked).toBe(true);
    expect(cover.penalty).toBe(0);

    const preview = previewShot(state, atk, def);
    expect(preview.flanked).toBe(true);
    expect(preview.reason).toBe('FLANK');
  });

  it('detects flanking angle when attack is more lateral than frontal', () => {
    const state = createMission(1);
    const atk = state.units.get('p_mark')!;
    const def = state.units.get('e_pmc1')!;
    def.pos = { x: 10, y: 15 };
    atk.pos = { x: 13, y: 14 }; // NE, |dx| > |dy|

    const cover = getDefensiveCover(state, def, atk.pos);
    expect(cover.flanked).toBe(true);
    expect(cover.penalty).toBe(0);
  });

  it('hunker doubles cover bonus without mutating base defense', () => {
    const state = createMission(1);
    const game = new Game(state);
    game.startMission();
    const def = game.state.units.get('p_mark')!;
    const atk = game.state.units.get('e_pmc1')!;
    atk.activated = true;
    def.pos = { x: 10, y: 15 };
    atk.pos = { x: 10, y: 12 };

    const baseDefense = def.def.defense;
    const open = previewShot(game.state, atk, def);
    expect(open.coverPenalty).toBe(40);

    expect(game.tryHunker(def.id)).toBe(true);
    expect(def.hunkered).toBe(true);
    expect(def.def.defense).toBe(baseDefense); // never mutated

    const hunkered = previewShot(game.state, atk, def);
    expect(hunkered.coverPenalty).toBe(80);
    expect(hunkered.hitChance).toBeLessThan(open.hitChance);

    // Stacking: calling clear via endEnemyTurn resets without stacking residue
    game.state.phase = 'enemy';
    game.endEnemyTurn();
    expect(def.hunkered).toBe(false);
    expect(def.def.defense).toBe(baseDefense);
    const after = previewShot(game.state, atk, def);
    expect(after.coverPenalty).toBe(40);
  });

  it('resolves deterministic shots with seed', () => {
    const state = createMission(7);
    const a = state.units.get('p_breach')!;
    const d = state.units.get('e_pmc1')!;
    a.pos = { x: 11, y: 12 };
    d.pos = { x: 11, y: 10 };
    const rng = createRng(99);
    const r1 = resolveShot(state, a, d, rng);
    const rng2 = createRng(99);
    const r2 = resolveShot(state, a, d, rng2);
    expect(r1).toEqual(r2);
  });
});

describe('LOS', () => {
  it('blocks LOS through walls', () => {
    const state = createMission(1);
    // Center server block 12-16,12-16 — line through it
    const from = { x: 11, y: 14 };
    const to = { x: 17, y: 14 };
    expect(hasLineOfSight(state, from, to)).toBe(false);
  });

  it('blocks LOS through full cover props (level 2)', () => {
    const state = createMission(1);
    // b1 barrier level 2 at (10,14)
    expect(hasLineOfSight(state, { x: 10, y: 12 }, { x: 10, y: 16 })).toBe(false);
  });

  it('does not block LOS through half cover props', () => {
    const state = createMission(1);
    // b2 crate level 1 at (11,11)
    expect(hasLineOfSight(state, { x: 11, y: 9 }, { x: 11, y: 13 })).toBe(true);
  });

  it('allows LOS with ignoreProps', () => {
    const state = createMission(1);
    expect(
      hasLineOfSight(state, { x: 10, y: 12 }, { x: 10, y: 16 }, { ignoreProps: true }),
    ).toBe(true);
  });

  it('restores LOS after full cover prop destroyed', () => {
    const state = createMission(1);
    const game = new Game(state);
    expect(hasLineOfSight(game.state, { x: 10, y: 12 }, { x: 10, y: 16 })).toBe(false);
    game.destroyProp('b1');
    expect(hasLineOfSight(game.state, { x: 10, y: 12 }, { x: 10, y: 16 })).toBe(true);
  });
});

describe('grenade cover destroy', () => {
  it('destroys props in blast and clears cover edges', () => {
    const state = createMission(1);
    const game = new Game(state);
    game.startMission();
    const heavy = game.state.units.get('p_heavy')!;
    heavy.pos = { x: 10, y: 16 };
    heavy.ap = 2;

    const def = game.state.units.get('e_pmc1')!;
    def.pos = { x: 10, y: 15 };
    const before = getDefensiveCover(game.state, def, { x: 10, y: 12 });
    expect(before.level).toBe(2);

    expect(game.tryGrenade(heavy.id, { x: 10, y: 14 })).toBe(true);
    expect(game.state.props.get('b1')!.destroyed).toBe(true);

    const destroyedEvents = game.state.log.filter((e) => e.type === 'coverDestroyed');
    expect(destroyedEvents.some((e) => e.payload.propId === 'b1')).toBe(true);

    const after = getDefensiveCover(game.state, def, { x: 10, y: 12 });
    expect(after.level).toBe(0);
    expect(after.penalty).toBe(0);
  });
});

describe('pod activation via Game API', () => {
  it('starts with inactive pods and empty enemyUnits()', () => {
    const state = createMission(1);
    const game = new Game(state);
    game.startMission();
    for (const pod of game.state.pods.values()) {
      expect(pod.activated).toBe(false);
    }
    for (const u of game.state.units.values()) {
      if (u.def.team === 'enemy') expect(u.activated).toBe(false);
    }
    expect(game.enemyUnits()).toHaveLength(0);
  });

  it('does not reveal enemies at spawn (fair fog)', () => {
    const state = createMission(1);
    const game = new Game(state);
    game.startMission();
    const vis = computePlayerVision(game.state);
    expect(vis.enemyIds.size).toBe(0);
    expect(game.state.visibleEnemyIds.size).toBe(0);
  });

  it('activates pod when member enters player vision', () => {
    const state = createMission(1);
    const game = new Game(state);
    game.startMission();

    // Move a player into LOS of pod A courtyard
    const breach = game.state.units.get('p_breach')!;
    breach.pos = { x: 11, y: 12 };
    game.refreshVision();
    game.checkPodActivation();

    const podA = game.state.pods.get('podA')!;
    expect(podA.activated).toBe(true);
    expect(game.state.units.get('e_pmc1')!.activated).toBe(true);
    expect(game.state.units.get('e_pmc2')!.activated).toBe(true);
    expect(game.state.units.get('e_drone1')!.activated).toBe(true);

    const activated = game.state.log.filter((e) => e.type === 'podActivated');
    expect(activated.some((e) => e.payload.podId === 'podA')).toBe(true);

    // Only pod A members act; other pods still inactive
    expect(game.state.pods.get('podB')!.activated).toBe(false);
    expect(game.state.pods.get('podC')!.activated).toBe(false);
    const acting = game.enemyUnits().map((u) => u.id).sort();
    expect(acting).toEqual(['e_drone1', 'e_pmc1', 'e_pmc2']);
  });

  it('rejects enemy actions for inactive units', () => {
    const state = createMission(1);
    const game = new Game(state);
    const e = game.state.units.get('e_pmc1')!;
    e.ap = 2;
    e.activated = false;
    const player = game.state.units.get('p_breach')!;

    expect(game.tryEnemyShoot(e.id, player.id)).toBe(false);
    expect(game.tryEnemyMove(e.id, { x: e.pos.x + 1, y: e.pos.y })).toBe(false);
    expect(game.tryEnemyGrenade(e.id, player.pos)).toBe(false);
  });
});

describe('pathfinding', () => {
  it('finds path around buildings', () => {
    const state = createMission(1);
    const path = findPath(state, { x: 11, y: 21 }, { x: 12, y: 10 }, 'p_breach', 40);
    expect(path).not.toBeNull();
    expect(path!.cost).toBeGreaterThan(0);
  });

  it('rejects path onto occupied tiles and props', () => {
    const state = createMission(1);
    const ally = state.units.get('p_mark')!;
    // path onto ally
    expect(findPath(state, { x: 11, y: 21 }, ally.pos, 'p_breach', 20)).toBeNull();
    // path onto prop
    expect(findPath(state, { x: 11, y: 21 }, { x: 10, y: 20 }, 'p_breach', 20)).toBeNull();
  });

  it('returns cost 0 for same tile', () => {
    const state = createMission(1);
    const p = findPath(state, { x: 11, y: 21 }, { x: 11, y: 21 }, 'p_breach');
    expect(p).toEqual({ path: [{ x: 11, y: 21 }], cost: 0 });
  });

  it('respects maxCost', () => {
    const state = createMission(1);
    const far = findPath(state, { x: 11, y: 21 }, { x: 12, y: 10 }, 'p_breach', 3);
    expect(far).toBeNull();
  });

  it('blue/yellow reachable split by mobility', () => {
    const state = createMission(1);
    const u = state.units.get('p_breach')!;
    u.ap = 2;
    const { blue, yellow } = reachableTiles(state, u);
    expect(blue.size).toBeGreaterThan(0);
    for (const r of blue.values()) {
      expect(r.cost).toBeLessThanOrEqual(u.def.mobility);
    }
    for (const r of yellow.values()) {
      expect(r.cost).toBeGreaterThan(u.def.mobility);
      expect(r.cost).toBeLessThanOrEqual(u.def.mobility * 2);
    }
  });
});

describe('cover edges', () => {
  it('rebuild attaches correct facing toward prop', () => {
    const state = createMission(1);
    // b1 at (10,14): tile south (10,15) should face N
    const south = state.tiles[15]![10]!.cover;
    expect(south.some((e) => e.dir === 'N' && e.propId === 'b1' && e.level === 2)).toBe(
      true,
    );
    // tile north (10,13) faces S
    const north = state.tiles[13]![10]!.cover;
    expect(north.some((e) => e.dir === 'S' && e.propId === 'b1')).toBe(true);
  });

  it('tileCoverLevel ignores destroyed props', () => {
    const state = createMission(1);
    const game = new Game(state);
    expect(tileCoverLevel(game.state, 10, 15)).toBe(2);
    game.destroyProp('b1');
    expect(tileCoverLevel(game.state, 10, 15)).toBe(0);
  });
});

describe('mission', () => {
  it('starts with 4 players and inactive pods', () => {
    const state = createMission(1);
    const players = [...state.units.values()].filter((u) => u.def.team === 'player');
    expect(players).toHaveLength(4);
    for (const pod of state.pods.values()) {
      expect(pod.activated).toBe(false);
    }
  });

  it('places all units on walkable unblocked tiles', () => {
    const state = createMission(1);
    for (const u of state.units.values()) {
      const t = state.tiles[u.pos.y]![u.pos.x]!;
      expect(t.walkable).toBe(true);
      expect(t.blocked).toBe(false);
    }
  });

  it('enemy grenade API works when activated with ability', () => {
    const state = createMission(1);
    const game = new Game(state);
    const e = game.state.units.get('e_pmc1')!;
    e.activated = true;
    e.ap = 2;
    e.pos = { x: 12, y: 18 };
    // clump players
    game.state.units.get('p_breach')!.pos = { x: 12, y: 20 };
    game.state.units.get('p_mark')!.pos = { x: 13, y: 20 };

    expect(game.tryEnemyGrenade(e.id, { x: 12, y: 20 })).toBe(true);
    expect(e.ap).toBe(1);
    expect(e.cooldowns.grenade).toBe(99);
    expect(game.state.log.some((ev) => ev.type === 'grenade')).toBe(true);
  });
});

describe('data port victory', () => {
  it('places a walkable data port on the north side', () => {
    const state = createMission(1, 'normal');
    expect(state.dataPortTiles.length).toBeGreaterThan(0);
    for (const t of state.dataPortTiles) {
      expect(t.y).toBeLessThan(8);
      const tile = state.tiles[t.y]![t.x]!;
      expect(tile.walkable).toBe(true);
      expect(tile.blocked).toBe(false);
    }
  });

  it('does not win merely by standing on the data port', () => {
    const game = new Game(createMission(5, 'normal'));
    game.startMission();
    const u = game.state.units.get('p_breach')!;
    const port = game.state.dataPortTiles[0]!;
    u.pos = { ...port };
    u.ap = 2;
    // Presence alone is never a win (anti zerg-rush)
    expect(game.state.phase).toBe('player');
    expect(game.state.dataPortSecured).toBe(false);
    expect(game.checkMissionEnd()).toBe(false);
  });

  it('wins after link.sys and surviving required hostile holds', () => {
    const game = new Game(createMission(5, 'normal'));
    game.startMission();
    // Vesper requires 2 holds — force 1 for a tight unit test
    game.state.portLinkRequired = 1;
    const u = game.state.units.get('p_breach')!;
    const port = game.state.dataPortTiles[0]!;
    u.pos = { ...port };
    u.ap = 2;
    expect(game.tryLinkPort(u.id)).toBe(true);
    expect(game.state.portLinkUnitId).toBe(u.id);
    expect(game.state.dataPortSecured).toBe(false);

    game.endPlayerTurn();
    game.endEnemyTurn(); // hold completes → victory

    expect(game.state.dataPortSecured).toBe(true);
    expect(game.state.phase).toBe('victory');
    const end = game.state.log.find((e) => e.type === 'missionEnd');
    expect(end?.payload.reason).toBe('data_port');
  });

  it('severs port link when the channel host leaves the pylon', () => {
    const game = new Game(createMission(5, 'normal'));
    game.startMission();
    const u = game.state.units.get('p_breach')!;
    const port = game.state.dataPortTiles[0]!;
    u.pos = { ...port };
    u.ap = 2;
    expect(game.tryLinkPort(u.id)).toBe(true);
    // Step clearly off every port tile (cluster is 2×2 — move south of it)
    game.debug.freeCyc = true;
    u.ap = 2;
    const maxPortY = Math.max(...game.state.dataPortTiles.map((t) => t.y));
    const off = { x: port.x, y: maxPortY + 2 };
    game.state.tiles[off.y]![off.x]!.walkable = true;
    game.state.tiles[off.y]![off.x]!.blocked = false;
    // Clear props/units that might block pathfinding on the way
    expect(game.isOnDataPort({ ...u, pos: off } as typeof u)).toBe(false);
    expect(game.tryMove(u.id, off)).toBe(true);
    expect(game.isOnDataPort(u)).toBe(false);
    expect(game.state.portLinkUnitId).toBeNull();
    expect(game.state.portLinkProgress).toBe(0);
  });
});

describe('pickups', () => {
  it('spawns pickups on walkable empty tiles', () => {
    const state = createMission(42, 'normal');
    expect(state.pickups.size).toBeGreaterThan(0);
    for (const p of state.pickups.values()) {
      const t = state.tiles[p.pos.y]![p.pos.x]!;
      expect(t.walkable).toBe(true);
      expect(t.blocked).toBe(false);
      expect(p.collected).toBe(false);
    }
  });

  it('collects cycles pickup and restores AP', () => {
    const game = new Game(createMission(99, 'normal'));
    game.startMission();
    const u = game.state.units.get('p_breach')!;
    // Place a cycles node under unit
    const pk = [...game.state.pickups.values()][0]!;
    pk.kind = 'cycles';
    pk.amount = 2;
    pk.collected = false;
    u.pos = { ...pk.pos };
    u.ap = 0;
    expect(game.tryCollectPickup(u)).toBe(true);
    expect(u.ap).toBe(2);
    expect(pk.collected).toBe(true);
    expect(game.state.log.some((e) => e.type === 'pickupCollected')).toBe(true);
  });

  it('records last-known enemy positions for FOW ghosts', () => {
    const game = new Game(createMission(1, 'normal'));
    game.startMission();
    const enemy = game.state.units.get('e_pmc1')!;
    enemy.activated = true;
    // Place enemy next to a player so LOS is clear
    const player = game.state.units.get('p_mark')!;
    player.pos = { x: 11, y: 12 };
    enemy.pos = { x: 11, y: 11 };
    game.refreshVision();
    expect(game.state.visibleEnemyIds.has('e_pmc1')).toBe(true);
    expect(game.state.lastKnownEnemyPos.get('e_pmc1')).toEqual({ x: 11, y: 11 });

    // Break LOS by moving enemy far behind walls / out of sight
    const last = { ...enemy.pos };
    enemy.pos = { x: 1, y: 1 };
    game.refreshVision();
    // May or may not still be visible depending on map — if not visible, ghost holds last pos
    if (!game.state.visibleEnemyIds.has('e_pmc1')) {
      expect(game.state.lastKnownEnemyPos.get('e_pmc1')).toEqual(last);
    } else {
      // Still visible (open map): last known should track live pos
      expect(game.state.lastKnownEnemyPos.get('e_pmc1')).toEqual({ x: 1, y: 1 });
    }
  });

  it('clears last-known when enemy dies', () => {
    const game = new Game(createMission(1, 'normal'));
    game.startMission();
    const enemy = game.state.units.get('e_drone1')!;
    enemy.pos = { x: 12, y: 12 };
    game.state.lastKnownEnemyPos.set('e_drone1', { x: 12, y: 12 });
    enemy.hp = 0;
    enemy.alive = false;
    game.refreshVision();
    expect(game.state.lastKnownEnemyPos.has('e_drone1')).toBe(false);
  });

  it('scan pickup reveals unexplored tiles', () => {
    const game = new Game(createMission(7, 'normal'));
    game.startMission();
    const u = game.state.units.get('p_mark')!;
    const unexploredBefore = game.state.explored.flat().filter((v) => !v).length;
    const pk = [...game.state.pickups.values()][0]!;
    pk.kind = 'scan';
    pk.amount = 12;
    pk.collected = false;
    u.pos = { ...pk.pos };
    game.tryCollectPickup(u);
    const unexploredAfter = game.state.explored.flat().filter((v) => !v).length;
    expect(unexploredAfter).toBeLessThan(unexploredBefore);
  });

  it('emits heal event with actual integrity restored', () => {
    const game = new Game(
      createMission(3, 'normal', {
        roster: {
          version: 1,
          operatives: [
            { id: 'p_breach', name: 'REYES', classId: 'breacher', xp: 0, wounded: false },
            { id: 'p_mark', name: 'CHEN', classId: 'marksman', xp: 0, wounded: false },
            { id: 'p_sup', name: 'OKAFOR', classId: 'support', xp: 200, wounded: false },
            { id: 'p_heavy', name: 'VOLKOV', classId: 'heavy', xp: 0, wounded: false },
          ],
        },
        gateAbilities: true,
      }),
    );
    game.startMission();
    const support = game.state.units.get('p_sup')!;
    const target = game.state.units.get('p_breach')!;
    expect(support.def.abilities).toContain('heal');
    target.hp = Math.max(1, target.def.maxHp - 3);
    support.pos = { ...target.pos };
    support.ap = 2;
    const before = target.hp;
    expect(game.tryHeal(support.id, target.id)).toBe(true);
    expect(target.hp).toBeGreaterThan(before);
    const heal = game.state.log.find((e) => e.type === 'heal');
    expect(heal).toBeTruthy();
    expect(Number(heal!.payload.amount)).toBe(target.hp - before);
  });
});

describe('debug practice taint', () => {
  it('markDebugUsed flags the run as practice', () => {
    const game = new Game(createMission(1, 'normal'));
    game.startMission();
    expect(game.debugTainted).toBe(false);
    game.markDebugUsed();
    expect(game.debugTainted).toBe(true);
    game.debugToggleGod();
    expect(game.debugTainted).toBe(true);
  });
});

describe('difficulty', () => {
  it('scales enemy aim and HP on hard vs easy', () => {
    const easy = createMission(1, 'easy');
    const hard = createMission(1, 'hard');
    const extreme = createMission(1, 'extreme');
    const eEasy = easy.units.get('e_pmc1')!;
    const eHard = hard.units.get('e_pmc1')!;
    const eExt = extreme.units.get('e_pmc1')!;
    expect(eExt.def.aim).toBeGreaterThan(eHard.def.aim);
    expect(eExt.def.maxHp).toBeGreaterThan(eHard.def.maxHp);
    expect(eHard.def.aim).toBeGreaterThan(eEasy.def.aim);
    expect(eHard.def.maxHp).toBeGreaterThan(eEasy.def.maxHp);
    expect(easy.difficulty).toBe('easy');
    expect(hard.difficulty).toBe('hard');
  });

  it('defaults to normal', () => {
    const m = createMission(1);
    expect(m.difficulty).toBe('normal');
  });
});

describe('win / lose conditions', () => {
  it('victory when all hostiles are eliminated', () => {
    const game = new Game(createMission(1));
    game.startMission();
    for (const u of game.state.units.values()) {
      if (u.def.team === 'enemy') {
        u.hp = 0;
        u.alive = false;
      }
    }
    expect(game.checkMissionEnd()).toBe(true);
    expect(game.state.phase).toBe('victory');
    expect(game.isMissionOver()).toBe(true);
    const ends = game.state.log.filter((e) => e.type === 'missionEnd');
    expect(ends).toHaveLength(1);
    expect(ends[0]!.payload.result).toBe('victory');
    // Idempotent
    expect(game.checkMissionEnd()).toBe(true);
    expect(game.state.log.filter((e) => e.type === 'missionEnd')).toHaveLength(1);
  });

  it('defeat when entire squad is wiped', () => {
    const game = new Game(createMission(1));
    game.startMission();
    for (const u of game.state.units.values()) {
      if (u.def.team === 'player') {
        u.hp = 0;
        u.alive = false;
      }
    }
    expect(game.checkMissionEnd()).toBe(true);
    expect(game.state.phase).toBe('defeat');
    expect(game.isMissionOver()).toBe(true);
    const ends = game.state.log.filter((e) => e.type === 'missionEnd');
    expect(ends).toHaveLength(1);
    expect(ends[0]!.payload.result).toBe('defeat');
  });

  it('killing the last enemy via shot triggers victory', () => {
    const game = new Game(createMission(99));
    game.startMission();
    // Wipe all enemies except one
    for (const u of game.state.units.values()) {
      if (u.def.team === 'enemy' && u.id !== 'e_pmc1') {
        u.hp = 0;
        u.alive = false;
      }
    }
    const atk = game.state.units.get('p_mark')!;
    const def = game.state.units.get('e_pmc1')!;
    atk.pos = { x: 11, y: 12 };
    atk.ap = 2;
    def.pos = { x: 11, y: 10 };
    def.hp = 1;
    def.def.armor = 0;
    def.activated = true;
    // Force a hit by maxing aim
    atk.def.aim = 200;
    def.def.defense = 0;
    expect(game.tryShoot(atk.id, def.id)).toBe(true);
    expect(game.state.phase).toBe('victory');
  });

  it('blocks end turn after mission is over', () => {
    const game = new Game(createMission(1));
    game.startMission();
    for (const u of game.state.units.values()) {
      if (u.def.team === 'enemy') {
        u.alive = false;
        u.hp = 0;
      }
    }
    game.checkMissionEnd();
    game.endPlayerTurn();
    expect(game.state.phase).toBe('victory');
  });
});
