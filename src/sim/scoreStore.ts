/** Persist local personal-best leaderboards (skirmish + campaign). */

import type { DifficultyId } from './types';
import type { CampaignTrack } from './campaign';
import { SCORE_VERSION } from './scores';

const STORAGE_KEY = 'aegis.scores.v1';
const MAX_ENTRIES = 10;

export interface ScoreEntry {
  id: string;
  scoreVersion: typeof SCORE_VERSION;
  mode: 'skirmish' | 'campaign';
  track?: CampaignTrack;
  score: number;
  grade?: string;
  mapId?: string;
  difficulty: DifficultyId;
  reason?: string;
  turns?: number;
  kills?: number;
  squadAlive?: number;
  totalXp?: number;
  opsCleared?: number;
  at: number;
  label: string;
}

export interface LeaderboardState {
  version: 1;
  skirmish: ScoreEntry[];
  campaign: ScoreEntry[];
}

export function defaultLeaderboard(): LeaderboardState {
  return { version: 1, skirmish: [], campaign: [] };
}

export function sanitizeLeaderboard(raw: unknown): LeaderboardState {
  const d = defaultLeaderboard();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Partial<LeaderboardState>;
  if (o.version !== 1) return d;
  return {
    version: 1,
    skirmish: sanitizeList(o.skirmish),
    campaign: sanitizeList(o.campaign),
  };
}

function sanitizeList(list: unknown): ScoreEntry[] {
  if (!Array.isArray(list)) return [];
  const out: ScoreEntry[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const e = row as Partial<ScoreEntry>;
    const score = Math.floor(Number(e.score) || 0);
    if (!Number.isFinite(score) || score < 0) continue;
    const difficulty = (['easy', 'normal', 'hard', 'extreme'] as DifficultyId[]).includes(
      e.difficulty as DifficultyId,
    )
      ? (e.difficulty as DifficultyId)
      : 'normal';
    const mode = e.mode === 'campaign' ? 'campaign' : 'skirmish';
    out.push({
      id: typeof e.id === 'string' ? e.id : `sc_${Date.now()}_${out.length}`,
      scoreVersion: SCORE_VERSION,
      mode,
      track: e.track === 'extended' ? 'extended' : e.track === 'standard' ? 'standard' : undefined,
      score,
      grade: typeof e.grade === 'string' ? e.grade : undefined,
      mapId: typeof e.mapId === 'string' ? e.mapId : undefined,
      difficulty,
      reason: typeof e.reason === 'string' ? e.reason : undefined,
      turns: Number.isFinite(Number(e.turns)) ? Math.floor(Number(e.turns)) : undefined,
      kills: Number.isFinite(Number(e.kills)) ? Math.floor(Number(e.kills)) : undefined,
      squadAlive: Number.isFinite(Number(e.squadAlive))
        ? Math.floor(Number(e.squadAlive))
        : undefined,
      totalXp: Number.isFinite(Number(e.totalXp)) ? Math.floor(Number(e.totalXp)) : undefined,
      opsCleared: Number.isFinite(Number(e.opsCleared))
        ? Math.floor(Number(e.opsCleared))
        : undefined,
      at: Number.isFinite(Number(e.at)) ? Number(e.at) : Date.now(),
      label: typeof e.label === 'string' ? e.label : `${mode.toUpperCase()} · ${score}`,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
}

export function loadLeaderboard(): LeaderboardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLeaderboard();
    return sanitizeLeaderboard(JSON.parse(raw));
  } catch {
    return defaultLeaderboard();
  }
}

export function saveLeaderboard(state: LeaderboardState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeLeaderboard(state)));
  } catch {
    /* ignore */
  }
}

export function clearLeaderboard(): LeaderboardState {
  const empty = defaultLeaderboard();
  saveLeaderboard(empty);
  return empty;
}

export interface InsertResult {
  board: LeaderboardState;
  entry: ScoreEntry;
  /** True if this score is #1 on its board after insert */
  isBest: boolean;
  /** True if entry made the top-N list */
  placed: boolean;
  rank: number; // 1-based, or 0 if not placed
}

/** Insert a score into the appropriate board; returns updated board + rank info. */
export function insertScore(
  board: LeaderboardState,
  partial: Omit<ScoreEntry, 'id' | 'scoreVersion' | 'at'> & { at?: number; id?: string },
): InsertResult {
  const entry: ScoreEntry = {
    id: partial.id ?? `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    scoreVersion: SCORE_VERSION,
    mode: partial.mode,
    track: partial.track,
    score: Math.max(0, Math.floor(partial.score)),
    grade: partial.grade,
    mapId: partial.mapId,
    difficulty: partial.difficulty,
    reason: partial.reason,
    turns: partial.turns,
    kills: partial.kills,
    squadAlive: partial.squadAlive,
    totalXp: partial.totalXp,
    opsCleared: partial.opsCleared,
    at: partial.at ?? Date.now(),
    label: partial.label,
  };

  const key = entry.mode === 'campaign' ? 'campaign' : 'skirmish';
  const list = [...board[key], entry].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  const rankIdx = list.findIndex((e) => e.id === entry.id);
  const placed = rankIdx >= 0;
  const next: LeaderboardState = {
    version: 1,
    skirmish: key === 'skirmish' ? list : board.skirmish,
    campaign: key === 'campaign' ? list : board.campaign,
  };
  saveLeaderboard(next);
  return {
    board: next,
    entry,
    placed,
    isBest: placed && rankIdx === 0,
    rank: placed ? rankIdx + 1 : 0,
  };
}
