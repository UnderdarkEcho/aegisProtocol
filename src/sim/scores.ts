/**
 * Local ranking scores for skirmish missions and campaign runs.
 * Pure math — no DOM / storage.
 */

import type { MapId } from '../content/map';
import type { DifficultyId, MissionType } from './types';

export type GradeLetter = 'S' | 'A' | 'B' | 'C' | 'F';

export const SCORE_VERSION = 1 as const;

const DIFF_MULT: Record<DifficultyId, number> = {
  easy: 0.85,
  normal: 1.0,
  hard: 1.25,
  extreme: 1.55,
};

const GRADE_BONUS: Record<GradeLetter, number> = {
  S: 500,
  A: 350,
  B: 200,
  C: 100,
  F: 0,
};

export interface MissionScoreInput {
  victory: boolean;
  grade: GradeLetter | string;
  turns: number;
  squadAlive: number;
  squadTotal: number;
  enemyKills: number;
  reason: string;
  difficulty: DifficultyId;
  mapId?: MapId | string;
  missionType?: MissionType;
}

/** Integer mission score for a single breach. */
export function computeMissionScore(opts: MissionScoreInput): number {
  if (!opts.victory) {
    // Token consolation for partial effort
    const kills = Math.max(0, opts.enemyKills) * 8;
    return Math.max(0, Math.floor(kills * (DIFF_MULT[opts.difficulty] ?? 1)));
  }

  let raw = 1000;
  const g = (opts.grade as GradeLetter) in GRADE_BONUS ? (opts.grade as GradeLetter) : 'C';
  raw += GRADE_BONUS[g];

  raw += Math.min(300, Math.max(0, opts.enemyKills) * 15);

  const dead = Math.max(0, opts.squadTotal - opts.squadAlive);
  if (dead === 0 && opts.squadTotal > 0) raw += 200;
  else raw -= dead * 80;

  if (opts.turns <= 8) raw += 180;
  else if (opts.turns <= 12) raw += 90;
  else if (opts.turns <= 16) raw += 0;
  else if (opts.turns <= 22) raw -= 40;
  else raw -= 100;

  if (opts.reason === 'data_port') raw += 120;
  if (opts.missionType === 'deadline' && opts.victory) raw += 80;

  const mult = DIFF_MULT[opts.difficulty] ?? 1;
  return Math.max(0, Math.floor(raw * mult));
}

export interface CampaignScoreInput {
  missionScores: number[];
  completed: boolean;
  track: 'standard' | 'extended';
  difficulty: DifficultyId;
}

/** Aggregate campaign run score (prefer completed runs for leaderboard). */
export function computeCampaignScore(opts: CampaignScoreInput): number {
  const sum = opts.missionScores.reduce((s, n) => s + Math.max(0, n), 0);
  if (!opts.completed) return Math.floor(sum * 0.35);

  let bonus = opts.track === 'extended' ? 2500 : 1200;
  const mult = DIFF_MULT[opts.difficulty] ?? 1;
  // Slight extra for running the long arc
  if (opts.track === 'extended') bonus = Math.floor(bonus * 1.1);
  return Math.max(0, Math.floor(sum + bonus * mult));
}

export function difficultyRank(a: DifficultyId, b: DifficultyId): number {
  const order: DifficultyId[] = ['easy', 'normal', 'hard', 'extreme'];
  return order.indexOf(a) - order.indexOf(b);
}

/** Keep the harsher ICE for campaign run tracking. */
export function maxDifficulty(a: DifficultyId, b: DifficultyId): DifficultyId {
  return difficultyRank(a, b) >= 0 ? a : b;
}
