import { keyOf } from './grid';
import { createRng } from './rng';
import type { MissionState, Pickup, PickupKind, Vec2 } from './types';

const KINDS: PickupKind[] = ['cycles', 'integrity', 'scan', 'purge'];

export const PICKUP_LABEL: Record<PickupKind, string> = {
  cycles: 'cache.cyc',
  integrity: 'restore.int',
  scan: 'ping.map',
  purge: 'clean.sys',
};

export const PICKUP_COLOR: Record<PickupKind, number> = {
  cycles: 0x3d9cff,
  integrity: 0x4dff9a,
  scan: 0xc47a3a,
  purge: 0xffc14a,
};

function isBlocked(state: MissionState, x: number, y: number): boolean {
  const t = state.tiles[y]?.[x];
  if (!t?.walkable || t.blocked) return true;
  for (const u of state.units.values()) {
    if (u.alive && u.pos.x === x && u.pos.y === y) return true;
  }
  for (const p of state.props.values()) {
    if (!p.destroyed && p.pos.x === x && p.pos.y === y) return true;
  }
  for (const pk of state.pickups.values()) {
    if (!pk.collected && pk.pos.x === x && pk.pos.y === y) return true;
  }
  for (const e of state.extractTiles) {
    if (e.x === x && e.y === y) return true;
  }
  for (const e of state.dataPortTiles ?? []) {
    if (e.x === x && e.y === y) return true;
  }
  return false;
}

function amountFor(kind: PickupKind, rng: () => number): number {
  if (kind === 'cycles') return rng() < 0.35 ? 2 : 1;
  if (kind === 'integrity') return 3 + Math.floor(rng() * 2); // 3–4
  if (kind === 'scan') return 10 + Math.floor(rng() * 8); // tiles to reveal
  return 1; // purge
}

/** Find empty walkable tiles for loot. Prefer mid-map, not starting strip. */
export function findPickupSpots(state: MissionState, count: number, seed: number): Vec2[] {
  const rng = createRng(seed ^ 0x51c);
  const candidates: Vec2[] = [];
  for (let y = 2; y < state.height - 2; y++) {
    for (let x = 2; x < state.width - 2; x++) {
      // Soft bias away from south spawn row
      if (y >= state.height - 4 && rng() < 0.7) continue;
      if (!isBlocked(state, x, y)) candidates.push({ x, y });
    }
  }
  // Shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = tmp;
  }
  return candidates.slice(0, count);
}

export function spawnPickups(
  state: MissionState,
  count: number,
  seed: number,
  idPrefix = 'pk',
): Pickup[] {
  const rng = createRng(seed ^ 0xa11);
  const spots = findPickupSpots(state, count, seed);
  const out: Pickup[] = [];
  let i = 0;
  for (const pos of spots) {
    const kind = KINDS[Math.floor(rng() * KINDS.length)]!;
    const id = `${idPrefix}_${i++}_${kind}`;
    const p: Pickup = {
      id,
      kind,
      pos: { ...pos },
      amount: amountFor(kind, rng),
      collected: false,
    };
    state.pickups.set(id, p);
    out.push(p);
  }
  return out;
}

export function livingPickupCount(state: MissionState): number {
  let n = 0;
  for (const p of state.pickups.values()) {
    if (!p.collected) n++;
  }
  return n;
}

export function pickupAt(state: MissionState, pos: Vec2): Pickup | null {
  const k = keyOf(pos.x, pos.y);
  for (const p of state.pickups.values()) {
    if (!p.collected && keyOf(p.pos.x, p.pos.y) === k) return p;
  }
  return null;
}
