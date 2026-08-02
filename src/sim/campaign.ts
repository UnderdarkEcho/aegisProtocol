/**
 * Linear campaign — sequences existing maps into a short story arc.
 * Pure logic only; persistence lives in campaignStore.
 */

import type { MapId } from '../content/map';
import type { DifficultyId, MissionType } from './types';

export type PlayMode = 'campaign' | 'skirmish';

export type CampaignOpId = 'op01' | 'op02' | 'op03';

/** How OP-02 Vesper was cleared — shapes OP-03 Kernel. */
export type VesperPath = 'stealth' | 'loud';

export interface CampaignOp {
  id: CampaignOpId;
  mapId: MapId;
  codename: string;
  title: string;
  blurb: string;
  /** Soft ICE suggestion shown in UI (not forced) */
  suggestedDifficulty: DifficultyId;
  /** Objective shape for this op */
  missionType: MissionType;
}

export const CAMPAIGN_OPS: readonly CampaignOp[] = [
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
      'Contested corporate die under ICE wake timer. Port or wipe before the cycle budget runs out — courtyard, office, mech bay. Path chosen here changes Kernel.',
    suggestedDifficulty: 'normal',
    missionType: 'deadline',
  },
  {
    id: 'op03',
    mapId: 'kernel',
    codename: 'OP-03 KERNEL STACK',
    title: 'Deep stack',
    blurb:
      'Deep stack maze. Dual kernel guards, multi-room ICE. Break the stack or die trying.',
    suggestedDifficulty: 'hard',
    missionType: 'standard',
  },
] as const;

export const CAMPAIGN_OP_COUNT = CAMPAIGN_OPS.length;

export interface CampaignState {
  version: 1;
  /** Index into CAMPAIGN_OPS (0..n-1). Meaningful when !completed. */
  opIndex: number;
  /** True after final op victory until player starts a new campaign. */
  completed: boolean;
  /** Clear counts per op index (flavor / progress). */
  clears: number[];
  /** Sum of mission XP banked during this campaign run (reset on new campaign). */
  totalXpEarned: number;
  /**
   * Set when OP-02 is won:
   * - stealth = data port
   * - loud = hostiles wiped
   * Shapes OP-03 enemy density + brief.
   */
  vesperPath: VesperPath | null;
}

export function defaultCampaign(): CampaignState {
  return {
    version: 1,
    opIndex: 0,
    completed: false,
    clears: Array.from({ length: CAMPAIGN_OP_COUNT }, () => 0),
    totalXpEarned: 0,
    vesperPath: null,
  };
}

export function sanitizeCampaign(raw: unknown): CampaignState {
  const d = defaultCampaign();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Partial<CampaignState>;
  if (o.version !== 1) return d;
  const opIndex = Math.max(
    0,
    Math.min(CAMPAIGN_OP_COUNT - 1, Math.floor(Number(o.opIndex) || 0)),
  );
  const completed = Boolean(o.completed);
  const clears = Array.from({ length: CAMPAIGN_OP_COUNT }, (_, i) => {
    const v = Array.isArray(o.clears) ? Number(o.clears[i]) : 0;
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  });
  const xpRaw = Number(o.totalXpEarned);
  const totalXpEarned =
    Number.isFinite(xpRaw) && xpRaw > 0 ? Math.floor(xpRaw) : 0;
  const vp = o.vesperPath;
  const vesperPath: VesperPath | null =
    vp === 'stealth' || vp === 'loud' ? vp : null;
  return { version: 1, opIndex, completed, clears, totalXpEarned, vesperPath };
}

/** Bank mission XP into the campaign run total. */
export function bankCampaignXp(state: CampaignState, amount: number): CampaignState {
  const add = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  if (add <= 0) return state;
  return { ...state, totalXpEarned: state.totalXpEarned + add };
}

export function getCurrentOp(state: CampaignState): CampaignOp {
  const idx = state.completed
    ? CAMPAIGN_OP_COUNT - 1
    : Math.max(0, Math.min(CAMPAIGN_OP_COUNT - 1, state.opIndex));
  return resolveOpPresentation(CAMPAIGN_OPS[idx]!, state);
}

/**
 * OP-03 copy/title shifts with the Vesper win path.
 * Enemy counts are applied in map build via `vesperPath`.
 */
export function resolveOpPresentation(
  op: CampaignOp,
  state: CampaignState,
): CampaignOp {
  if (op.id !== 'op03' || !state.vesperPath) return op;
  if (state.vesperPath === 'stealth') {
    return {
      ...op,
      title: 'Deep stack · quiet approach',
      blurb:
        'Vesper fell silent via the data port. Kernel is understaffed — spine patrols thinned, single kernel hammer. Strike before the alarm catches up.',
    };
  }
  return {
    ...op,
    title: 'Deep stack · full alert',
    blurb:
      'Vesper was glassed loud. Kernel is on full alert — dual hammers, extra scrapers on the spine, and a hot response pod. Expect a meat grinder.',
  };
}

export function campaignProgressLabel(state: CampaignState): string {
  if (state.completed) return `CAMPAIGN COMPLETE · ${CAMPAIGN_OP_COUNT}/${CAMPAIGN_OP_COUNT}`;
  const op = getCurrentOp(state);
  const branch =
    op.id === 'op03' && state.vesperPath
      ? state.vesperPath === 'stealth'
        ? ' · QUIET'
        : ' · ALERT'
      : '';
  return `${op.codename}${branch} · ${state.opIndex + 1}/${CAMPAIGN_OP_COUNT}`;
}

/**
 * Apply a mission outcome to campaign progress.
 * Victory advances (or completes); defeat leaves op index unchanged.
 * OP-02 win reason sets vesperPath for Kernel branching.
 */
export function applyCampaignOutcome(
  state: CampaignState,
  victory: boolean,
  reason = '',
): CampaignState {
  const next: CampaignState = {
    version: 1,
    opIndex: state.opIndex,
    completed: state.completed,
    clears: [...state.clears],
    totalXpEarned: state.totalXpEarned,
    vesperPath: state.vesperPath,
  };

  if (state.completed) return next;
  if (!victory) return next;

  const i = Math.max(0, Math.min(CAMPAIGN_OP_COUNT - 1, next.opIndex));
  next.clears[i] = (next.clears[i] ?? 0) + 1;

  // Just cleared OP-02 (index 1) — lock the Kernel branch
  if (i === 1) {
    next.vesperPath = reason === 'data_port' ? 'stealth' : 'loud';
  }

  if (i >= CAMPAIGN_OP_COUNT - 1) {
    next.completed = true;
  } else {
    next.opIndex = i + 1;
  }
  return next;
}

/** Reset op progress only — roster XP is independent. */
export function newCampaign(): CampaignState {
  return defaultCampaign();
}

export function isCampaignOpId(id: string): id is CampaignOpId {
  return CAMPAIGN_OPS.some((o) => o.id === id);
}
