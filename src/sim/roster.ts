/** Persist squad XP across breaches (localStorage). */

import {
  defaultRoster,
  type OperativeProgress,
  type SquadRoster,
  SQUAD_TEMPLATE,
} from './progression';

const STORAGE_KEY = 'aegis.squad.roster.v1';

export function loadRoster(): SquadRoster {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultRoster();
    const parsed = JSON.parse(raw) as SquadRoster;
    if (parsed?.version !== 1 || !Array.isArray(parsed.operatives)) {
      return defaultRoster();
    }
    return sanitizeRoster(parsed);
  } catch {
    return defaultRoster();
  }
}

export function saveRoster(roster: SquadRoster): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeRoster(roster)));
  } catch {
    // private mode / quota — ignore
  }
}

export function resetRoster(): SquadRoster {
  const r = defaultRoster();
  saveRoster(r);
  return r;
}

function sanitizeRoster(r: SquadRoster): SquadRoster {
  const byId = new Map<string, OperativeProgress>();
  for (const o of r.operatives) {
    if (!o?.id) continue;
    // Accept number or numeric string; reject null/NaN (JSON turns NaN into null)
    const xpRaw = o.xp as unknown;
    if (xpRaw == null) continue;
    const xp = typeof xpRaw === 'number' ? xpRaw : Number(xpRaw);
    if (!Number.isFinite(xp) || xp < 0) continue;
    byId.set(o.id, {
      id: o.id,
      name: typeof o.name === 'string' ? o.name : o.id,
      classId: o.classId,
      xp: Math.floor(xp),
      wounded: Boolean((o as OperativeProgress).wounded),
    });
  }
  return {
    version: 1,
    operatives: SQUAD_TEMPLATE.map((t) => {
      const existing = byId.get(t.id);
      if (existing && existing.classId === t.classId) {
        return {
          ...existing,
          // Always canonical process name from template (migrate old human callsigns)
          name: t.name,
          wounded: Boolean(existing.wounded),
        };
      }
      return { id: t.id, name: t.name, classId: t.classId, xp: 0, wounded: false };
    }),
  };
}
