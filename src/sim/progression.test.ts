import { describe, expect, it } from 'vitest';
import { createMission } from '../content/map';
import { Game } from './game';
import {
  abilitiesAtLevel,
  applyPostMissionWounds,
  applyWoundDebuffs,
  buildSoldierAtLevel,
  debriefGrade,
  defaultRoster,
  grantXp,
  killXp,
  levelFromXp,
  missionBonusXp,
  privilegeBoostCost,
  rosterFromUnits,
  totalXpForLevel,
  xpToNextLevel,
  xpToReachLevel,
  MAX_LEVEL,
} from './progression';

describe('progression XP curve', () => {
  it('level 1 starts at 0 XP', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(totalXpForLevel(1)).toBe(0);
  });

  it('advances levels along the curve', () => {
    const to2 = xpToNextLevel(1);
    expect(levelFromXp(to2 - 1)).toBe(1);
    expect(levelFromXp(to2)).toBe(2);
    expect(levelFromXp(totalXpForLevel(MAX_LEVEL))).toBe(MAX_LEVEL);
  });

  it('caps at MAX_LEVEL', () => {
    expect(levelFromXp(99999)).toBe(MAX_LEVEL);
  });
});

describe('privilege boost cost', () => {
  it('scales by level and nulls at max', () => {
    expect(privilegeBoostCost(1)).toBe(115);
    expect(privilegeBoostCost(2)).toBe(150);
    expect(privilegeBoostCost(MAX_LEVEL)).toBeNull();
  });

  it('xpToReachLevel covers the gap to next level', () => {
    const atL1 = 0;
    const need = xpToReachLevel(atL1, 2);
    expect(levelFromXp(atL1 + need)).toBe(2);
  });
});

describe('ability unlocks', () => {
  it('L1 is core kit only when gated', () => {
    const abs = abilitiesAtLevel('breacher', 1);
    expect(abs).toContain('shoot');
    expect(abs).toContain('overwatch');
    expect(abs).not.toContain('grenade');
    expect(abs).not.toContain('breach');
  });

  it('unlocks class tools by level', () => {
    expect(abilitiesAtLevel('breacher', 2)).toContain('breach');
    expect(abilitiesAtLevel('breacher', 3)).toContain('grenade');
    expect(abilitiesAtLevel('support', 2)).toContain('heal');
    expect(abilitiesAtLevel('support', 3)).toContain('smoke');
  });

  it('buildSoldierAtLevel scales stats', () => {
    const l1 = buildSoldierAtLevel('heavy', 'p_heavy', 'FLOOD', 1);
    const l4 = buildSoldierAtLevel('heavy', 'p_heavy', 'FLOOD', 4);
    expect(l4.maxHp).toBeGreaterThan(l1.maxHp);
    expect(l4.aim).toBeGreaterThanOrEqual(l1.aim);
    expect(l4.armor).toBeGreaterThanOrEqual(l1.armor); // milestone armor at 4
  });
});

describe('kill and mission XP', () => {
  it('values scale by enemy tier', () => {
    expect(killXp('drone')).toBeLessThan(killXp('pmc'));
    expect(killXp('pmc')).toBeLessThan(killXp('mech'));
  });

  it('victory pays more than defeat', () => {
    expect(missionBonusXp(true, 'hostiles_eliminated')).toBeGreaterThan(
      missionBonusXp(false, 'squad_wiped'),
    );
  });
});

describe('grantXp on units', () => {
  it('levels a unit and raises maxHp', () => {
    const state = createMission(1, 'normal', {
      roster: defaultRoster(),
      gateAbilities: true,
    });
    const u = state.units.get('p_breach')!;
    expect(u.level).toBe(1);
    const need = xpToNextLevel(1);
    const r = grantXp(u, need, { gateAbilities: true });
    expect(r.leveled).toBe(true);
    expect(u.level).toBe(2);
    expect(u.def.abilities).toContain('breach');
  });
});

describe('mission with roster', () => {
  it('spawns gated L1 squad when roster is empty', () => {
    const state = createMission(1, 'normal', {
      roster: defaultRoster(),
      gateAbilities: true,
    });
    const heavy = state.units.get('p_heavy')!;
    expect(heavy.level).toBe(1);
    expect(heavy.def.abilities).not.toContain('grenade');
    expect(heavy.def.abilities).toContain('shoot');
  });

  it('awards kill XP through Game.performShot', () => {
    const game = new Game(
      createMission(1, 'normal', {
        roster: defaultRoster(),
        gateAbilities: true,
      }),
    );
    game.startMission();
    const atk = game.state.units.get('p_mark')!;
    const def = game.state.units.get('e_drone1')!;
    def.activated = true;
    atk.pos = { x: 12, y: 10 };
    def.pos = { x: 12, y: 9 };
    def.hp = 1;
    atk.ap = 2;
    // Force hit via debug
    game.debug.alwaysHit = true;
    const before = atk.xp;
    game.tryShoot(atk.id, def.id);
    expect(atk.xp).toBeGreaterThan(before);
    expect(game.state.log.some((e) => e.type === 'xp')).toBe(true);
  });
});

describe('wounds and debrief', () => {
  it('applyWoundDebuffs lowers INT, ACC, mobility', () => {
    const base = buildSoldierAtLevel('breacher', 'p_breach', 'WEDGE', 1);
    const w = applyWoundDebuffs(base);
    expect(w.maxHp).toBe(base.maxHp - 1);
    expect(w.aim).toBe(base.aim - 12);
    expect(w.mobility).toBe(base.mobility - 1);
  });

  it('crash sets wounded; survive clears it', () => {
    const roster = defaultRoster();
    const state = createMission(1, 'normal', { roster, gateAbilities: true });
    const u = state.units.get('p_breach')!;
    u.alive = false;
    u.hp = 0;
    const wounded = applyPostMissionWounds(roster, state.units.values());
    expect(wounded.operatives.find((o) => o.id === 'p_breach')!.wounded).toBe(true);

    u.alive = true;
    u.hp = 1;
    const healed = applyPostMissionWounds(wounded, state.units.values());
    expect(healed.operatives.find((o) => o.id === 'p_breach')!.wounded).toBe(false);
  });

  it('createMission applies wound debuffs from roster', () => {
    const roster = defaultRoster();
    roster.operatives[0]!.wounded = true; // WEDGE
    const state = createMission(1, 'normal', { roster, gateAbilities: true });
    const u = state.units.get('p_breach')!;
    expect(u.wounded).toBe(true);
    const healthy = buildSoldierAtLevel('breacher', 'p_breach', 'WEDGE', 1);
    expect(u.def.maxHp).toBe(healthy.maxHp - 1);
    expect(u.def.aim).toBe(healthy.aim - 12);
  });

  it('debriefGrade rewards speed and full squad', () => {
    expect(
      debriefGrade({
        victory: true,
        turns: 6,
        squadAlive: 4,
        squadTotal: 4,
        reason: 'data_port',
      }),
    ).toBe('S');
    expect(
      debriefGrade({
        victory: false,
        turns: 3,
        squadAlive: 0,
        squadTotal: 4,
        reason: 'squad_wiped',
      }),
    ).toBe('F');
  });
});

describe('deadline mission type', () => {
  it('sets turn limit for deadline missions', () => {
    const state = createMission(1, 'normal', {
      mapId: 'vesper',
      missionType: 'deadline',
    });
    expect(state.missionType).toBe('deadline');
    expect(state.turnLimit).toBe(12);
  });

  it('standard has no turn limit', () => {
    const state = createMission(1, 'normal', { missionType: 'standard' });
    expect(state.missionType).toBe('standard');
    expect(state.turnLimit).toBeNull();
  });

  it('fails when cycles pass the deadline', () => {
    const game = new Game(
      createMission(1, 'normal', {
        mapId: 'training',
        missionType: 'deadline',
        turnLimit: 2,
      }),
    );
    game.startMission();
    expect(game.state.turn).toBe(1);
    game.endPlayerTurn();
    game.endEnemyTurn(); // turn → 2
    expect(game.state.turn).toBe(2);
    expect(game.isMissionOver()).toBe(false);
    game.endPlayerTurn();
    game.endEnemyTurn(); // turn → 3 > 2
    expect(game.state.phase).toBe('defeat');
    const end = game.state.log.find((e) => e.type === 'missionEnd');
    expect(end?.payload.reason).toBe('deadline');
  });
});

describe('map layouts', () => {
  it('defaults to vesper with classic squad spawn', () => {
    const state = createMission(1, 'normal');
    expect(state.mapId).toBe('vesper');
    expect(state.units.get('p_breach')!.pos).toEqual({ x: 11, y: 21 });
    expect(state.units.has('e_mech1')).toBe(true);
  });

  it('training is smaller with fewer hostiles', () => {
    const state = createMission(1, 'normal', { mapId: 'training' });
    expect(state.mapId).toBe('training');
    expect(state.width).toBeLessThan(28);
    expect(state.height).toBeLessThan(24);
    const hostiles = [...state.units.values()].filter((u) => u.def.team === 'enemy');
    expect(hostiles.length).toBeLessThan(7);
    expect(state.pods.size).toBe(2);
    for (const u of state.units.values()) {
      const t = state.tiles[u.pos.y]![u.pos.x]!;
      expect(t.walkable).toBe(true);
      expect(t.blocked).toBe(false);
    }
  });

  it('kernel is larger with more pods and dual mechs', () => {
    const state = createMission(1, 'normal', { mapId: 'kernel' });
    expect(state.mapId).toBe('kernel');
    expect(state.width).toBeGreaterThanOrEqual(28);
    expect(state.pods.size).toBeGreaterThanOrEqual(4);
    expect(state.units.has('e_mech1')).toBe(true);
    expect(state.units.has('e_mech2')).toBe(true);
    for (const u of state.units.values()) {
      const t = state.tiles[u.pos.y]![u.pos.x]!;
      expect(t.walkable).toBe(true);
      expect(t.blocked).toBe(false);
    }
    expect(state.dataPortTiles.length).toBeGreaterThan(0);
  });

  it('kernel stealth branch is lighter than loud', () => {
    const stealth = createMission(1, 'normal', {
      mapId: 'kernel',
      kernelBranch: 'stealth',
    });
    const loud = createMission(1, 'normal', {
      mapId: 'kernel',
      kernelBranch: 'loud',
    });
    const count = (s: typeof stealth) =>
      [...s.units.values()].filter((u) => u.def.team === 'enemy').length;
    expect(count(stealth)).toBeLessThan(count(loud));
    expect(stealth.units.has('e_mech2')).toBe(false);
    expect(stealth.pods.has('podE')).toBe(false);
    expect(loud.units.has('e_mech2')).toBe(true);
    expect(loud.pods.has('podF')).toBe(true);
  });
});

describe('death does not clear XP', () => {
  it('keeps lifetime XP on the unit when a probe crashes', () => {
    const game = new Game(
      createMission(1, 'normal', {
        roster: defaultRoster(),
        gateAbilities: true,
      }),
    );
    game.startMission();
    const u = game.state.units.get('p_breach')!;
    grantXp(u, 200, { gateAbilities: true });
    const xpBefore = u.xp;
    const levelBefore = u.level;
    expect(xpBefore).toBeGreaterThan(0);
    expect(levelBefore).toBeGreaterThan(1);

    // Enemy finishes the probe via normal combat path
    const enemy = game.state.units.get('e_pmc1')!;
    enemy.activated = true;
    enemy.ap = 2;
    enemy.pos = { x: 11, y: 12 };
    u.pos = { x: 11, y: 11 };
    u.hp = 1;
    game.debug.alwaysHit = true;
    // alwaysHit only forces player shots — deal lethal damage directly then resolve through performShot path
    // by setting enemy damage high enough via hp=1 + normal resolve
    game.tryEnemyShoot(enemy.id, u.id);
    // If RNG missed, force crash state while asserting XP fields untouched by death itself
    if (u.alive) {
      u.hp = 0;
      u.alive = false;
    }

    expect(u.alive).toBe(false);
    expect(u.xp).toBe(xpBefore);
    expect(u.level).toBe(levelBefore);
  });

  it('rosterFromUnits keeps dead probe XP and never decreases totals', () => {
    const game = new Game(
      createMission(1, 'normal', {
        roster: {
          version: 1,
          operatives: [
            { id: 'p_breach', name: 'WEDGE', classId: 'breacher', xp: 150, wounded: false },
            { id: 'p_mark', name: 'SEEK', classId: 'marksman', xp: 80, wounded: false },
            { id: 'p_sup', name: 'PATCHD', classId: 'support', xp: 0, wounded: false },
            { id: 'p_heavy', name: 'FLOOD', classId: 'heavy', xp: 40, wounded: false },
          ],
        },
        gateAbilities: true,
      }),
    );
    const u = game.state.units.get('p_breach')!;
    expect(u.xp).toBe(150);
    u.alive = false;
    u.hp = 0;

    const prev = {
      version: 1 as const,
      operatives: [
        { id: 'p_breach', name: 'WEDGE', classId: 'breacher' as const, xp: 150, wounded: false },
        { id: 'p_mark', name: 'SEEK', classId: 'marksman' as const, xp: 80, wounded: false },
        { id: 'p_sup', name: 'PATCHD', classId: 'support' as const, xp: 0, wounded: false },
        { id: 'p_heavy', name: 'FLOOD', classId: 'heavy' as const, xp: 40, wounded: false },
      ],
    };
    const next = rosterFromUnits(game.state.units.values(), prev);
    const row = next.operatives.find((o) => o.id === 'p_breach')!;
    expect(row.xp).toBe(150);

    // Even if live state glitched to 0, prior save wins
    u.xp = 0;
    const protectedRoster = rosterFromUnits(game.state.units.values(), prev);
    expect(protectedRoster.operatives.find((o) => o.id === 'p_breach')!.xp).toBe(150);
  });

  it('dead probe still banks half mission XP and keeps prior total', () => {
    const game = new Game(
      createMission(1, 'normal', {
        roster: defaultRoster(),
        gateAbilities: true,
      }),
    );
    game.startMission();
    const u = game.state.units.get('p_sup')!;
    grantXp(u, 100, { gateAbilities: true });
    const before = u.xp;
    u.alive = false;
    u.hp = 0;
    game.awardMissionXp(true, 'hostiles_eliminated');
    expect(u.xp).toBeGreaterThan(before);
    expect(u.alive).toBe(false);
    expect(u.hp).toBe(0);
  });

  it('next mission loads dead-probe XP from roster', () => {
    const roster = {
      version: 1 as const,
      operatives: [
        { id: 'p_breach', name: 'WEDGE', classId: 'breacher' as const, xp: 200, wounded: false },
        { id: 'p_mark', name: 'SEEK', classId: 'marksman' as const, xp: 0, wounded: false },
        { id: 'p_sup', name: 'PATCHD', classId: 'support' as const, xp: 0, wounded: false },
        { id: 'p_heavy', name: 'FLOOD', classId: 'heavy' as const, xp: 0, wounded: false },
      ],
    };
    const state = createMission(9, 'normal', { roster, gateAbilities: true });
    const u = state.units.get('p_breach')!;
    expect(u.xp).toBe(200);
    expect(u.level).toBe(levelFromXp(200));
    expect(u.alive).toBe(true);
    expect(u.hp).toBe(u.def.maxHp);
  });
});
