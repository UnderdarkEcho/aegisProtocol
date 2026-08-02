/** Persist squad loadout / cred (localStorage). */

import { defaultLoadout, sanitizeLoadout, type LoadoutState } from './loadout';

const STORAGE_KEY = 'aegis.loadout.v1';

export function loadLoadout(): LoadoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLoadout();
    return sanitizeLoadout(JSON.parse(raw));
  } catch {
    return defaultLoadout();
  }
}

export function saveLoadout(state: LoadoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeLoadout(state)));
  } catch {
    // ignore
  }
}

export function resetLoadout(): LoadoutState {
  const s = defaultLoadout();
  saveLoadout(s);
  return s;
}
