import { describe, expect, it } from 'vitest';
import { composeScoreShareText } from './share';
import type { ScoreEntry } from '../sim/scoreStore';

const base: ScoreEntry = {
  id: 't1',
  scoreVersion: 1,
  mode: 'skirmish',
  score: 18420,
  grade: 'S',
  mapId: 'vesper',
  difficulty: 'extreme',
  reason: 'hostiles_eliminated',
  turns: 7,
  kills: 8,
  at: Date.now(),
  label: 'VESPER · VOID ICE · S · T7',
};

describe('composeScoreShareText', () => {
  it('includes score, game name, and creator handle', () => {
    const t = composeScoreShareText(base, 1);
    expect(t).toContain('Aegis Protocol');
    expect(t).toContain('18,420');
    expect(t).toContain('@RichGarrick');
    expect(t).toContain('github.com/UnderdarkEcho/aegisProtocol');
    expect(t.length).toBeLessThan(400);
  });

  it('formats campaign stack clear posts', () => {
    const t = composeScoreShareText(
      {
        ...base,
        mode: 'campaign',
        track: 'extended',
        totalXp: 900,
        opsCleared: 10,
      },
      1,
    );
    expect(t).toMatch(/EXTENDED|STACK CLEAR/i);
    expect(t).toContain('personal best');
  });
});
