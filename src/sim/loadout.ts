/**
 * Squad loadout shop — spend CRED on gear that applies to the whole probe team.
 * Cred is separate from XP so levels stay intact.
 */

import type { UnitDef, UnitState } from './types';

export type UpgradeId = 'inject' | 'armor' | 'cycle';

export interface LoadoutState {
  version: 1;
  /** Spendable currency (earned from missions). */
  cred: number;
  /** Payload damage tiers 0–2 (+1 min/max dmg each). */
  inject: number;
  /** Armor chip tiers 0–2 (+1 SHD each). */
  armor: number;
  /** Cycle cell 0–1 (+1 max CYC on deploy). */
  cycle: number;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  blurb: string;
  max: number;
  /** Cost for next level (index 0 = first purchase). */
  costs: number[];
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  inject: {
    id: 'inject',
    name: 'inject.kit',
    blurb: '+1 payload damage (min & max) per tier. Stacks twice.',
    max: 2,
    costs: [80, 140],
  },
  armor: {
    id: 'armor',
    name: 'armor.chip',
    blurb: '+1 SHD (shield) per tier. Stacks twice.',
    max: 2,
    costs: [90, 160],
  },
  cycle: {
    id: 'cycle',
    name: 'cycle.cell',
    blurb: '+1 max CYC on every deploy. One purchase.',
    max: 1,
    costs: [120],
  },
};

/** Clear all wound flags — one-shot shop action. */
export const MEDKIT = {
  id: 'medkit' as const,
  name: 'patch.bay',
  blurb: 'Clear all probe wound flags. One-shot spend.',
  cost: 70,
};

export function defaultLoadout(): LoadoutState {
  return { version: 1, cred: 0, inject: 0, armor: 0, cycle: 0 };
}

export function sanitizeLoadout(raw: unknown): LoadoutState {
  const d = defaultLoadout();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Partial<LoadoutState>;
  if (o.version !== 1) return d;
  const clamp = (n: unknown, max: number) => {
    const v = Math.floor(Number(n) || 0);
    if (!Number.isFinite(v) || v < 0) return 0;
    return Math.min(max, v);
  };
  return {
    version: 1,
    cred: clamp(o.cred, 99999),
    inject: clamp(o.inject, UPGRADES.inject.max),
    armor: clamp(o.armor, UPGRADES.armor.max),
    cycle: clamp(o.cycle, UPGRADES.cycle.max),
  };
}

export function nextUpgradeCost(state: LoadoutState, id: UpgradeId): number | null {
  const def = UPGRADES[id];
  const tier = state[id];
  if (tier >= def.max) return null;
  return def.costs[tier] ?? null;
}

export function tryBuyUpgrade(
  state: LoadoutState,
  id: UpgradeId,
): { ok: true; state: LoadoutState } | { ok: false; reason: string } {
  const cost = nextUpgradeCost(state, id);
  if (cost == null) return { ok: false, reason: 'MAXED' };
  if (state.cred < cost) return { ok: false, reason: 'NEED CRED' };
  return {
    ok: true,
    state: {
      ...state,
      cred: state.cred - cost,
      [id]: state[id] + 1,
    },
  };
}

/** Cred earned at mission end (before shop). */
export function earnCred(opts: {
  victory: boolean;
  grade: string;
  enemyKills: number;
  reason: string;
}): number {
  let n = opts.victory ? 35 : 12;
  n += Math.min(40, opts.enemyKills * 3);
  if (opts.victory) {
    if (opts.grade === 'S') n += 40;
    else if (opts.grade === 'A') n += 25;
    else if (opts.grade === 'B') n += 12;
    else if (opts.grade === 'C') n += 5;
    if (opts.reason === 'data_port') n += 10;
  }
  return Math.max(0, Math.floor(n));
}

/** Apply permanent shop gear to a soldier definition. */
export function applyLoadoutToDef(def: UnitDef, loadout: LoadoutState): UnitDef {
  if (loadout.inject <= 0 && loadout.armor <= 0) return def;
  const weapon = {
    ...def.weapon,
    damageMin: def.weapon.damageMin + loadout.inject,
    damageMax: def.weapon.damageMax + loadout.inject,
  };
  return {
    ...def,
    armor: def.armor + loadout.armor,
    weapon,
  };
}

/** Apply cycle.cell to unit AP pool after spawn. */
export function applyLoadoutToUnit(u: UnitState, loadout: LoadoutState): void {
  if (loadout.cycle <= 0 || u.def.team !== 'player') return;
  u.maxAp = 2 + loadout.cycle;
  u.ap = u.maxAp;
}
