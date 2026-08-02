/** Persist campaign progress across sessions (localStorage). */

import {
  defaultCampaign,
  sanitizeCampaign,
  type CampaignState,
} from './campaign';

const STORAGE_KEY = 'aegis.campaign.v1';

export function loadCampaign(): CampaignState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCampaign();
    return sanitizeCampaign(JSON.parse(raw));
  } catch {
    return defaultCampaign();
  }
}

export function saveCampaign(state: CampaignState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeCampaign(state)));
  } catch {
    // private mode / quota — ignore
  }
}

export function resetCampaign(): CampaignState {
  const c = defaultCampaign();
  saveCampaign(c);
  return c;
}
