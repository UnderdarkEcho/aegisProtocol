/** Runtime cheats for testing the breach mini-game. */

export interface DebugFlags {
  /** Actions cost 0 CYC and ignore remaining cycles */
  freeCyc: boolean;
  /** Player probes take no damage */
  godMode: boolean;
  /** All injects hit (99%) when player shoots */
  alwaysHit: boolean;
  /** Keep full map explored (re-applied on vision refresh) */
  revealAll: boolean;
}

export function createDebugFlags(): DebugFlags {
  return {
    freeCyc: false,
    godMode: false,
    alwaysHit: false,
    revealAll: false,
  };
}

export function debugStatusLine(d: DebugFlags): string {
  const bits: string[] = [];
  if (d.freeCyc) bits.push('FREE-CYC');
  if (d.godMode) bits.push('GOD');
  if (d.alwaysHit) bits.push('HIT+');
  if (d.revealAll) bits.push('NO-FOG');
  return bits.length ? `DBG: ${bits.join(' · ')}` : '';
}
