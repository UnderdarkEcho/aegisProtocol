import { previewShot } from './combat';
import { tileCoverLevel } from './cover';
import { getDifficulty } from './difficulty';
import { keyOf } from './grid';
import { hasLineOfSight } from './los';
import { findPath } from './pathfinding';
import type { Game } from './game';
import type { DifficultyProfile } from './difficulty';
import type { UnitState, Vec2 } from './types';

/**
 * Tactical AI (activated pods only). Behavior scales with mission difficulty.
 * `waitAnim` should resolve when unit path animations finish (keeps camera/action in sync).
 */
export async function runEnemyTurn(
  game: Game,
  delay: (ms: number) => Promise<void>,
  waitAnim: () => Promise<void> = async () => {},
): Promise<void> {
  const profile = getDifficulty(game.state.difficulty);
  const enemies = game.enemyUnits();
  for (const e of enemies) {
    e.ap = e.maxAp;
    e.overwatching = false;
  }

  const reserved = new Set<string>();
  for (const e of enemies) {
    if (e.alive) reserved.add(keyOf(e.pos.x, e.pos.y));
  }

  for (const e of enemies) {
    if (!e.alive) continue;
    if (game.isMissionOver()) break;
    await actEnemy(game, e, delay, waitAnim, reserved, profile);
    await delay(220);
    if (game.isMissionOver()) break;
  }

  if (!game.isMissionOver()) {
    game.endEnemyTurn();
  }
}

async function actEnemy(
  game: Game,
  e: UnitState,
  delay: (ms: number) => Promise<void>,
  waitAnim: () => Promise<void>,
  reserved: Set<string>,
  profile: DifficultyProfile,
) {
  const players = game.playerUnits();
  if (players.length === 0) return;

  if (
    profile.grenadeEnabled &&
    e.ap >= 1 &&
    e.def.abilities.includes('grenade') &&
    (e.cooldowns.grenade ?? 0) <= 0
  ) {
    const gTarget = chooseGrenadeTarget(game, e, players, profile);
    if (gTarget) {
      game.tryEnemyGrenade(e.id, gTarget);
      await delay(420);
      if (e.ap <= 0 || !e.alive) return;
    }
  }

  const shot = bestShot(game, e, players);
  if (shot && shot.preview.hitChance >= profile.shotThreshold && e.ap >= 1) {
    game.tryEnemyShoot(e.id, shot.target.id);
    await delay(400);
    if (e.ap <= 0 || !e.alive) return;
  }

  if (e.ap >= 1) {
    const dest = chooseMove(game, e, players, reserved, profile);
    if (dest) {
      const fromKey = keyOf(e.pos.x, e.pos.y);
      if (game.tryEnemyMove(e.id, dest)) {
        reserved.delete(fromKey);
        reserved.add(keyOf(e.pos.x, e.pos.y));
        await waitAnim();
        await delay(120);
      }
    }
  }

  if (!e.alive || e.ap < 1) return;

  const shot2 = bestShot(game, e, players);
  if (shot2 && shot2.preview.hitChance >= profile.postMoveShotThreshold) {
    game.tryEnemyShoot(e.id, shot2.target.id);
    await delay(400);
  }
}

function bestShot(
  game: Game,
  e: UnitState,
  players: UnitState[],
): { target: UnitState; preview: ReturnType<typeof previewShot> } | null {
  let best: { target: UnitState; preview: ReturnType<typeof previewShot> } | null =
    null;
  for (const p of players) {
    if (!hasLineOfSight(game.state, e.pos, p.pos)) continue;
    const dist = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
    if (dist > e.def.weapon.range + 0.5) continue;
    const preview = previewShot(game.state, e, p);
    // Prefer higher hit chance; on ties, finish wounded targets
    if (
      !best ||
      preview.hitChance > best.preview.hitChance ||
      (preview.hitChance === best.preview.hitChance && p.hp < best.target.hp)
    ) {
      best = { target: p, preview };
    }
  }
  return best;
}

function chooseGrenadeTarget(
  game: Game,
  e: UnitState,
  players: UnitState[],
  profile: DifficultyProfile,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestHits = profile.grenadeMinHits - 1;

  for (const p of players) {
    const dist = Math.hypot(p.pos.x - e.pos.x, p.pos.y - e.pos.y);
    if (dist > 5.5) continue;
    const candidates: Vec2[] = [{ ...p.pos }];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        candidates.push({ x: p.pos.x + dx, y: p.pos.y + dy });
      }
    }
    for (const c of candidates) {
      const throwDist = Math.hypot(c.x - e.pos.x, c.y - e.pos.y);
      if (throwDist > 5.5) continue;
      let hits = 0;
      for (const other of players) {
        const d = Math.hypot(other.pos.x - c.x, other.pos.y - c.y);
        if (d <= 2.1) hits++;
      }
      let friendly = 0;
      for (const ally of game.enemyUnits()) {
        if (ally.id === e.id || !ally.alive) continue;
        const d = Math.hypot(ally.pos.x - c.x, ally.pos.y - c.y);
        if (d <= 2.1) friendly++;
      }
      // Hard: allow 1 friendly fire if hitting many players
      const friendlyOk =
        friendly === 0 ||
        ((profile.id === 'hard' || profile.id === 'extreme') && hits >= 3 && friendly <= 1);
      if (hits > bestHits && friendlyOk) {
        bestHits = hits;
        best = c;
      }
    }
  }
  return bestHits >= profile.grenadeMinHits ? best : null;
}

function chooseMove(
  game: Game,
  e: UnitState,
  players: UnitState[],
  reserved: Set<string>,
  profile: DifficultyProfile,
): Vec2 | null {
  const nearest = players.reduce((a, b) =>
    Math.hypot(a.pos.x - e.pos.x, a.pos.y - e.pos.y) <
    Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y)
      ? a
      : b,
  );

  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  const maxRange = e.def.mobility * Math.min(2, e.ap);
  const selfKey = keyOf(e.pos.x, e.pos.y);

  for (let y = e.pos.y - maxRange; y <= e.pos.y + maxRange; y++) {
    for (let x = e.pos.x - maxRange; x <= e.pos.x + maxRange; x++) {
      if (x === e.pos.x && y === e.pos.y) continue;
      const tile = game.state.tiles[y]?.[x];
      if (!tile?.walkable || tile.blocked) continue;
      const tk = keyOf(x, y);
      if (reserved.has(tk) && tk !== selfKey) continue;
      if (isOccupied(game, x, y, e.id)) continue;

      const path = findPath(game.state, e.pos, { x, y }, e.id, maxRange);
      if (!path) continue;

      let score = 0;
      const coverLv = tileCoverLevel(game.state, x, y);
      if (coverLv === 2) score += profile.coverFullBonus;
      else if (coverLv === 1) score += profile.coverHalfBonus;
      else score -= profile.id === 'easy' ? 2 : 5;

      if (hasLineOfSight(game.state, { x, y }, nearest.pos)) score += 25;
      const distToPlayer = Math.hypot(x - nearest.pos.x, y - nearest.pos.y);
      score += 10 - Math.abs(distToPlayer - 5);
      score -= path.cost;

      if (coverLv === 0 && distToPlayer <= 3) {
        score -= profile.id === 'easy' ? 10 : 25;
      }

      if (hasLineOfSight(game.state, { x, y }, nearest.pos)) {
        const ghost = { ...e, pos: { x, y } };
        const prev = previewShot(game.state, ghost, nearest);
        score += prev.hitChance * profile.hitChanceMoveWeight;
        if (prev.flanked) score += profile.flankMoveBonus;
      }

      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }

  if (best) return best;

  const path = findPath(
    game.state,
    e.pos,
    nearest.pos,
    e.id,
    e.def.mobility,
  );
  if (path && path.path.length > 1) {
    const step = path.path[Math.min(path.path.length - 1, e.def.mobility)]!;
    const sk = keyOf(step.x, step.y);
    if (reserved.has(sk) && sk !== selfKey) {
      for (let i = Math.min(path.path.length - 1, e.def.mobility); i >= 1; i--) {
        const s = path.path[i]!;
        const k = keyOf(s.x, s.y);
        if (reserved.has(k) && k !== selfKey) continue;
        if (s.x === nearest.pos.x && s.y === nearest.pos.y) continue;
        return s;
      }
      return null;
    }
    if (!(step.x === nearest.pos.x && step.y === nearest.pos.y)) return step;
    if (path.path.length > 2) return path.path[path.path.length - 2]!;
  }
  return null;
}

function isOccupied(game: Game, x: number, y: number, ignoreId?: string): boolean {
  const k = keyOf(x, y);
  for (const u of game.state.units.values()) {
    if (!u.alive) continue;
    if (ignoreId && u.id === ignoreId) continue;
    if (keyOf(u.pos.x, u.pos.y) === k) return true;
  }
  for (const p of game.state.props.values()) {
    if (!p.destroyed && keyOf(p.pos.x, p.pos.y) === k) return true;
  }
  return false;
}
