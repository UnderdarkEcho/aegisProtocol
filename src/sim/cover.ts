import { distEuclidean } from './grid';
import type { CoverEdge, CoverLevel, MissionState, UnitState, Vec2 } from './types';

const COVER_PENALTY: Record<CoverLevel, number> = {
  0: 0,
  1: 20,
  2: 40,
};

/**
 * Best cover for defender against attacker.
 * Cover only applies if the prop sits between attacker and defender (roughly).
 *
 * Cover edge `dir` is the facing from the standing tile toward the prop.
 * Fire from that hemisphere is blocked; fire from the open side is a flank.
 */
export function getDefensiveCover(
  state: MissionState,
  defender: UnitState,
  attackerPos: Vec2,
): { level: CoverLevel; penalty: number; edge: CoverEdge | null; flanked: boolean } {
  const tile = state.tiles[defender.pos.y]?.[defender.pos.x];
  if (!tile || tile.cover.length === 0) {
    return { level: 0, penalty: 0, edge: null, flanked: false };
  }

  const dx = attackerPos.x - defender.pos.x;
  const dy = attackerPos.y - defender.pos.y;

  // Live edges only (prop still intact)
  const liveEdges = tile.cover.filter((edge) => {
    const prop = state.props.get(edge.propId);
    return prop != null && !prop.destroyed;
  });
  if (liveEdges.length === 0) {
    return { level: 0, penalty: 0, edge: null, flanked: false };
  }

  let best: CoverEdge | null = null;
  let bestLevel: CoverLevel = 0;

  for (const edge of liveEdges) {
    // Does this cover face the attacker?
    const facesAttacker =
      (edge.dir === 'N' && dy < 0) ||
      (edge.dir === 'S' && dy > 0) ||
      (edge.dir === 'E' && dx > 0) ||
      (edge.dir === 'W' && dx < 0);

    if (facesAttacker && edge.level > bestLevel) {
      bestLevel = edge.level;
      best = edge;
    }
  }

  if (!best) {
    // Has cover somewhere but not vs this attacker → flanked
    return { level: 0, penalty: 0, edge: null, flanked: true };
  }

  // Flank if attacker is more than ~45° off the cover normal
  const flanked = isFlankingAngle(best.dir, dx, dy);

  if (flanked) {
    return { level: 0, penalty: 0, edge: best, flanked: true };
  }

  return {
    level: bestLevel,
    penalty: COVER_PENALTY[bestLevel],
    edge: best,
    flanked: false,
  };
}

/** Highest intact cover level on a tile (for AI scoring). */
export function tileCoverLevel(state: MissionState, x: number, y: number): CoverLevel {
  const tile = state.tiles[y]?.[x];
  if (!tile) return 0;
  let best: CoverLevel = 0;
  for (const edge of tile.cover) {
    const prop = state.props.get(edge.propId);
    if (!prop || prop.destroyed) continue;
    if (edge.level > best) best = edge.level;
  }
  return best;
}

function isFlankingAngle(dir: CoverEdge['dir'], dx: number, dy: number): boolean {
  // Flank if the dominant axis of attack is perpendicular to cover facing
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (dir === 'N' || dir === 'S') {
    // Cover faces N/S; flank if mostly from E/W
    return adx > ady;
  }
  // Cover faces E/W; flank if mostly from N/S
  return ady > adx;
}

export function rangeModifier(dist: number, weaponRange: number): number {
  if (dist <= 1) return 10;
  if (dist <= weaponRange * 0.5) return 0;
  if (dist <= weaponRange) return -10;
  if (dist <= weaponRange + 2) return -25;
  return -80;
}

export function shotDistance(a: Vec2, b: Vec2): number {
  return distEuclidean(a, b);
}
