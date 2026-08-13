import { afterEach, describe, expect, it } from 'vitest';
import { loadRoster } from './roster';

describe('roster process names', () => {
  const mem = new Map<string, string>();
  const ls = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };

  afterEach(() => mem.clear());

  it('migrates leftover human callsigns to process names', () => {
    (globalThis as { localStorage?: typeof ls }).localStorage = ls;
    ls.setItem(
      'aegis.squad.roster.v1',
      JSON.stringify({
        version: 1,
        operatives: [
          { id: 'p_breach', name: 'REYES', classId: 'breacher', xp: 40, wounded: false },
          { id: 'p_mark', name: 'CHEN', classId: 'marksman', xp: 0, wounded: false },
          { id: 'p_sup', name: 'OKAFOR', classId: 'support', xp: 10, wounded: false },
          { id: 'p_heavy', name: 'VOLKOV', classId: 'heavy', xp: 0, wounded: false },
        ],
      }),
    );
    const r = loadRoster();
    expect(r.operatives.map((o) => o.name)).toEqual(['WEDGE', 'SEEK', 'PATCHD', 'FLOOD']);
    expect(r.operatives[0]!.xp).toBe(40);
  });
});
