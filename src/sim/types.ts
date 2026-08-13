export type Team = 'player' | 'enemy';
export type CoverLevel = 0 | 1 | 2; // none, half, full
export type UnitClass =
  | 'breacher'
  | 'marksman'
  | 'support'
  | 'heavy'
  | 'pmc'
  | 'drone'
  | 'mech';

export type AbilityId =
  | 'move'
  | 'shoot'
  | 'overwatch'
  | 'grenade'
  | 'breach'
  | 'suppress'
  | 'smoke'
  | 'heal'
  | 'dash'
  | 'hunker'
  /** Contextual: only when standing on a data port tile */
  | 'link';

export interface Vec2 {
  x: number;
  y: number;
}

export interface CoverEdge {
  /** Direction from tile center toward the cover object: N S E W */
  dir: 'N' | 'S' | 'E' | 'W';
  level: CoverLevel;
  /** Tile of the cover prop (destructible) */
  propId: string;
}

export interface Tile {
  x: number;
  y: number;
  walkable: boolean;
  /** Blocking LOS/movement wall (indestructible structure) */
  blocked: boolean;
  cover: CoverEdge[];
}

export interface WeaponDef {
  name: string;
  damageMin: number;
  damageMax: number;
  range: number;
  critChance: number;
  ammo?: number;
}

export interface AbilityDef {
  id: AbilityId;
  name: string;
  apCost: number;
  range?: number;
  cooldown?: number;
  endsTurn?: boolean;
  description: string;
}

export interface UnitDef {
  id: string;
  name: string;
  classId: UnitClass;
  team: Team;
  maxHp: number;
  aim: number;
  defense: number;
  armor: number;
  mobility: number; // tiles per AP move
  sight: number;
  weapon: WeaponDef;
  abilities: AbilityId[];
  color: number;
  accent: number;
}

export interface UnitState {
  def: UnitDef;
  id: string;
  pos: Vec2;
  hp: number;
  ap: number;
  maxAp: number;
  alive: boolean;
  overwatching: boolean;
  suppressed: boolean;
  inSmoke: boolean;
  /** Hunker Down — doubles cover bonus until next player turn; never mutates def.defense */
  hunkered: boolean;
  podId: string | null;
  activated: boolean;
  cooldowns: Partial<Record<AbilityId, number>>;
  /** Privilege level (1–MAX). Enemies stay 1. */
  level: number;
  /** Lifetime XP (persists via roster for players). */
  xp: number;
  /** XP earned this breach (for debrief). */
  missionXp: number;
  /**
   * Deployed wounded (from prior crash). Debuffs already baked into def.
   * Enemies always false.
   */
  wounded: boolean;
}

export interface CoverProp {
  id: string;
  pos: Vec2;
  level: CoverLevel;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  kind: 'crate' | 'barrier' | 'sandbag' | 'vehicle';
}

export interface Pod {
  id: string;
  memberIds: string[];
  activated: boolean;
}

/** Walkable loot nodes — collect on enter (hacking mini-game powerups). */
export type PickupKind = 'cycles' | 'integrity' | 'scan' | 'purge';

export interface Pickup {
  id: string;
  kind: PickupKind;
  pos: Vec2;
  /** Magnitude: CYC restored, INT restored, or tiles revealed */
  amount: number;
  collected: boolean;
}

export type GamePhase =
  | 'briefing'
  | 'player'
  | 'enemy'
  | 'animating'
  | 'victory'
  | 'defeat';

export type ActionKind =
  | { type: 'move'; path: Vec2[]; cost: number }
  | { type: 'shoot'; targetId: string }
  | { type: 'overwatch' }
  | { type: 'grenade'; target: Vec2 }
  | { type: 'breach'; target: Vec2 }
  | { type: 'suppress'; targetId: string }
  | { type: 'smoke'; target: Vec2 }
  | { type: 'heal'; targetId: string }
  | { type: 'hunker' }
  | { type: 'endTurn' };

export interface ShotPreview {
  hitChance: number;
  critChance: number;
  damageMin: number;
  damageMax: number;
  flanked: boolean;
  coverPenalty: number;
  rangeMod: number;
  reason: string;
}

export interface ShotResult {
  hit: boolean;
  crit: boolean;
  damage: number;
  killed: boolean;
  graze: boolean;
}

export interface GameEvent {
  type:
    | 'move'
    | 'shot'
    | 'miss'
    | 'kill'
    | 'damage'
    | 'coverDestroyed'
    | 'podActivated'
    | 'overwatch'
    | 'grenade'
    | 'toast'
    | 'turnStart'
    | 'missionEnd'
    | 'unitSelected'
    | 'pickupSpawned'
    | 'pickupCollected'
    | 'xp'
    | 'levelUp'
    | 'heal';
  payload: Record<string, unknown>;
}

export type DifficultyId = 'easy' | 'normal' | 'hard' | 'extreme';

/**
 * Mission objective shape.
 * - standard: port or wipe (no turn limit)
 * - deadline: same wins, but lose if player cycles exceed turnLimit
 */
export type MissionType = 'standard' | 'deadline';

export interface MissionState {
  width: number;
  height: number;
  tiles: Tile[][];
  props: Map<string, CoverProp>;
  units: Map<string, UnitState>;
  pods: Map<string, Pod>;
  phase: GamePhase;
  selectedId: string | null;
  turn: number;
  visibleEnemyIds: Set<string>;
  /** Currently visible tiles (LOS from living players) */
  visibleTiles: Set<string>;
  /**
   * Last known tile for each enemy id when they were last in LOS.
   * Used for FOW ghosts — not updated while out of sight.
   */
  lastKnownEnemyPos: Map<string, Vec2>;
  explored: boolean[][];
  smokeTiles: Set<string>;
  /** South insert pads (spawn) */
  extractTiles: Vec2[];
  /** North data-exfil port — any living probe on these tiles wins */
  dataPortTiles: Vec2[];
  pickups: Map<string, Pickup>;
  seed: number;
  log: GameEvent[];
  /** Selected on briefing screen; scales enemy AI + stats */
  difficulty: DifficultyId;
  /** Selected map layout (training / vesper / kernel) */
  mapId: string;
  /** campaign | skirmish | tutorial — tags how this mission was launched */
  playMode: 'campaign' | 'skirmish' | 'tutorial';
  /** Campaign op id when playMode is campaign */
  campaignOpId?: string;
  /** True once the data port channel finishes (after link.sys + hold) */
  dataPortSecured: boolean;
  /**
   * Probe currently channeling the north data port.
   * Must stay alive on a port tile through hostile cycles until progress completes.
   */
  portLinkUnitId: string | null;
  /** Successful hostile-cycle holds while channeling (0 … portLinkRequired) */
  portLinkProgress: number;
  /** Holds needed after arming link.sys (anti-rush; default 2) */
  portLinkRequired: number;
  /** Objective type for this breach */
  missionType: MissionType;
  /**
   * Max player cycle number (inclusive). Null = unlimited.
   * Deadline fires when turn advances past this after enemy turn.
   */
  turnLimit: number | null;
}
