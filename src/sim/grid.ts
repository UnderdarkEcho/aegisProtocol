import type { CoverEdge, CoverProp, Tile, Vec2 } from './types';

export const TILE = 1;

export function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

export function keyVec(v: Vec2): string {
  return keyOf(v.x, v.y);
}

export function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export function distChebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function distManhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function distEuclidean(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

const DIRS: Array<{ dir: CoverEdge['dir']; dx: number; dy: number }> = [
  { dir: 'N', dx: 0, dy: -1 },
  { dir: 'S', dx: 0, dy: 1 },
  { dir: 'E', dx: 1, dy: 0 },
  { dir: 'W', dx: -1, dy: 0 },
];

export function createEmptyTiles(w: number, h: number): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ x, y, walkable: true, blocked: false, cover: [] });
    }
    tiles.push(row);
  }
  return tiles;
}

/** Attach cover edges to tiles adjacent to props. */
export function rebuildCoverEdges(
  tiles: Tile[][],
  props: Map<string, CoverProp>,
): void {
  for (const row of tiles) {
    for (const t of row) t.cover = [];
  }

  for (const prop of props.values()) {
    if (prop.destroyed) continue;
    for (const { dir, dx, dy } of DIRS) {
      const tx = prop.pos.x + dx;
      const ty = prop.pos.y + dy;
      const row = tiles[ty];
      const tile = row?.[tx];
      if (!tile || !tile.walkable) continue;
      // Cover faces the prop: from tile, cover is in opposite dir of approach to prop
      const faceDir = opposite(dir);
      tile.cover.push({ dir: faceDir, level: prop.level, propId: prop.id });
    }
  }
}

function opposite(d: CoverEdge['dir']): CoverEdge['dir'] {
  if (d === 'N') return 'S';
  if (d === 'S') return 'N';
  if (d === 'E') return 'W';
  return 'E';
}

export function neighbors4(x: number, y: number): Vec2[] {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

export function neighbors8(x: number, y: number): Vec2[] {
  const out: Vec2[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      out.push({ x: x + dx, y: y + dy });
    }
  }
  return out;
}
