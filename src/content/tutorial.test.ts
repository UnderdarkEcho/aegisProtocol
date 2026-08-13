import { describe, expect, it } from 'vitest';
import {
  advanceTutorStep,
  getTutorStep,
  TUTORIAL_STEPS,
  tutorStepIndex,
} from './tutorial';
import type { GameEvent } from '../sim/types';

function ev(type: GameEvent['type'], payload: Record<string, unknown> = {}): GameEvent {
  return { type, payload };
}

describe('tutorial coach', () => {
  it('has six ordered steps', () => {
    expect(TUTORIAL_STEPS).toHaveLength(6);
    expect(tutorStepIndex('port')).toBe(4);
    expect(getTutorStep('shoot').title).toMatch(/INJECT/i);
  });

  it('advances only forward on events', () => {
    expect(advanceTutorStep('welcome', ev('unitSelected', { unitId: 'p_breach' }))).toBe(
      'move',
    );
    expect(advanceTutorStep('move', ev('move', { unitId: 'p_breach' }))).toBe('shoot');
    expect(advanceTutorStep('shoot', ev('shot', {}))).toBe('endturn');
    expect(advanceTutorStep('endturn', ev('turnStart', { team: 'enemy', turn: 1 }))).toBe(
      'port',
    );
    expect(
      advanceTutorStep('port', ev('toast', { text: 'WEDGE · link.sys ARMED — HOLD 1' })),
    ).toBe('done');
    // never go backward
    expect(advanceTutorStep('port', ev('unitSelected', {}))).toBe('port');
  });

  it('mission end jumps to final step', () => {
    expect(advanceTutorStep('welcome', ev('missionEnd', { result: 'victory' }))).toBe(
      'done',
    );
  });
});
