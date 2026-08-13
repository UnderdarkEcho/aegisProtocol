import { describe, expect, it } from 'vitest';
import { makeSoldier } from '../content/classes';
import {
  applyLoadoutToDef,
  applyLoadoutToUnit,
  defaultLoadout,
  earnCred,
  nextUpgradeCost,
  tryBuyUpgrade,
} from './loadout';

describe('loadout shop', () => {
  it('purchases spend cred and raise tiers', () => {
    let s = defaultLoadout();
    s = { ...s, cred: 200 };
    const r = tryBuyUpgrade(s, 'inject');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.inject).toBe(1);
    expect(r.state.cred).toBe(200 - 80);
    expect(nextUpgradeCost(r.state, 'inject')).toBe(140);
  });

  it('rejects when broke or maxed', () => {
    expect(tryBuyUpgrade(defaultLoadout(), 'inject').ok).toBe(false);
    let s = { ...defaultLoadout(), cred: 999, inject: 2 };
    expect(tryBuyUpgrade(s, 'inject').ok).toBe(false);
  });

  it('applyLoadoutToDef boosts damage and armor', () => {
    const base = makeSoldier('breacher', 'p_breach', 'WEDGE');
    const loadout = { ...defaultLoadout(), inject: 2, armor: 1 };
    const d = applyLoadoutToDef(base, loadout);
    expect(d.weapon.damageMin).toBe(base.weapon.damageMin + 2);
    expect(d.weapon.damageMax).toBe(base.weapon.damageMax + 2);
    expect(d.armor).toBe(base.armor + 1);
  });

  it('applyLoadoutToUnit adds max CYC', () => {
    const def = makeSoldier('support', 'p_sup', 'PATCHD');
    const u = {
      def,
      id: def.id,
      pos: { x: 0, y: 0 },
      hp: def.maxHp,
      ap: 2,
      maxAp: 2,
      alive: true,
      overwatching: false,
      suppressed: false,
      inSmoke: false,
      hunkered: false,
      podId: null,
      activated: true,
      cooldowns: {},
      level: 1,
      xp: 0,
      missionXp: 0,
      wounded: false,
    };
    applyLoadoutToUnit(u, { ...defaultLoadout(), cycle: 1 });
    expect(u.maxAp).toBe(3);
    expect(u.ap).toBe(3);
  });

  it('earnCred pays more for S-grade victory', () => {
    const s = earnCred({
      victory: true,
      grade: 'S',
      enemyKills: 5,
      reason: 'data_port',
    });
    const f = earnCred({
      victory: false,
      grade: 'F',
      enemyKills: 1,
      reason: 'squad_wiped',
    });
    expect(s).toBeGreaterThan(f);
  });
});
