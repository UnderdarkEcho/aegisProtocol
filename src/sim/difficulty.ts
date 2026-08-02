/** Mission difficulty — selected on briefing, scales enemy AI + stats. */

import type { DifficultyId } from './types';

export type { DifficultyId };

export interface DifficultyProfile {
  id: DifficultyId;
  label: string;
  blurb: string;
  /** Min hit% for enemies to open fire before moving */
  shotThreshold: number;
  /** Min hit% for a second shot after moving */
  postMoveShotThreshold: number;
  /** Allow grenade use against clumps */
  grenadeEnabled: boolean;
  /** Players that must be in blast to grenade */
  grenadeMinHits: number;
  /** Scoring weights for movement AI */
  coverFullBonus: number;
  coverHalfBonus: number;
  flankMoveBonus: number;
  hitChanceMoveWeight: number;
  /** Flat modifiers applied to enemy unit defs at mission start */
  aimBonus: number;
  defenseBonus: number;
  hpBonus: number;
  armorBonus: number;
  damageBonus: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyProfile> = {
  easy: {
    id: 'easy',
    label: 'SANDBOX',
    blurb: 'Legacy wardens — hesitant injects, weak ACC, no cascade.sys',
    shotThreshold: 60,
    postMoveShotThreshold: 50,
    grenadeEnabled: false,
    grenadeMinHits: 99,
    coverFullBonus: 30,
    coverHalfBonus: 18,
    flankMoveBonus: 4,
    hitChanceMoveWeight: 0.08,
    aimBonus: -12,
    defenseBonus: -5,
    hpBonus: -1,
    armorBonus: 0,
    damageBonus: 0,
  },
  normal: {
    id: 'normal',
    label: 'LIVE NET',
    blurb: 'Corporate ICE — cover, cascade.sys, standard ACC',
    shotThreshold: 45,
    postMoveShotThreshold: 1,
    grenadeEnabled: true,
    grenadeMinHits: 2,
    coverFullBonus: 45,
    coverHalfBonus: 30,
    flankMoveBonus: 12,
    hitChanceMoveWeight: 0.15,
    aimBonus: 0,
    defenseBonus: 0,
    hpBonus: 0,
    armorBonus: 0,
    damageBonus: 0,
  },
  hard: {
    id: 'hard',
    label: 'BLACK ICE',
    blurb: 'Hardened kernel — aggressive injects, flanks, thick integrity',
    shotThreshold: 28,
    postMoveShotThreshold: 1,
    grenadeEnabled: true,
    grenadeMinHits: 2,
    coverFullBonus: 55,
    coverHalfBonus: 35,
    flankMoveBonus: 22,
    hitChanceMoveWeight: 0.22,
    aimBonus: 12,
    defenseBonus: 8,
    hpBonus: 2,
    armorBonus: 1,
    damageBonus: 1,
  },
};

export const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard'];

export function getDifficulty(id: DifficultyId): DifficultyProfile {
  return DIFFICULTIES[id];
}
