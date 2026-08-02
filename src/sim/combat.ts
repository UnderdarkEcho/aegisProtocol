import { getDefensiveCover, rangeModifier, shotDistance } from './cover';
import { chance, rollInt } from './rng';
import type {
  MissionState,
  ShotPreview,
  ShotResult,
  UnitState,
  Vec2,
} from './types';

export function previewShot(
  state: MissionState,
  attacker: UnitState,
  defender: UnitState,
): ShotPreview {
  const dist = shotDistance(attacker.pos, defender.pos);
  const cover = getDefensiveCover(state, defender, attacker.pos);
  const rangeMod = rangeModifier(dist, attacker.def.weapon.range);

  let aim = attacker.def.aim;
  if (attacker.suppressed) aim -= 15;
  if (attacker.inSmoke) aim -= 10;

  let defense = defender.def.defense;
  if (defender.inSmoke) defense += 20;

  // Hunker doubles cover bonus; small prone bonus when exposed. Never mutates def.
  let coverPenalty = cover.penalty;
  if (defender.hunkered) {
    if (cover.level > 0 && !cover.flanked) {
      coverPenalty = cover.penalty * 2;
    } else {
      defense += 10;
    }
  }

  let hit =
    aim -
    defense +
    rangeMod -
    coverPenalty +
    (cover.flanked ? 15 : 0);

  // Class perks
  if (attacker.def.classId === 'breacher' && dist <= 3) hit += 15;
  if (attacker.def.classId === 'marksman' && dist >= 6) hit += 10;

  hit = clamp(Math.round(hit), 1, 99);

  let crit = attacker.def.weapon.critChance + (cover.flanked ? 25 : 0);
  if (attacker.def.classId === 'marksman') crit += 5;
  crit = clamp(crit, 0, 100);

  return {
    hitChance: hit,
    critChance: crit,
    damageMin: attacker.def.weapon.damageMin,
    damageMax: attacker.def.weapon.damageMax,
    flanked: cover.flanked,
    coverPenalty,
    rangeMod,
    reason: cover.flanked
      ? 'FLANK'
      : cover.level === 2
        ? defender.hunkered
          ? 'FULL COVER (HUNKER)'
          : 'FULL COVER'
        : cover.level === 1
          ? defender.hunkered
            ? 'HALF COVER (HUNKER)'
            : 'HALF COVER'
          : defender.hunkered
            ? 'HUNKERED'
            : 'EXPOSED',
  };
}

export function resolveShot(
  state: MissionState,
  attacker: UnitState,
  defender: UnitState,
  rng: () => number,
): ShotResult {
  const preview = previewShot(state, attacker, defender);
  const hit = chance(rng, preview.hitChance);
  if (!hit) {
    return { hit: false, crit: false, damage: 0, killed: false, graze: false };
  }

  const crit = chance(rng, preview.critChance);
  let dmg = rollInt(
    rng,
    attacker.def.weapon.damageMin,
    attacker.def.weapon.damageMax,
  );
  if (crit) dmg = Math.ceil(dmg * 1.5);
  dmg = Math.max(1, dmg - defender.def.armor);

  return {
    hit: true,
    crit,
    damage: dmg,
    killed: defender.hp - dmg <= 0,
    graze: false,
  };
}

export function grenadeDamageAt(
  center: Vec2,
  target: Vec2,
  rng: () => number,
): number {
  const d = shotDistance(center, target);
  if (d > 2.1) return 0;
  if (d <= 0.1) return rollInt(rng, 4, 6);
  if (d <= 1.5) return rollInt(rng, 3, 5);
  return rollInt(rng, 2, 3);
}

export function canShoot(
  _state: MissionState,
  attacker: UnitState,
  defender: UnitState,
  hasLos: boolean,
): boolean {
  if (!attacker.alive || !defender.alive) return false;
  if (attacker.ap < 1) return false;
  if (attacker.def.team === defender.def.team) return false;
  const dist = shotDistance(attacker.pos, defender.pos);
  if (dist > attacker.def.weapon.range + 0.5) return false;
  return hasLos;
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}
