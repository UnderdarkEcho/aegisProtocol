import { inBounds, keyOf } from './grid';
import type { MissionState, Vec2 } from './types';

/** Bresenham LOS. Cover props block vision; walls block. */
export function hasLineOfSight(
  state: MissionState,
  from: Vec2,
  to: Vec2,
  opts?: { ignoreProps?: boolean },
): boolean {
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
    if (x0 === x1 && y0 === y1) return true;
    if (!inBounds(state.width, state.height, x0, y0)) return false;
    const tile = state.tiles[y0]![x0]!;
    if (tile.blocked) return false;
    if (!opts?.ignoreProps) {
      for (const p of state.props.values()) {
        if (!p.destroyed && p.pos.x === x0 && p.pos.y === y0 && p.level >= 2) {
          return false;
        }
      }
    }
  }
  return true;
}

export function visibleTilesFrom(
  state: MissionState,
  origin: Vec2,
  sight: number,
): Set<string> {
  const visible = new Set<string>();
  for (let y = origin.y - sight; y <= origin.y + sight; y++) {
    for (let x = origin.x - sight; x <= origin.x + sight; x++) {
      if (!inBounds(state.width, state.height, x, y)) continue;
      const d = Math.hypot(x - origin.x, y - origin.y);
      if (d > sight + 0.01) continue;
      if (hasLineOfSight(state, origin, { x, y })) {
        visible.add(keyOf(x, y));
      }
    }
  }
  return visible;
}

export function computePlayerVision(state: MissionState): {
  tiles: Set<string>;
  enemyIds: Set<string>;
} {
  const tiles = new Set<string>();
  const enemyIds = new Set<string>();
  for (const u of state.units.values()) {
    if (!u.alive || u.def.team !== 'player') continue;
    const vis = visibleTilesFrom(state, u.pos, u.def.sight);
    for (const t of vis) tiles.add(t);
  }
  for (const e of state.units.values()) {
    if (!e.alive || e.def.team !== 'enemy') continue;
    if (tiles.has(keyOf(e.pos.x, e.pos.y))) enemyIds.add(e.id);
  }
  return { tiles, enemyIds };
}
