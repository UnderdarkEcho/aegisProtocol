import { getDifficulty } from '../sim/difficulty';
import { createEmptyTiles, rebuildCoverEdges } from '../sim/grid';
import { spawnPickups } from '../sim/pickups';
import {
  applyLoadoutToDef,
  applyLoadoutToUnit,
  type LoadoutState,
} from '../sim/loadout';
import {
  applyWoundDebuffs,
  buildSoldierAtLevel,
  levelFromXp,
  sanitizeXp,
  SQUAD_TEMPLATE,
  type SquadRoster,
} from '../sim/progression';
import type {
  CoverProp,
  DifficultyId,
  MissionState,
  MissionType,
  Pod,
  Tile,
  UnitState,
  Vec2,
} from '../sim/types';
import { makeEnemy, makeSoldier, scaleEnemyForDifficulty } from './classes';

// ── Map catalog ───────────────────────────────────────────

export type MapId = 'training' | 'vesper' | 'kernel' | 'tutorial';

export interface MapInfo {
  id: MapId;
  name: string;
  /** Short chip label */
  short: string;
  blurb: string;
  /** 1 = tutorial-ish, 3 = multi-pod maze */
  complexity: 1 | 2 | 3;
}

export const MAPS: Record<MapId, MapInfo> = {
  training: {
    id: 'training',
    name: 'PIN PAD · ALPHA',
    short: 'PIN PAD',
    blurb: 'Open test die — short port run. link.sys + hold 1 hostile cycle, or wipe.',
    complexity: 1,
  },
  tutorial: {
    id: 'tutorial',
    name: 'TUTORIAL DIE',
    short: 'TUTORIAL',
    blurb:
      'Guided first breach — one weak pod, short path to the data port. Practice only (no XP / records).',
    complexity: 1,
  },
  vesper: {
    id: 'vesper',
    name: 'NODE VESPER',
    short: 'VESPER',
    blurb: 'Contested corporate die — courtyard, office, mech bay. Port: link.sys + 2 holds.',
    complexity: 2,
  },
  kernel: {
    id: 'kernel',
    name: 'KERNEL STACK',
    short: 'KERNEL',
    blurb: 'Deep stack maze — dual guards, long corridor. Port needs link.sys + 2 holds.',
    complexity: 3,
  },
};

/** Skirmish picker order (tutorial map is play-mode only). */
export const MAP_ORDER: MapId[] = ['training', 'vesper', 'kernel'];

export function getMapInfo(id: MapId): MapInfo {
  return MAPS[id] ?? MAPS.vesper;
}

/** Default ICE wake timer (player cycles) for deadline missions by map. */
export function defaultTurnLimit(mapId: MapId): number {
  switch (mapId) {
    case 'training':
    case 'tutorial':
      return 10;
    case 'kernel':
      return 16;
    case 'vesper':
    default:
      return 12;
  }
}

// ── Geometry helpers ──────────────────────────────────────

function prop(
  id: string,
  x: number,
  y: number,
  level: 1 | 2,
  kind: CoverProp['kind'],
): CoverProp {
  return {
    id,
    pos: { x, y },
    level,
    hp: level === 2 ? 4 : 2,
    maxHp: level === 2 ? 4 : 2,
    destroyed: false,
    kind,
  };
}

function blockRect(tiles: Tile[][], x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = tiles[y]?.[x];
      if (!t) continue;
      t.walkable = false;
      t.blocked = true;
    }
  }
}

function openDoor(tiles: Tile[][], x: number, y: number) {
  const t = tiles[y]?.[x];
  if (!t) return;
  t.walkable = true;
  t.blocked = false;
}

/** Hollow a room interior after blockRect (walls stay blocked around edges). */
function openInterior(
  tiles: Tile[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      openDoor(tiles, x, y);
    }
  }
}

function unitFromDef(
  def: ReturnType<typeof makeSoldier>,
  pos: Vec2,
  podId: string | null,
  progress?: { level: number; xp: number; wounded?: boolean },
): UnitState {
  return {
    def,
    id: def.id,
    pos: { ...pos },
    hp: def.maxHp,
    ap: 2,
    maxAp: 2,
    alive: true,
    overwatching: false,
    suppressed: false,
    inSmoke: false,
    hunkered: false,
    podId,
    activated: def.team === 'player',
    cooldowns: {},
    level: progress?.level ?? 1,
    xp: progress?.xp ?? 0,
    missionXp: 0,
    wounded: Boolean(progress?.wounded),
  };
}

function enemyUnit(
  kind: 'pmc' | 'drone' | 'mech',
  id: string,
  name: string,
  pos: Vec2,
  podId: string,
  difficulty: DifficultyId,
): UnitState {
  const profile = getDifficulty(difficulty);
  const def = scaleEnemyForDifficulty(makeEnemy(kind, id, name), profile);
  const u = unitFromDef(def, pos, podId);
  u.activated = false;
  return u;
}

function perimeter(tiles: Tile[][], w: number, h: number) {
  blockRect(tiles, 0, 0, w - 1, 0);
  blockRect(tiles, 0, h - 1, w - 1, h - 1);
  blockRect(tiles, 0, 0, 0, h - 1);
  blockRect(tiles, w - 1, 0, w - 1, h - 1);
}

function clearPortTiles(
  tiles: Tile[][],
  props: Map<string, CoverProp>,
  ports: Vec2[],
) {
  for (const t of ports) {
    openDoor(tiles, t.x, t.y);
    for (const [id, p] of props) {
      if (p.pos.x === t.x && p.pos.y === t.y) props.delete(id);
    }
  }
}

// ── Layout builders ───────────────────────────────────────

interface LayoutResult {
  width: number;
  height: number;
  tiles: Tile[][];
  props: Map<string, CoverProp>;
  units: Map<string, UnitState>;
  pods: Map<string, Pod>;
  extractTiles: Vec2[];
  dataPortTiles: Vec2[];
  squadSpawns: Vec2[];
  pickupCount: number;
}

type EnemySpec = {
  kind: 'pmc' | 'drone' | 'mech';
  id: string;
  name: string;
  pos: Vec2;
  podId: string;
};

function placeEnemies(
  units: Map<string, UnitState>,
  pods: Map<string, Pod>,
  difficulty: DifficultyId,
  podList: { id: string; members: EnemySpec[] }[],
) {
  for (const pod of podList) {
    pods.set(pod.id, {
      id: pod.id,
      memberIds: pod.members.map((m) => m.id),
      activated: false,
    });
    for (const m of pod.members) {
      units.set(
        m.id,
        enemyUnit(m.kind, m.id, m.name, m.pos, m.podId, difficulty),
      );
    }
  }
}

/** Shared open-pad geometry used by training + tutorial. */
function buildOpenPadBase(): {
  width: number;
  height: number;
  tiles: Tile[][];
  props: Map<string, CoverProp>;
  extractTiles: Vec2[];
  dataPortTiles: Vec2[];
  squadSpawns: Vec2[];
} {
  const W = 20;
  const H = 16;
  const tiles = createEmptyTiles(W, H);
  perimeter(tiles, W, H);

  // One small west shack
  blockRect(tiles, 2, 5, 5, 8);
  openDoor(tiles, 5, 6);
  openInterior(tiles, 3, 6, 4, 7);

  // Light midfield cover — open LOS, learn flanks
  const props = new Map<string, CoverProp>();
  const add = (p: CoverProp) => props.set(p.id, p);
  add(prop('t1', 8, 12, 1, 'crate'));
  add(prop('t2', 11, 12, 1, 'crate'));
  add(prop('t3', 9, 10, 1, 'sandbag'));
  add(prop('t4', 12, 9, 2, 'barrier'));
  add(prop('t5', 7, 8, 1, 'crate'));
  add(prop('t6', 14, 8, 1, 'crate'));
  add(prop('t7', 10, 6, 1, 'sandbag'));
  add(prop('t8', 6, 11, 1, 'sandbag'));
  rebuildCoverEdges(tiles, props);

  const extractTiles: Vec2[] = [
    { x: 8, y: 13 },
    { x: 9, y: 13 },
    { x: 10, y: 14 },
    { x: 11, y: 14 },
  ];
  const dataPortTiles: Vec2[] = [
    { x: 9, y: 1 },
    { x: 10, y: 1 },
    { x: 9, y: 2 },
    { x: 10, y: 2 },
  ];
  for (let y = 1; y <= 3; y++) {
    openDoor(tiles, 9, y);
    openDoor(tiles, 10, y);
  }
  clearPortTiles(tiles, props, dataPortTiles);
  rebuildCoverEdges(tiles, props);

  return {
    width: W,
    height: H,
    tiles,
    props,
    extractTiles,
    dataPortTiles,
    squadSpawns: [
      { x: 8, y: 13 },
      { x: 9, y: 14 },
      { x: 10, y: 13 },
      { x: 11, y: 14 },
    ],
  };
}

/** Simple open pad — short breach, two pods (campaign OP-01 / skirmish). */
function buildTraining(difficulty: DifficultyId): LayoutResult {
  const base = buildOpenPadBase();
  const units = new Map<string, UnitState>();
  const pods = new Map<string, Pod>();

  placeEnemies(units, pods, difficulty, [
    {
      id: 'podA',
      members: [
        { kind: 'pmc', id: 'e_pmc1', name: 'WARDEN-01', pos: { x: 9, y: 6 }, podId: 'podA' },
        { kind: 'pmc', id: 'e_pmc2', name: 'WARDEN-02', pos: { x: 11, y: 5 }, podId: 'podA' },
        { kind: 'drone', id: 'e_drone1', name: 'SCRAPE-A', pos: { x: 10, y: 4 }, podId: 'podA' },
      ],
    },
    {
      id: 'podB',
      members: [
        {
          kind: 'drone',
          id: 'e_drone2',
          name: 'SCRAPE-B',
          pos: { x: 15, y: 3 },
          podId: 'podB',
        },
      ],
    },
  ]);

  return {
    ...base,
    units,
    pods,
    pickupCount: 3,
  };
}

/** Guided first breach — one weak pod, same pad geometry. */
function buildTutorial(difficulty: DifficultyId): LayoutResult {
  const base = buildOpenPadBase();
  const units = new Map<string, UnitState>();
  const pods = new Map<string, Pod>();

  placeEnemies(units, pods, difficulty, [
    {
      id: 'podA',
      members: [
        { kind: 'pmc', id: 'e_pmc1', name: 'WARDEN-01', pos: { x: 9, y: 6 }, podId: 'podA' },
        { kind: 'drone', id: 'e_drone1', name: 'SCRAPE-A', pos: { x: 11, y: 5 }, podId: 'podA' },
      ],
    },
  ]);

  return {
    ...base,
    units,
    pods,
    pickupCount: 2,
  };
}

/**
 * Medium corporate facility — original Node Vesper layout.
 * Tests depend on these coordinates; keep stable.
 */
function buildVesper(difficulty: DifficultyId): LayoutResult {
  const W = 28;
  const H = 24;
  const tiles = createEmptyTiles(W, H);
  perimeter(tiles, W, H);

  blockRect(tiles, 4, 4, 9, 8); // west warehouse
  blockRect(tiles, 18, 3, 24, 7); // east office
  blockRect(tiles, 12, 12, 16, 16); // center server block
  blockRect(tiles, 3, 14, 6, 18); // south garage
  blockRect(tiles, 20, 14, 24, 19); // mech bay shell

  openDoor(tiles, 6, 8);
  openDoor(tiles, 9, 6);
  openDoor(tiles, 18, 5);
  openDoor(tiles, 21, 7);
  openDoor(tiles, 14, 12);
  openDoor(tiles, 12, 14);
  openDoor(tiles, 5, 14);
  openDoor(tiles, 20, 16);

  openInterior(tiles, 5, 5, 8, 7);
  openInterior(tiles, 19, 4, 23, 6);
  openInterior(tiles, 13, 13, 15, 15);
  openInterior(tiles, 4, 15, 5, 17);
  openInterior(tiles, 21, 15, 23, 18);

  const props = new Map<string, CoverProp>();
  const add = (p: CoverProp) => props.set(p.id, p);

  add(prop('c1', 10, 20, 1, 'crate'));
  add(prop('c2', 12, 20, 1, 'crate'));
  add(prop('c3', 14, 21, 1, 'crate'));
  add(prop('c4', 8, 19, 1, 'sandbag'));
  add(prop('c5', 16, 19, 1, 'sandbag'));

  add(prop('b1', 10, 14, 2, 'barrier'));
  add(prop('b2', 11, 11, 1, 'crate'));
  add(prop('b3', 17, 11, 1, 'crate'));
  add(prop('b4', 17, 14, 2, 'barrier'));
  add(prop('b5', 8, 11, 1, 'crate'));
  add(prop('b6', 19, 10, 1, 'vehicle'));
  add(prop('b7', 7, 16, 1, 'sandbag'));
  add(prop('b8', 15, 9, 1, 'crate'));
  add(prop('b9', 13, 18, 1, 'crate'));
  add(prop('b10', 11, 8, 2, 'barrier'));
  add(prop('b11', 16, 8, 1, 'crate'));
  add(prop('b12', 9, 13, 1, 'sandbag'));
  add(prop('b13', 18, 13, 1, 'sandbag'));
  add(prop('b14', 14, 6, 1, 'crate'));
  add(prop('b15', 10, 6, 1, 'crate'));
  add(prop('b16', 6, 10, 2, 'barrier'));
  add(prop('b17', 22, 11, 1, 'crate'));
  add(prop('b18', 21, 9, 1, 'sandbag'));
  add(prop('b19', 4, 11, 1, 'crate'));
  add(prop('b20', 15, 17, 2, 'barrier'));
  add(prop('b21', 22, 16, 2, 'barrier'));
  add(prop('b22', 23, 17, 1, 'crate'));

  rebuildCoverEdges(tiles, props);

  const units = new Map<string, UnitState>();
  const pods = new Map<string, Pod>();

  placeEnemies(units, pods, difficulty, [
    {
      id: 'podA',
      members: [
        { kind: 'pmc', id: 'e_pmc1', name: 'WARDEN-01', pos: { x: 11, y: 10 }, podId: 'podA' },
        { kind: 'pmc', id: 'e_pmc2', name: 'WARDEN-02', pos: { x: 13, y: 9 }, podId: 'podA' },
        { kind: 'drone', id: 'e_drone1', name: 'SCRAPE-A', pos: { x: 12, y: 8 }, podId: 'podA' },
      ],
    },
    {
      id: 'podB',
      members: [
        { kind: 'pmc', id: 'e_pmc3', name: 'WARDEN-03', pos: { x: 21, y: 5 }, podId: 'podB' },
        { kind: 'pmc', id: 'e_pmc4', name: 'WARDEN-04', pos: { x: 22, y: 6 }, podId: 'podB' },
      ],
    },
    {
      id: 'podC',
      members: [
        { kind: 'mech', id: 'e_mech1', name: 'KERNEL-X', pos: { x: 22, y: 17 }, podId: 'podC' },
        { kind: 'drone', id: 'e_drone2', name: 'SCRAPE-B', pos: { x: 23, y: 18 }, podId: 'podC' },
      ],
    },
  ]);

  const extractTiles: Vec2[] = [
    { x: 12, y: 21 },
    { x: 13, y: 21 },
    { x: 12, y: 22 },
    { x: 13, y: 22 },
  ];

  for (let y = 1; y <= 4; y++) {
    openDoor(tiles, 13, y);
    openDoor(tiles, 14, y);
  }
  const dataPortTiles: Vec2[] = [
    { x: 13, y: 2 },
    { x: 14, y: 2 },
    { x: 13, y: 3 },
    { x: 14, y: 3 },
  ];
  clearPortTiles(tiles, props, dataPortTiles);
  rebuildCoverEdges(tiles, props);

  return {
    width: W,
    height: H,
    tiles,
    props,
    units,
    pods,
    extractTiles,
    dataPortTiles,
    squadSpawns: [
      { x: 11, y: 21 },
      { x: 12, y: 22 },
      { x: 13, y: 21 },
      { x: 14, y: 22 },
    ],
    pickupCount: 4 + 1, // base; seed still varies slightly in createMission
  };
}

/**
 * Complex deep stack — rooms, chokepoints, dual mechs.
 * `branch` from campaign OP-02 path:
 * - stealth: thinner response (no spine pod E, one kernel mech)
 * - loud: full alert (+ response pod F)
 * - null/default: full base layout (skirmish)
 */
function buildKernel(
  difficulty: DifficultyId,
  branch: 'stealth' | 'loud' | null = null,
): LayoutResult {
  const W = 30;
  const H = 26;
  const tiles = createEmptyTiles(W, H);
  perimeter(tiles, W, H);

  // West server farm
  blockRect(tiles, 2, 3, 8, 9);
  openDoor(tiles, 8, 6);
  openDoor(tiles, 5, 9);
  openInterior(tiles, 3, 4, 7, 8);

  // Center spine wall with gaps
  blockRect(tiles, 13, 4, 15, 12);
  openDoor(tiles, 14, 4);
  openDoor(tiles, 14, 8);
  openDoor(tiles, 14, 12);

  // East archives
  blockRect(tiles, 20, 2, 27, 8);
  openDoor(tiles, 20, 5);
  openDoor(tiles, 23, 8);
  openInterior(tiles, 21, 3, 26, 7);

  // South-west bunker
  blockRect(tiles, 2, 14, 7, 20);
  openDoor(tiles, 7, 17);
  openDoor(tiles, 4, 14);
  openInterior(tiles, 3, 15, 6, 19);

  // South-east dual mech vault
  blockRect(tiles, 20, 14, 27, 22);
  openDoor(tiles, 20, 18);
  openDoor(tiles, 23, 14);
  openInterior(tiles, 21, 15, 26, 21);

  // North choke toward port
  blockRect(tiles, 10, 1, 12, 3);
  blockRect(tiles, 17, 1, 19, 3);
  openDoor(tiles, 13, 2);
  openDoor(tiles, 14, 2);
  openDoor(tiles, 15, 2);
  openDoor(tiles, 16, 2);

  const props = new Map<string, CoverProp>();
  const add = (p: CoverProp) => props.set(p.id, p);

  // Staging
  add(prop('k1', 12, 22, 1, 'crate'));
  add(prop('k2', 14, 22, 1, 'crate'));
  add(prop('k3', 16, 21, 1, 'sandbag'));
  add(prop('k4', 10, 20, 1, 'sandbag'));
  add(prop('k5', 18, 20, 2, 'barrier'));

  // Midfield gauntlet
  add(prop('k6', 10, 16, 2, 'barrier'));
  add(prop('k7', 12, 15, 1, 'crate'));
  add(prop('k8', 16, 15, 1, 'crate'));
  add(prop('k9', 18, 16, 2, 'barrier'));
  add(prop('k10', 14, 13, 1, 'sandbag'));
  add(prop('k11', 11, 12, 1, 'crate'));
  add(prop('k12', 17, 12, 1, 'crate'));
  add(prop('k13', 9, 10, 2, 'barrier'));
  add(prop('k14', 19, 10, 2, 'barrier'));
  add(prop('k15', 14, 9, 1, 'vehicle'));
  add(prop('k16', 12, 7, 1, 'crate'));
  add(prop('k17', 16, 7, 1, 'crate'));
  add(prop('k18', 14, 5, 1, 'sandbag'));

  // Room interiors
  add(prop('k19', 5, 6, 1, 'crate'));
  add(prop('k20', 6, 7, 2, 'barrier'));
  add(prop('k21', 23, 5, 1, 'crate'));
  add(prop('k22', 24, 6, 1, 'sandbag'));
  add(prop('k23', 4, 17, 1, 'crate'));
  add(prop('k24', 5, 18, 2, 'barrier'));
  add(prop('k25', 23, 17, 2, 'barrier'));
  add(prop('k26', 24, 19, 1, 'crate'));
  add(prop('k27', 25, 16, 1, 'sandbag'));
  add(prop('k28', 22, 20, 1, 'crate'));

  rebuildCoverEdges(tiles, props);

  const units = new Map<string, UnitState>();
  const pods = new Map<string, Pod>();

  type PodSpec = {
    id: string;
    members: Array<{
      kind: 'pmc' | 'drone' | 'mech';
      id: string;
      name: string;
      pos: Vec2;
      podId: string;
    }>;
  };

  const podsList: PodSpec[] = [
    {
      id: 'podA',
      members: [
        { kind: 'pmc', id: 'e_pmc1', name: 'WARDEN-01', pos: { x: 11, y: 14 }, podId: 'podA' },
        { kind: 'pmc', id: 'e_pmc2', name: 'WARDEN-02', pos: { x: 13, y: 13 }, podId: 'podA' },
        { kind: 'drone', id: 'e_drone1', name: 'SCRAPE-A', pos: { x: 15, y: 14 }, podId: 'podA' },
      ],
    },
    {
      id: 'podB',
      members: [
        { kind: 'pmc', id: 'e_pmc3', name: 'WARDEN-03', pos: { x: 4, y: 6 }, podId: 'podB' },
        { kind: 'pmc', id: 'e_pmc4', name: 'WARDEN-04', pos: { x: 6, y: 5 }, podId: 'podB' },
        { kind: 'drone', id: 'e_drone2', name: 'SCRAPE-B', pos: { x: 5, y: 7 }, podId: 'podB' },
      ],
    },
    {
      id: 'podC',
      members: [
        { kind: 'pmc', id: 'e_pmc5', name: 'WARDEN-05', pos: { x: 23, y: 4 }, podId: 'podC' },
        { kind: 'drone', id: 'e_drone3', name: 'SCRAPE-C', pos: { x: 25, y: 5 }, podId: 'podC' },
      ],
    },
  ];

  // Kernel vault — stealth: single hammer; loud/default: dual hammers
  if (branch === 'stealth') {
    podsList.push({
      id: 'podD',
      members: [
        { kind: 'mech', id: 'e_mech1', name: 'KERNEL-X', pos: { x: 23, y: 18 }, podId: 'podD' },
        { kind: 'drone', id: 'e_drone4', name: 'SCRAPE-D', pos: { x: 22, y: 17 }, podId: 'podD' },
      ],
    });
    // No spine pod E on quiet approach
  } else {
    podsList.push({
      id: 'podD',
      members: [
        { kind: 'mech', id: 'e_mech1', name: 'KERNEL-X', pos: { x: 23, y: 18 }, podId: 'podD' },
        { kind: 'mech', id: 'e_mech2', name: 'KERNEL-Y', pos: { x: 25, y: 19 }, podId: 'podD' },
        { kind: 'drone', id: 'e_drone4', name: 'SCRAPE-D', pos: { x: 22, y: 17 }, podId: 'podD' },
      ],
    });
    podsList.push({
      id: 'podE',
      members: [
        { kind: 'pmc', id: 'e_pmc6', name: 'WARDEN-06', pos: { x: 12, y: 6 }, podId: 'podE' },
        { kind: 'drone', id: 'e_drone5', name: 'SCRAPE-E', pos: { x: 16, y: 5 }, podId: 'podE' },
      ],
    });
  }

  // Loud alert: extra response pod mid-spine
  if (branch === 'loud') {
    podsList.push({
      id: 'podF',
      members: [
        { kind: 'pmc', id: 'e_pmc7', name: 'WARDEN-07', pos: { x: 11, y: 10 }, podId: 'podF' },
        { kind: 'pmc', id: 'e_pmc8', name: 'WARDEN-08', pos: { x: 17, y: 10 }, podId: 'podF' },
        { kind: 'drone', id: 'e_drone6', name: 'SCRAPE-F', pos: { x: 14, y: 11 }, podId: 'podF' },
      ],
    });
  }

  placeEnemies(units, pods, difficulty, podsList);

  const extractTiles: Vec2[] = [
    { x: 13, y: 23 },
    { x: 14, y: 23 },
    { x: 13, y: 24 },
    { x: 14, y: 24 },
  ];

  // Port approach corridor
  for (let y = 1; y <= 5; y++) {
    openDoor(tiles, 13, y);
    openDoor(tiles, 14, y);
    openDoor(tiles, 15, y);
    openDoor(tiles, 16, y);
  }
  const dataPortTiles: Vec2[] = [
    { x: 14, y: 1 },
    { x: 15, y: 1 },
    { x: 14, y: 2 },
    { x: 15, y: 2 },
  ];
  clearPortTiles(tiles, props, dataPortTiles);
  rebuildCoverEdges(tiles, props);

  return {
    width: W,
    height: H,
    tiles,
    props,
    units,
    pods,
    extractTiles,
    dataPortTiles,
    squadSpawns: [
      { x: 12, y: 23 },
      { x: 13, y: 24 },
      { x: 14, y: 23 },
      { x: 15, y: 24 },
    ],
    pickupCount: branch === 'stealth' ? 5 : branch === 'loud' ? 7 : 6,
  };
}

function buildLayout(
  mapId: MapId,
  difficulty: DifficultyId,
  kernelBranch: 'stealth' | 'loud' | null = null,
): LayoutResult {
  switch (mapId) {
    case 'training':
      return buildTraining(difficulty);
    case 'tutorial':
      return buildTutorial(difficulty);
    case 'kernel':
      return buildKernel(difficulty, kernelBranch);
    case 'vesper':
    default:
      return buildVesper(difficulty);
  }
}

// ── Public factory ────────────────────────────────────────

export interface MissionOptions {
  /** When set, players spawn at roster XP/level with ability gating. */
  roster?: SquadRoster;
  /**
   * Gate player abilities by level. Default: true when roster is provided,
   * false otherwise (tests keep full class kits).
   */
  gateAbilities?: boolean;
  /** Map layout. Default: vesper (preserves test coordinates). */
  mapId?: MapId;
  /** How the mission was launched. Default: skirmish. */
  playMode?: 'campaign' | 'skirmish' | 'tutorial';
  /** Campaign op id when playMode is campaign. */
  campaignOpId?: string;
  /** Objective type. Default: standard. */
  missionType?: MissionType;
  /** Override cycle limit for deadline (else map default). */
  turnLimit?: number | null;
  /** Squad loadout gear from the shop. */
  loadout?: LoadoutState;
  /**
   * Campaign branch for Kernel (from OP-02 Vesper win path).
   * Ignored on non-kernel maps.
   */
  kernelBranch?: 'stealth' | 'loud' | null;
}

/** Build a mission on the selected map. */
export function createMission(
  seed = 0xae91,
  difficulty: DifficultyId = 'normal',
  options: MissionOptions = {},
): MissionState {
  const mapId: MapId = options.mapId ?? 'vesper';
  const layout = buildLayout(mapId, difficulty, options.kernelBranch ?? null);

  const gate = options.gateAbilities ?? options.roster !== undefined;
  const rosterById = new Map(
    (options.roster?.operatives ?? []).map((o) => [o.id, o]),
  );

  for (let i = 0; i < SQUAD_TEMPLATE.length; i++) {
    const s = SQUAD_TEMPLATE[i]!;
    const pos = layout.squadSpawns[i] ?? layout.extractTiles[0]!;
    const row = rosterById.get(s.id);
    const xp = sanitizeXp(row?.xp ?? 0);
    const level = levelFromXp(xp);
    // Always use process callsign from template (not stale roster strings)
    const name = s.name;
    const wounded = Boolean(row?.wounded);
    let def = gate
      ? buildSoldierAtLevel(s.classId, s.id, name, level, { gateAbilities: true })
      : makeSoldier(s.classId, s.id, name);
    if (!gate && level > 1) {
      def = buildSoldierAtLevel(s.classId, s.id, name, level, { gateAbilities: false });
    }
    // Prior crash → deploy with integrity / ACC / mobility damage
    if (wounded) def = applyWoundDebuffs(def);
    // Shop gear applies after wounds so +armor still helps injured probes
    if (options.loadout) def = applyLoadoutToDef(def, options.loadout);
    const u = unitFromDef(def, pos, null, { level, xp, wounded });
    if (options.loadout) applyLoadoutToUnit(u, options.loadout);
    layout.units.set(s.id, u);
  }

  const explored = Array.from({ length: layout.height }, () =>
    Array.from({ length: layout.width }, () => false),
  );

  const state: MissionState = {
    width: layout.width,
    height: layout.height,
    tiles: layout.tiles,
    props: layout.props,
    units: layout.units,
    pods: layout.pods,
    phase: 'briefing',
    selectedId: 'p_breach',
    turn: 1,
    visibleEnemyIds: new Set(),
    visibleTiles: new Set(),
    lastKnownEnemyPos: new Map(),
    explored,
    smokeTiles: new Set(),
    extractTiles: layout.extractTiles,
    dataPortTiles: layout.dataPortTiles,
    pickups: new Map(),
    seed,
    log: [],
    difficulty,
    dataPortSecured: false,
    portLinkUnitId: null,
    portLinkProgress: 0,
    // Training/tutorial: 1 hold (teach the mechanic). Ops maps: 2 holds (no zerg rush).
    portLinkRequired: mapId === 'training' || mapId === 'tutorial' ? 1 : 2,
    mapId,
    playMode: options.playMode ?? 'skirmish',
    campaignOpId: options.campaignOpId,
    missionType: options.missionType ?? 'standard',
    turnLimit:
      (options.missionType ?? 'standard') === 'deadline'
        ? (options.turnLimit ?? defaultTurnLimit(mapId))
        : null,
  };

  const extra = mapId === 'vesper' ? Math.floor((seed >>> 3) % 3) : 0;
  spawnPickups(state, layout.pickupCount + extra, seed ^ 0xb00);

  return state;
}

/** @deprecated use MAPS.vesper / getMapInfo */
export const MAP_META = {
  width: 28,
  height: 24,
  title: 'Node Vesper // Contested Die',
  time: 'session 0x2E // uplink',
};
