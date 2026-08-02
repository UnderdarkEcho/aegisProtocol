/**
 * Probe team progression — XP, levels, stat growth, ability unlocks.
 * Fiction: process privilege escalates as the probe learns the die.
 */

import { makeSoldier } from '../content/classes';
import type { AbilityId, UnitClass, UnitDef, UnitState } from './types';

export const MAX_LEVEL = 6;

/** Fixed squad slots for the mini-game. */
export const SQUAD_TEMPLATE: ReadonlyArray<{
  id: string;
  name: string;
  classId: Extract<UnitClass, 'breacher' | 'marksman' | 'support' | 'heavy'>;
}> = [
  { id: 'p_breach', name: 'REYES', classId: 'breacher' },
  { id: 'p_mark', name: 'CHEN', classId: 'marksman' },
  { id: 'p_sup', name: 'OKAFOR', classId: 'support' },
  { id: 'p_heavy', name: 'VOLKOV', classId: 'heavy' },
];

export type PlayerClassId = (typeof SQUAD_TEMPLATE)[number]['classId'];

export interface OperativeProgress {
  id: string;
  name: string;
  classId: PlayerClassId;
  /** Lifetime XP (persists across breaches) */
  xp: number;
  /**
   * Crashed last mission — deploys injured next breach (−INT, −ACC, −mobility).
   * Cleared if they finish a mission alive.
   */
  wounded: boolean;
}

export interface SquadRoster {
  version: 1;
  operatives: OperativeProgress[];
}

/** Stat penalties while deploying wounded from a prior crash. */
export const WOUND_PENALTIES = {
  maxHp: 1,
  aim: 12,
  mobility: 1,
} as const;

/** Apply wound debuffs to a soldier def (returns new object). */
export function applyWoundDebuffs(def: UnitDef): UnitDef {
  return {
    ...def,
    maxHp: Math.max(1, def.maxHp - WOUND_PENALTIES.maxHp),
    aim: Math.max(1, Math.min(99, def.aim - WOUND_PENALTIES.aim)),
    mobility: Math.max(1, def.mobility - WOUND_PENALTIES.mobility),
  };
}

/** XP granted when this enemy class is killed by a player. */
export function killXp(classId: UnitClass): number {
  switch (classId) {
    case 'drone':
      return 25;
    case 'pmc':
      return 40;
    case 'mech':
      return 80;
    default:
      return 20;
  }
}

/** Mission-end XP for a *living* probe. Dead probes still bank half (see awardMissionXp). */
export function missionBonusXp(victory: boolean, reason: string): number {
  if (!victory) return 10; // participation scrap
  if (reason === 'data_port') return 60;
  if (reason === 'hostiles_eliminated') return 75;
  return 50;
}

/** Safe non-negative integer XP (NaN/null never wipe a roster on save/load). */
export function sanitizeXp(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

/**
 * XP needed to advance from `level` → `level+1`.
 * Curve: 80, 120, 180, 260, 360  (sum ~1000 to hit max).
 */
export function xpToNextLevel(level: number): number {
  if (level < 1 || level >= MAX_LEVEL) return 0;
  return 40 + level * 40 + (level - 1) * 20;
}

/** Total XP required to *reach* a given level (level 1 = 0). */
export function totalXpForLevel(level: number): number {
  let sum = 0;
  for (let l = 1; l < level && l < MAX_LEVEL; l++) {
    sum += xpToNextLevel(l);
  }
  return sum;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  let remaining = Math.max(0, xp);
  while (level < MAX_LEVEL) {
    const need = xpToNextLevel(level);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  return level;
}

/** Progress within current level: { current, need, pct }. */
export function xpBar(xp: number): { level: number; current: number; need: number; pct: number } {
  const level = levelFromXp(xp);
  if (level >= MAX_LEVEL) {
    return { level: MAX_LEVEL, current: 0, need: 0, pct: 100 };
  }
  const into = xp - totalXpForLevel(level);
  const need = xpToNextLevel(level);
  return {
    level,
    current: into,
    need,
    pct: need > 0 ? Math.min(100, Math.floor((into / need) * 100)) : 100,
  };
}

/** Ability unlocks by class — L1 is always online; higher levels escalate privilege. */
const UNLOCKS: Record<PlayerClassId, Partial<Record<number, AbilityId[]>>> = {
  breacher: {
    1: ['move', 'shoot', 'overwatch'],
    2: ['breach'],
    3: ['grenade'],
  },
  marksman: {
    1: ['move', 'shoot', 'overwatch'],
    2: ['hunker'],
    3: ['suppress'], // long-range throttle at mid rank
  },
  support: {
    1: ['move', 'shoot', 'overwatch'],
    2: ['heal'],
    3: ['smoke'],
  },
  heavy: {
    1: ['move', 'shoot', 'overwatch'],
    2: ['suppress'],
    3: ['grenade'],
  },
};

/** Per-level growth after L1 (applied level-1 times). */
const GROWTH: Record<
  PlayerClassId,
  { maxHp: number; aim: number; defense: number; armor: number; mobility: number; dmg: number }
> = {
  breacher: { maxHp: 1, aim: 2, defense: 1, armor: 0, mobility: 0, dmg: 0 },
  marksman: { maxHp: 0, aim: 3, defense: 0, armor: 0, mobility: 0, dmg: 1 },
  support: { maxHp: 1, aim: 1, defense: 1, armor: 0, mobility: 0, dmg: 0 },
  heavy: { maxHp: 1, aim: 1, defense: 0, armor: 0, mobility: 0, dmg: 1 },
};

/** Extra flat bonuses at milestone levels. */
function milestoneBonus(
  classId: PlayerClassId,
  level: number,
): Partial<{ maxHp: number; aim: number; armor: number; defense: number; mobility: number }> {
  const b: Partial<{ maxHp: number; aim: number; armor: number; defense: number; mobility: number }> =
    {};
  if (level >= 4) {
    if (classId === 'heavy') b.armor = 1;
    if (classId === 'breacher') b.mobility = 1;
    if (classId === 'marksman') b.aim = 5;
    if (classId === 'support') b.defense = 5;
  }
  if (level >= 6) {
    b.maxHp = (b.maxHp ?? 0) + 1;
    b.aim = (b.aim ?? 0) + 2;
  }
  return b;
}

export function abilitiesAtLevel(classId: PlayerClassId, level: number): AbilityId[] {
  const table = UNLOCKS[classId];
  const set = new Set<AbilityId>();
  for (let l = 1; l <= level; l++) {
    for (const a of table[l] ?? []) set.add(a);
  }
  return [...set];
}

/** Abilities newly unlocked when reaching `level` (empty if none). */
export function abilitiesUnlockedAt(classId: PlayerClassId, level: number): AbilityId[] {
  return [...(UNLOCKS[classId][level] ?? [])];
}

/**
 * Build a soldier def at a given privilege level.
 * @param gateAbilities when false, keep full class kit (tests / unconstrained).
 */
export function buildSoldierAtLevel(
  classId: PlayerClassId,
  id: string,
  name: string,
  level: number,
  opts: { gateAbilities?: boolean } = {},
): UnitDef {
  const lv = Math.max(1, Math.min(MAX_LEVEL, level));
  const base = makeSoldier(classId, id, name);
  const steps = lv - 1;
  const g = GROWTH[classId];
  const m = milestoneBonus(classId, lv);

  const maxHp = base.maxHp + g.maxHp * steps + (m.maxHp ?? 0);
  const aim = Math.min(99, base.aim + g.aim * steps + (m.aim ?? 0));
  const defense = Math.max(0, base.defense + g.defense * steps + (m.defense ?? 0));
  const armor = Math.max(0, base.armor + g.armor * steps + (m.armor ?? 0));
  const mobility = Math.max(1, base.mobility + g.mobility * steps + (m.mobility ?? 0));
  const weapon = {
    ...base.weapon,
    damageMin: Math.max(1, base.weapon.damageMin + g.dmg * steps),
    damageMax: Math.max(1, base.weapon.damageMax + g.dmg * steps),
  };

  const gate = opts.gateAbilities !== false;
  const abilities = gate ? abilitiesAtLevel(classId, lv) : base.abilities;

  return {
    ...base,
    maxHp,
    aim,
    defense,
    armor,
    mobility,
    weapon,
    abilities,
  };
}

export function defaultRoster(): SquadRoster {
  return {
    version: 1,
    operatives: SQUAD_TEMPLATE.map((s) => ({
      id: s.id,
      name: s.name,
      classId: s.classId,
      xp: 0,
      wounded: false,
    })),
  };
}

export function createDefaultUnitProgress(): { level: number; xp: number; missionXp: number } {
  return { level: 1, xp: 0, missionXp: 0 };
}

/**
 * Grant XP to a unit; apply level-ups immediately (stats/abilities).
 * Dead probes still bank XP — death never clears lifetime privilege.
 * Returns levels gained and any newly unlocked ability ids.
 */
export function grantXp(
  u: UnitState,
  amount: number,
  opts: { gateAbilities?: boolean } = {},
): { gained: number; levelsGained: number; newAbilities: AbilityId[]; leveled: boolean } {
  if (amount <= 0 || u.def.team !== 'player') {
    return { gained: 0, levelsGained: 0, newAbilities: [], leveled: false };
  }
  const classId = u.def.classId as PlayerClassId;
  if (!isPlayerClass(classId)) {
    return { gained: 0, levelsGained: 0, newAbilities: [], leveled: false };
  }

  // Coerce first — undefined/NaN + n => NaN would wipe roster on next save
  u.xp = sanitizeXp(u.xp);
  u.missionXp = sanitizeXp(u.missionXp);
  u.level = Math.max(1, Math.min(MAX_LEVEL, sanitizeXp(u.level) || 1));

  const before = u.level;
  const gained = sanitizeXp(amount);
  if (gained <= 0) {
    return { gained: 0, levelsGained: 0, newAbilities: [], leveled: false };
  }
  u.xp += gained;
  u.missionXp += gained;
  const after = levelFromXp(u.xp);
  const newAbilities: AbilityId[] = [];

  if (after > before) {
    for (let l = before + 1; l <= after; l++) {
      newAbilities.push(...abilitiesUnlockedAt(classId, l));
    }
    const oldMax = u.def.maxHp;
    const wasAlive = u.alive;
    const hpRatio = wasAlive && oldMax > 0 ? u.hp / oldMax : 0;
    u.def = buildSoldierAtLevel(classId, u.def.id, u.def.name, after, opts);
    if (u.wounded) u.def = applyWoundDebuffs(u.def);
    u.level = after;
    if (wasAlive) {
      // Keep relative integrity; grant full bonus HP from the level-up
      const hpGain = u.def.maxHp - oldMax;
      u.hp = Math.min(u.def.maxHp, Math.ceil(hpRatio * oldMax) + Math.max(0, hpGain));
    } else {
      // Stay crashed — XP/level bank for next breach, no free revive
      u.hp = 0;
      u.alive = false;
    }
  }

  return {
    gained,
    levelsGained: after - before,
    newAbilities,
    leveled: after > before,
  };
}

export function isPlayerClass(c: UnitClass): c is PlayerClassId {
  return c === 'breacher' || c === 'marksman' || c === 'support' || c === 'heavy';
}

/**
 * Sync roster XP from unit states (including dead probes).
 * Lifetime XP never decreases: death / mid-run glitches cannot wipe a higher saved total.
 * Does not change wounded flags — use applyPostMissionWounds at mission end.
 */
export function rosterFromUnits(
  units: Iterable<UnitState>,
  prev: SquadRoster,
): SquadRoster {
  const byId = new Map(
    prev.operatives.map((o) => [
      o.id,
      {
        ...o,
        xp: sanitizeXp(o.xp),
        wounded: Boolean(o.wounded),
      } satisfies OperativeProgress,
    ]),
  );
  for (const u of units) {
    if (u.def.team !== 'player' || !isPlayerClass(u.def.classId)) continue;
    const unitXp = sanitizeXp(u.xp);
    const row = byId.get(u.id);
    if (row) {
      // Keep the best of live state vs prior save — dead unit still contributes its banked XP
      row.xp = Math.max(row.xp, unitXp);
      row.name = u.def.name;
    } else {
      byId.set(u.id, {
        id: u.id,
        name: u.def.name,
        classId: u.def.classId,
        xp: unitXp,
        wounded: false,
      });
    }
  }
  return {
    version: 1,
    operatives: SQUAD_TEMPLATE.map(
      (t) =>
        byId.get(t.id) ?? {
          id: t.id,
          name: t.name,
          classId: t.classId,
          xp: 0,
          wounded: false,
        },
    ),
  };
}

/**
 * After a mission: crash → wounded for next deploy; survive → healed.
 */
export function applyPostMissionWounds(
  roster: SquadRoster,
  units: Iterable<UnitState>,
): SquadRoster {
  const byId = new Map(roster.operatives.map((o) => [o.id, { ...o }]));
  for (const u of units) {
    if (u.def.team !== 'player' || !isPlayerClass(u.def.classId)) continue;
    const row = byId.get(u.id);
    if (!row) continue;
    if (!u.alive) row.wounded = true;
    else row.wounded = false;
  }
  return {
    version: 1,
    operatives: SQUAD_TEMPLATE.map(
      (t) =>
        byId.get(t.id) ?? {
          id: t.id,
          name: t.name,
          classId: t.classId,
          xp: 0,
          wounded: false,
        },
    ),
  };
}

/** Debrief letter grade for a finished breach. */
export function debriefGrade(opts: {
  victory: boolean;
  turns: number;
  squadAlive: number;
  squadTotal: number;
  reason: string;
}): 'S' | 'A' | 'B' | 'C' | 'F' {
  if (!opts.victory) return 'F';
  let score = 0;
  if (opts.squadAlive >= opts.squadTotal) score += 2;
  else if (opts.squadAlive >= opts.squadTotal - 1) score += 1;
  if (opts.turns <= 8) score += 2;
  else if (opts.turns <= 12) score += 1;
  else if (opts.turns <= 16) score += 0;
  else score -= 1;
  if (opts.reason === 'data_port') score += 1;
  if (score >= 5) return 'S';
  if (score >= 3) return 'A';
  if (score >= 2) return 'B';
  return 'C';
}
