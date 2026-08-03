/**
 * Persist campaign progress — dual slots for standard (3) and extended (10) arcs.
 */

import {
  defaultCampaign,
  sanitizeCampaign,
  type CampaignState,
  type CampaignTrack,
} from './campaign';

const STORAGE_KEY = 'aegis.campaign.v2';
/** Legacy single-campaign key (v1). */
const LEGACY_KEY = 'aegis.campaign.v1';

export interface CampaignStoreState {
  version: 2;
  activeTrack: CampaignTrack;
  standard: CampaignState;
  extended: CampaignState;
}

export function defaultCampaignStore(): CampaignStoreState {
  return {
    version: 2,
    activeTrack: 'standard',
    standard: defaultCampaign('standard'),
    extended: defaultCampaign('extended'),
  };
}

export function sanitizeCampaignStore(raw: unknown): CampaignStoreState {
  const d = defaultCampaignStore();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;

  // Legacy: raw was a single CampaignState (v1 or flat)
  if (o.version === 1 || (o.opIndex != null && o.activeTrack == null && o.standard == null)) {
    return {
      version: 2,
      activeTrack: 'standard',
      standard: sanitizeCampaign(o, 'standard'),
      extended: defaultCampaign('extended'),
    };
  }

  if (o.version !== 2) return d;
  const activeTrack: CampaignTrack = o.activeTrack === 'extended' ? 'extended' : 'standard';
  return {
    version: 2,
    activeTrack,
    standard: sanitizeCampaign(o.standard, 'standard'),
    extended: sanitizeCampaign(o.extended, 'extended'),
  };
}

export function loadCampaignStore(): CampaignStoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeCampaignStore(JSON.parse(raw));
    // Migrate legacy single-slot save
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = sanitizeCampaignStore(JSON.parse(legacy));
      saveCampaignStore(migrated);
      return migrated;
    }
    return defaultCampaignStore();
  } catch {
    return defaultCampaignStore();
  }
}

export function saveCampaignStore(state: CampaignStoreState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeCampaignStore(state)));
  } catch {
    /* ignore */
  }
}

/** Active track's CampaignState. */
export function loadCampaign(): CampaignState {
  const store = loadCampaignStore();
  return store.activeTrack === 'extended' ? store.extended : store.standard;
}

export function saveCampaign(state: CampaignState): void {
  const store = loadCampaignStore();
  const track = state.track === 'extended' ? 'extended' : 'standard';
  const next: CampaignStoreState = {
    version: 2,
    activeTrack: track,
    standard: track === 'standard' ? sanitizeCampaign(state, 'standard') : store.standard,
    extended: track === 'extended' ? sanitizeCampaign(state, 'extended') : store.extended,
  };
  // Keep activeTrack aligned with what we just saved
  next.activeTrack = track;
  saveCampaignStore(next);
}

/** Reset active track only (or specified track). */
export function resetCampaign(track?: CampaignTrack): CampaignState {
  const store = loadCampaignStore();
  const t = track ?? store.activeTrack;
  const fresh = defaultCampaign(t);
  const next: CampaignStoreState = {
    version: 2,
    activeTrack: t,
    standard: t === 'standard' ? fresh : store.standard,
    extended: t === 'extended' ? fresh : store.extended,
  };
  saveCampaignStore(next);
  return fresh;
}

export function setActiveTrack(track: CampaignTrack): CampaignState {
  const store = loadCampaignStore();
  const next: CampaignStoreState = {
    ...store,
    version: 2,
    activeTrack: track,
  };
  saveCampaignStore(next);
  return track === 'extended' ? next.extended : next.standard;
}
