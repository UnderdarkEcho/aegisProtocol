/**
 * Campaign tracks — standard 3-op arc and extended 10-op arc.
 * Pure logic only; persistence lives in campaignStore.
 */

import type { MapId } from '../content/map';
import type { DifficultyId, MissionType } from './types';

export type PlayMode = 'campaign' | 'skirmish' | 'tutorial';
export type CampaignTrack = 'standard' | 'extended';

/** How a Vesper deadline op was cleared — shapes later Kernel ops. */
export type VesperPath = 'stealth' | 'loud';

export interface CampaignOp {
  id: string;
  mapId: MapId;
  codename: string;
  title: string;
  blurb: string;
  /** Soft ICE suggestion shown in UI (not forced) */
  suggestedDifficulty: DifficultyId;
  /** Objective shape for this op */
  missionType: MissionType;
  /** If true, victory on this op locks vesperPath from win reason */
  locksVesperPath?: boolean;
}

export const CAMPAIGN_OPS_STANDARD: readonly CampaignOp[] = [
  {
    id: 'op01',
    mapId: 'training',
    codename: 'OP-01 PIN PAD',
    title: 'Soft insert',
    blurb:
      'Soft insert on a test die. Prove the kit — seize the north port or wipe scrapers before corp ICE notices.',
    suggestedDifficulty: 'easy',
    missionType: 'standard',
  },
  {
    id: 'op02',
    mapId: 'vesper',
    codename: 'OP-02 NODE VESPER',
    title: 'Corporate die · timed',
    blurb:
      'Contested corporate die under ICE wake timer. Courtyard, office, mech bay. Path chosen here changes Kernel.',
    suggestedDifficulty: 'normal',
    missionType: 'deadline',
    locksVesperPath: true,
  },
  {
    id: 'op03',
    mapId: 'kernel',
    codename: 'OP-03 KERNEL STACK',
    title: 'Deep stack',
    blurb: 'Deep stack maze. Dual kernel guards, multi-room ICE. Break the stack or die trying.',
    suggestedDifficulty: 'hard',
    missionType: 'standard',
  },
] as const;

/** Extended 10-op arc — reuses maps with rising pressure. */
export const CAMPAIGN_OPS_EXTENDED: readonly CampaignOp[] = [
  {
    id: 'ex01',
    mapId: 'training',
    codename: 'EX-01 PIN PAD',
    title: 'Soft insert',
    blurb: 'Extended stack boot. Soft insert on the pin pad — prove the kit still loads.',
    suggestedDifficulty: 'easy',
    missionType: 'standard',
  },
  {
    id: 'ex02',
    mapId: 'training',
    codename: 'EX-02 PIN PAD · CLOCK',
    title: 'Wake drill',
    blurb: 'Same die, tighter clock. ICE wake timer is live — port or wipe before the pad locks.',
    suggestedDifficulty: 'normal',
    missionType: 'deadline',
  },
  {
    id: 'ex03',
    mapId: 'vesper',
    codename: 'EX-03 NODE VESPER',
    title: 'Courtyard recon',
    blurb: 'First look at the corporate die. Map the courtyard and office — no wake timer yet.',
    suggestedDifficulty: 'normal',
    missionType: 'standard',
  },
  {
    id: 'ex04',
    mapId: 'vesper',
    codename: 'EX-04 VESPER · TIMED',
    title: 'Corporate die · timed',
    blurb:
      'ICE wake is hot. Clear Vesper under the clock. Port = quiet path; wipe = full alert for Kernel ops.',
    suggestedDifficulty: 'hard',
    missionType: 'deadline',
    locksVesperPath: true,
  },
  {
    id: 'ex05',
    mapId: 'kernel',
    codename: 'EX-05 KERNEL SPINE',
    title: 'First kernel push',
    blurb: 'Deep stack entry. Branch from Vesper shapes the response pods waiting inside.',
    suggestedDifficulty: 'hard',
    missionType: 'standard',
  },
  {
    id: 'ex06',
    mapId: 'training',
    codename: 'EX-06 PIN PAD · HARD',
    title: 'Return drill',
    blurb: 'Back to the pin pad under hard ICE and a short clock. No soft boot this time.',
    suggestedDifficulty: 'hard',
    missionType: 'deadline',
  },
  {
    id: 'ex07',
    mapId: 'vesper',
    codename: 'EX-07 VESPER · HARD',
    title: 'Office purge',
    blurb: 'Vesper again — thicker response. Port or wipe without the wake timer, but expect flanks.',
    suggestedDifficulty: 'hard',
    missionType: 'standard',
  },
  {
    id: 'ex08',
    mapId: 'kernel',
    codename: 'EX-08 KERNEL · CLOCK',
    title: 'Spine under timer',
    blurb: 'Kernel stack with ICE wake. Dual guards if you were loud; thinner if you stayed quiet.',
    suggestedDifficulty: 'extreme',
    missionType: 'deadline',
  },
  {
    id: 'ex09',
    mapId: 'vesper',
    codename: 'EX-09 VESPER · VOID',
    title: 'Final corporate pass',
    blurb: 'Void-class pressure on the corporate die. Deadline live. Leave nothing that can phone home.',
    suggestedDifficulty: 'extreme',
    missionType: 'deadline',
  },
  {
    id: 'ex10',
    mapId: 'kernel',
    codename: 'EX-10 KERNEL FINALE',
    title: 'Stack clear',
    blurb: 'Last breach. Full kernel stack under void ICE. Finish the extended arc or burn out.',
    suggestedDifficulty: 'extreme',
    missionType: 'standard',
  },
] as const;

/** @deprecated use getCampaignOps('standard') — kept for older imports/tests */
export const CAMPAIGN_OPS = CAMPAIGN_OPS_STANDARD;

export function getCampaignOps(track: CampaignTrack = 'standard'): readonly CampaignOp[] {
  return track === 'extended' ? CAMPAIGN_OPS_EXTENDED : CAMPAIGN_OPS_STANDARD;
}

export function getOpCount(track: CampaignTrack = 'standard'): number {
  return getCampaignOps(track).length;
}

/** Standard arc length (compat). */
export const CAMPAIGN_OP_COUNT = CAMPAIGN_OPS_STANDARD.length;

export type CampaignOpId = string;

export interface CampaignState {
  version: 2;
  track: CampaignTrack;
  /** Index into active track ops (0..n-1). Meaningful when !completed. */
  opIndex: number;
  /** True after final op victory until player starts a new campaign on this track. */
  completed: boolean;
  /** Clear counts per op index. */
  clears: number[];
  /** Sum of mission XP banked during this campaign run. */
  totalXpEarned: number;
  /**
   * Set when a locksVesperPath op is won:
   * - stealth = data port
   * - loud = hostiles wiped
   */
  vesperPath: VesperPath | null;
  /** Sum of mission scores this run (for campaign leaderboard). */
  runScore: number;
  /** Highest ICE used during this run. */
  runDifficulty: DifficultyId;
}

export function defaultCampaign(track: CampaignTrack = 'standard'): CampaignState {
  const n = getOpCount(track);
  return {
    version: 2,
    track,
    opIndex: 0,
    completed: false,
    clears: Array.from({ length: n }, () => 0),
    totalXpEarned: 0,
    vesperPath: null,
    runScore: 0,
    runDifficulty: 'normal',
  };
}

export function sanitizeCampaign(raw: unknown, fallbackTrack: CampaignTrack = 'standard'): CampaignState {
  const d = defaultCampaign(fallbackTrack);
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Partial<CampaignState> & { version?: number };

  // Migrate v1 (no track) → standard
  const track: CampaignTrack =
    o.track === 'extended' || o.track === 'standard'
      ? o.track
      : fallbackTrack === 'extended'
        ? 'extended'
        : 'standard';

  const opsN = getOpCount(track);
  const opIndex = Math.max(0, Math.min(opsN - 1, Math.floor(Number(o.opIndex) || 0)));
  const completed = Boolean(o.completed);
  const clears = Array.from({ length: opsN }, (_, i) => {
    const v = Array.isArray(o.clears) ? Number(o.clears[i]) : 0;
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  });
  const xpRaw = Number(o.totalXpEarned);
  const totalXpEarned = Number.isFinite(xpRaw) && xpRaw > 0 ? Math.floor(xpRaw) : 0;
  const vp = o.vesperPath;
  const vesperPath: VesperPath | null =
    vp === 'stealth' || vp === 'loud' ? vp : null;
  const rs = Number(o.runScore);
  const runScore = Number.isFinite(rs) && rs > 0 ? Math.floor(rs) : 0;
  const rd = o.runDifficulty;
  const runDifficulty: DifficultyId =
    rd === 'easy' || rd === 'normal' || rd === 'hard' || rd === 'extreme' ? rd : 'normal';

  return {
    version: 2,
    track,
    opIndex,
    completed,
    clears,
    totalXpEarned,
    vesperPath,
    runScore,
    runDifficulty,
  };
}

/** Bank mission XP into the campaign run total. */
export function bankCampaignXp(state: CampaignState, amount: number): CampaignState {
  const add = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  if (add <= 0) return state;
  return { ...state, totalXpEarned: state.totalXpEarned + add };
}

/** Add a mission score into the run accumulator. */
export function bankCampaignRunScore(state: CampaignState, amount: number): CampaignState {
  const add = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  if (add <= 0) return state;
  return { ...state, runScore: state.runScore + add };
}

export function getCurrentOp(state: CampaignState): CampaignOp {
  const ops = getCampaignOps(state.track);
  const n = ops.length;
  const idx = state.completed
    ? n - 1
    : Math.max(0, Math.min(n - 1, state.opIndex));
  return resolveOpPresentation(ops[idx]!, state);
}

/**
 * Kernel ops shift copy/title with the Vesper win path.
 */
export function resolveOpPresentation(op: CampaignOp, state: CampaignState): CampaignOp {
  if (op.mapId !== 'kernel' || !state.vesperPath) return op;
  if (state.vesperPath === 'stealth') {
    return {
      ...op,
      title: `${op.title} · quiet approach`,
      blurb:
        'Vesper fell silent via the data port. Kernel is understaffed — spine patrols thinned, single kernel hammer. Strike before the alarm catches up. ' +
        op.blurb,
    };
  }
  return {
    ...op,
    title: `${op.title} · full alert`,
    blurb:
      'Vesper was glassed loud. Kernel is on full alert — dual hammers, extra scrapers on the spine, and a hot response pod. ' +
      op.blurb,
  };
}

export function campaignProgressLabel(state: CampaignState): string {
  const n = getOpCount(state.track);
  const tag = state.track === 'extended' ? 'EXT' : 'STD';
  if (state.completed) return `CAMPAIGN COMPLETE · ${tag} ${n}/${n}`;
  const op = getCurrentOp(state);
  const branch =
    op.mapId === 'kernel' && state.vesperPath
      ? state.vesperPath === 'stealth'
        ? ' · QUIET'
        : ' · ALERT'
      : '';
  return `${op.codename}${branch} · ${tag} ${state.opIndex + 1}/${n}`;
}

/**
 * Apply a mission outcome to campaign progress.
 * Victory advances (or completes); defeat leaves op index unchanged.
 * Ops with locksVesperPath set vesperPath from win reason.
 */
export function applyCampaignOutcome(
  state: CampaignState,
  victory: boolean,
  reason = '',
): CampaignState {
  const ops = getCampaignOps(state.track);
  const n = ops.length;
  const next: CampaignState = {
    version: 2,
    track: state.track,
    opIndex: state.opIndex,
    completed: state.completed,
    clears: [...state.clears],
    totalXpEarned: state.totalXpEarned,
    vesperPath: state.vesperPath,
    runScore: state.runScore,
    runDifficulty: state.runDifficulty,
  };

  if (state.completed) return next;
  if (!victory) return next;

  const i = Math.max(0, Math.min(n - 1, next.opIndex));
  next.clears[i] = (next.clears[i] ?? 0) + 1;

  const op = ops[i]!;
  if (op.locksVesperPath) {
    next.vesperPath = reason === 'data_port' ? 'stealth' : 'loud';
  }

  if (i >= n - 1) {
    next.completed = true;
  } else {
    next.opIndex = i + 1;
  }
  return next;
}

/** Reset op progress for a track — roster XP is independent. */
export function newCampaign(track: CampaignTrack = 'standard'): CampaignState {
  return defaultCampaign(track);
}

export function isCampaignOpId(id: string, track: CampaignTrack = 'standard'): boolean {
  return getCampaignOps(track).some((o) => o.id === id);
}
