import { describe, expect, it } from 'vitest';
import {
  computeCampaignScore,
  computeMissionScore,
  maxDifficulty,
} from './scores';
import {
  clearLeaderboard,
  defaultLeaderboard,
  insertScore,
  sanitizeLeaderboard,
} from './scoreStore';

describe('computeMissionScore', () => {
  it('scores S hard victory above C easy victory', () => {
    const sHard = computeMissionScore({
      victory: true,
      grade: 'S',
      turns: 7,
      squadAlive: 4,
      squadTotal: 4,
      enemyKills: 8,
      reason: 'hostiles_eliminated',
      difficulty: 'hard',
    });
    const cEasy = computeMissionScore({
      victory: true,
      grade: 'C',
      turns: 18,
      squadAlive: 2,
      squadTotal: 4,
      enemyKills: 3,
      reason: 'hostiles_eliminated',
      difficulty: 'easy',
    });
    expect(sHard).toBeGreaterThan(cEasy);
  });

  it('applies extreme multiplier above hard', () => {
    const base = {
      victory: true as const,
      grade: 'A' as const,
      turns: 10,
      squadAlive: 4,
      squadTotal: 4,
      enemyKills: 6,
      reason: 'data_port',
    };
    const hard = computeMissionScore({ ...base, difficulty: 'hard' });
    const extreme = computeMissionScore({ ...base, difficulty: 'extreme' });
    expect(extreme).toBeGreaterThan(hard);
  });

  it('defeat score is low but non-negative', () => {
    const n = computeMissionScore({
      victory: false,
      grade: 'F',
      turns: 5,
      squadAlive: 0,
      squadTotal: 4,
      enemyKills: 2,
      reason: 'squad_wiped',
      difficulty: 'normal',
    });
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(200);
  });
});

describe('computeCampaignScore', () => {
  it('completed extended scores higher than incomplete sum', () => {
    const missions = [1200, 1400, 1600];
    const incomplete = computeCampaignScore({
      missionScores: missions,
      completed: false,
      track: 'standard',
      difficulty: 'normal',
    });
    const complete = computeCampaignScore({
      missionScores: missions,
      completed: true,
      track: 'standard',
      difficulty: 'normal',
    });
    expect(complete).toBeGreaterThan(incomplete);
  });

  it('extended completion bonus exceeds standard', () => {
    const missions = Array.from({ length: 10 }, () => 1000);
    const std = computeCampaignScore({
      missionScores: missions.slice(0, 3),
      completed: true,
      track: 'standard',
      difficulty: 'hard',
    });
    const ext = computeCampaignScore({
      missionScores: missions,
      completed: true,
      track: 'extended',
      difficulty: 'hard',
    });
    expect(ext).toBeGreaterThan(std);
  });
});

describe('maxDifficulty', () => {
  it('picks the harsher ICE', () => {
    expect(maxDifficulty('easy', 'hard')).toBe('hard');
    expect(maxDifficulty('extreme', 'hard')).toBe('extreme');
  });
});

describe('scoreStore insert', () => {
  it('keeps top 10 sorted and reports best', () => {
    // Avoid touching real localStorage side effects hard — insert still calls save
    let board = defaultLeaderboard();
    const r1 = insertScore(board, {
      mode: 'skirmish',
      score: 1000,
      difficulty: 'normal',
      label: 'A',
    });
    board = r1.board;
    expect(r1.isBest).toBe(true);
    expect(r1.rank).toBe(1);

    const r2 = insertScore(board, {
      mode: 'skirmish',
      score: 2000,
      difficulty: 'hard',
      label: 'B',
    });
    expect(r2.isBest).toBe(true);
    expect(r2.board.skirmish[0]!.score).toBe(2000);
    expect(r2.board.skirmish).toHaveLength(2);

    clearLeaderboard();
  });

  it('sanitizes bad payloads', () => {
    const b = sanitizeLeaderboard({ version: 1, skirmish: [{ score: -5 }], campaign: null });
    expect(b.skirmish).toHaveLength(0);
    expect(b.campaign).toHaveLength(0);
  });
});
