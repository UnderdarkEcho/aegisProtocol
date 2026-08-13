/**
 * Single guided tutorial mission — coach steps advance on game events.
 * Practice only: no XP / CRED / RECORDS (handled by playMode === 'tutorial').
 */

import type { GameEvent } from '../sim/types';

export interface TutorStep {
  id: string;
  /** e.g. "1/6" */
  indexLabel: string;
  title: string;
  body: string;
}

export const TUTORIAL_STEPS: readonly TutorStep[] = [
  {
    id: 'welcome',
    indexLabel: '1/6',
    title: 'SELECT A PROBE',
    body: 'Click a squad chip or a unit on the die. Green tiles show MOVE range for the selected probe.',
  },
  {
    id: 'move',
    indexLabel: '2/6',
    title: 'MOVE INTO COVER',
    body: 'Click a green tile to MOVE (costs CYC). End behind crates or sandbags — cover cuts hostile fire.',
  },
  {
    id: 'shoot',
    indexLabel: '3/6',
    title: 'INJECT HOSTILES',
    body: 'When a hostile is in line of sight, pick SHOOT then click the target. Aim % shows before you fire.',
  },
  {
    id: 'endturn',
    indexLabel: '4/6',
    title: 'END CYCLE',
    body: 'Each probe has limited CYC. When your team is done acting, press END CYCLE — hostiles process next.',
  },
  {
    id: 'port',
    indexLabel: '5/6',
    title: 'SEIZE THE DATA PORT',
    body: 'Push north to the glowing DATA PORT. Stand on a port tile, run link.sys, then hold 1 hostile cycle to channel.',
  },
  {
    id: 'done',
    indexLabel: '6/6',
    title: 'YOU KNOW THE LOOP',
    body: 'Wipe remaining scrapers or finish the port. Tutorial is practice only — no XP or records. Ready for CAMPAIGN after.',
  },
] as const;

export type TutorStepId = (typeof TUTORIAL_STEPS)[number]['id'];

/** Index of step by id. */
export function tutorStepIndex(id: string): number {
  const i = TUTORIAL_STEPS.findIndex((s) => s.id === id);
  return i >= 0 ? i : 0;
}

/**
 * Advance coach step from a game event.
 * Returns the next step id (may be unchanged).
 */
export function advanceTutorStep(
  currentId: string,
  e: GameEvent,
): string {
  const order = TUTORIAL_STEPS.map((s) => s.id);
  const cur = tutorStepIndex(currentId);
  const atLeast = (id: string): string => {
    const n = tutorStepIndex(id);
    return n > cur ? id : currentId;
  };

  switch (e.type) {
    case 'unitSelected':
      return atLeast('move');
    case 'move':
      return atLeast('shoot');
    case 'shot':
    case 'miss':
    case 'damage':
    case 'kill':
    case 'grenade':
      return atLeast('endturn');
    case 'turnStart': {
      const team = e.payload.team;
      const turn = Number(e.payload.turn ?? 1);
      // After first hostile cycle (or second player turn), push toward port objective
      if (team === 'enemy' || (team === 'player' && turn >= 2)) {
        return atLeast('port');
      }
      return currentId;
    }
    case 'toast': {
      const text = String(e.payload.text ?? '');
      if (text.includes('link.sys') || text.includes('DATA PORT')) {
        return atLeast('done');
      }
      return currentId;
    }
    case 'missionEnd':
      return order[order.length - 1]!;
    default:
      return currentId;
  }
}

export function getTutorStep(id: string): TutorStep {
  return TUTORIAL_STEPS[tutorStepIndex(id)] ?? TUTORIAL_STEPS[0]!;
}
