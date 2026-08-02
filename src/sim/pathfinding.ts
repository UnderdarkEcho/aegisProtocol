import { inBounds, keyOf, neighbors4 } from './grid';
import type { MissionState, UnitState, Vec2 } from './types';

export interface PathResult {
  path: Vec2[];
  cost: number;
}

function occupiedSet(state: MissionState, ignoreId?: string): Set<string> {
  const set = new Set<string>();
  for (const u of state.units.values()) {
    if (!u.alive) continue;
    if (ignoreId && u.id === ignoreId) continue;
    set.add(keyOf(u.pos.x, u.pos.y));
  }
  // Intact cover props block standing on them
  for (const p of state.props.values()) {
    if (!p.destroyed) set.add(keyOf(p.pos.x, p.pos.y));
  }
  return set;
}

export function findPath(
  state: MissionState,
  from: Vec2,
  to: Vec2,
  unitId: string,
  maxCost = 99,
  extraBlocked?: Set<string>,
): PathResult | null {
  if (from.x === to.x && from.y === to.y) return { path: [{ ...from }], cost: 0 };
  if (!inBounds(state.width, state.height, to.x, to.y)) return null;
  if (!inBounds(state.width, state.height, from.x, from.y)) return null;
  const dest = state.tiles[to.y]?.[to.x];
  if (!dest?.walkable || dest.blocked) return null;

  const blocked = occupiedSet(state, unitId);
  if (extraBlocked) {
    for (const k of extraBlocked) blocked.add(k);
  }
  const goalKey = keyOf(to.x, to.y);
  if (blocked.has(goalKey)) return null;

  const startKey = keyOf(from.x, from.y);
  const open: Array<{ x: number; y: number; g: number; f: number }> = [
    { x: from.x, y: from.y, g: 0, f: heuristic(from, to) },
  ];
  const came = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!;
    const ck = keyOf(cur.x, cur.y);
    if (ck === goalKey) {
      const path = reconstruct(came, ck, from);
      return { path, cost: cur.g };
    }
    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const n of neighbors4(cur.x, cur.y)) {
      if (!inBounds(state.width, state.height, n.x, n.y)) continue;
      const tile = state.tiles[n.y]![n.x]!;
      if (!tile.walkable || tile.blocked) continue;
      const nk = keyOf(n.x, n.y);
      // Cannot path through occupied tiles (goal already rejected if occupied)
      if (blocked.has(nk)) continue;
      const tg = cur.g + 1;
      if (tg > maxCost) continue;
      if (tg >= (gScore.get(nk) ?? Infinity)) continue;
      came.set(nk, ck);
      gScore.set(nk, tg);
      open.push({ x: n.x, y: n.y, g: tg, f: tg + heuristic(n, to) });
    }
  }
  return null;
}

function heuristic(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstruct(came: Map<string, string>, endKey: string, from: Vec2): Vec2[] {
  const path: Vec2[] = [];
  let cur: string | undefined = endKey;
  while (cur) {
    const [xs, ys] = cur.split(',');
    path.push({ x: Number(xs), y: Number(ys) });
    cur = came.get(cur);
  }
  path.reverse();
  if (path.length === 0) path.push({ ...from });
  return path;
}

/** Blue (1 AP) and yellow (2 AP) reachable tiles. */
export function reachableTiles(
  state: MissionState,
  unit: UnitState,
): { blue: Map<string, PathResult>; yellow: Map<string, PathResult> } {
  const blue = new Map<string, PathResult>();
  const yellow = new Map<string, PathResult>();
  if (!unit.alive || unit.ap <= 0) return { blue, yellow };

  const blueMax = unit.def.mobility;
  const yellowMax = unit.ap >= 2 ? unit.def.mobility * 2 : unit.def.mobility;
  const maxCost = unit.ap >= 2 ? yellowMax : blueMax;

  const blocked = occupiedSet(state, unit.id);
  const startKey = keyOf(unit.pos.x, unit.pos.y);

  // Dijkstra flood
  const gScore = new Map<string, number>([[startKey, 0]]);
  const came = new Map<string, string>();
  const open: Array<{ x: number; y: number; g: number }> = [
    { x: unit.pos.x, y: unit.pos.y, g: 0 },
  ];

  while (open.length) {
    open.sort((a, b) => a.g - b.g);
    const cur = open.shift()!;
    for (const n of neighbors4(cur.x, cur.y)) {
      if (!inBounds(state.width, state.height, n.x, n.y)) continue;
      const tile = state.tiles[n.y]![n.x]!;
      if (!tile.walkable || tile.blocked) continue;
      const nk = keyOf(n.x, n.y);
      if (blocked.has(nk)) continue;
      const tg = cur.g + 1;
      if (tg > maxCost) continue;
      if (tg >= (gScore.get(nk) ?? Infinity)) continue;
      gScore.set(nk, tg);
      came.set(nk, keyOf(cur.x, cur.y));
      open.push({ x: n.x, y: n.y, g: tg });

      const path = reconstruct(came, nk, unit.pos);
      const result = { path, cost: tg };
      if (tg <= blueMax && unit.ap >= 1) blue.set(nk, result);
      if (tg > blueMax && tg <= yellowMax && unit.ap >= 2) yellow.set(nk, result);
    }
  }
  return { blue, yellow };
}
