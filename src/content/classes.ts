import type { DifficultyProfile } from '../sim/difficulty';
import type { AbilityDef, AbilityId, UnitClass, UnitDef, WeaponDef } from '../sim/types';

// re-export used by map scaling

/**
 * Abilities as near-future hacking executables.
 * Combat still resolves as XCOM-style tactics — fiction is the skin.
 */
export const ABILITIES: Record<AbilityId, AbilityDef> = {
  move: {
    id: 'move',
    name: 'path.exe',
    apCost: 1,
    description: 'Reposition along blue trace (1 CYC) or yellow burst route (2 CYC).',
  },
  shoot: {
    id: 'shoot',
    name: 'inject.bin',
    apCost: 1,
    description: 'Run primary payload against a visible hostile process.',
  },
  overwatch: {
    id: 'overwatch',
    name: 'trap.daemon',
    apCost: 1,
    endsTurn: true,
    description: 'Arm reactive interrupt — auto-inject if hostiles path into LOS.',
  },
  grenade: {
    id: 'grenade',
    name: 'cascade.sys',
    apCost: 1,
    range: 5,
    cooldown: 99,
    description: 'Area wipe: damages processes and shreds component cover.',
  },
  breach: {
    id: 'breach',
    name: 'strip.sys',
    apCost: 1,
    range: 2,
    cooldown: 3,
    description: 'Force-delete adjacent cover component.',
  },
  suppress: {
    id: 'suppress',
    name: 'throttle.sys',
    apCost: 1,
    description: 'Starve target cycles: −15 ACC on their next actions.',
  },
  smoke: {
    id: 'smoke',
    name: 'noise.sys',
    apCost: 1,
    range: 6,
    cooldown: 4,
    description: 'Flood sector with junk packets: +20 DEF in radius.',
  },
  heal: {
    id: 'heal',
    name: 'patch.sys',
    apCost: 1,
    range: 1,
    cooldown: 3,
    description: 'Restore +4 integrity to an adjacent ally process.',
  },
  dash: {
    id: 'dash',
    name: 'burst.exe',
    apCost: 2,
    description: 'Spend both cycles for a full double-range path.',
  },
  hunker: {
    id: 'hunker',
    name: 'sandbox.sys',
    apCost: 1,
    endsTurn: true,
    description: 'Lock into cover — double cover bonus until next turn.',
  },
  link: {
    id: 'link',
    name: 'link.sys',
    apCost: 1,
    description:
      'Arm the data port uplink. Stay on the pylon through hostile cycles to finish the channel — stepping off or crashing severs it.',
  },
};

const RIFLE: WeaponDef = {
  name: 'inject.kit',
  damageMin: 3,
  damageMax: 5,
  range: 9,
  critChance: 10,
};

const SHOTGUN: WeaponDef = {
  name: 'scatter.payload',
  damageMin: 4,
  damageMax: 7,
  range: 5,
  critChance: 15,
};

const SNIPER: WeaponDef = {
  name: 'long_read.probe',
  damageMin: 4,
  damageMax: 6,
  range: 12,
  critChance: 20,
};

const LMG: WeaponDef = {
  name: 'flood.array',
  damageMin: 4,
  damageMax: 6,
  range: 8,
  critChance: 5,
};

const PMC_RIFLE: WeaponDef = {
  name: 'warden.script',
  damageMin: 3,
  damageMax: 4,
  range: 8,
  critChance: 8,
};

const DRONE_GUN: WeaponDef = {
  name: 'scrape.loop',
  damageMin: 2,
  damageMax: 4,
  range: 7,
  critChance: 5,
};

const MECH_CANNON: WeaponDef = {
  name: 'kernel.hammer',
  damageMin: 5,
  damageMax: 7,
  range: 9,
  critChance: 10,
};

export function makeSoldier(
  classId: Extract<UnitClass, 'breacher' | 'marksman' | 'support' | 'heavy'>,
  id: string,
  name: string,
): UnitDef {
  const base = {
    id,
    name,
    team: 'player' as const,
    defense: 10,
    armor: 0,
    sight: 10,
    color: 0x2a3544,
  };

  switch (classId) {
    case 'breacher':
      return {
        ...base,
        classId,
        maxHp: 7,
        aim: 70,
        mobility: 4,
        weapon: SHOTGUN,
        abilities: ['move', 'shoot', 'overwatch', 'grenade', 'breach'],
        accent: 0xff8a3d,
      };
    case 'marksman':
      return {
        ...base,
        classId,
        maxHp: 5,
        aim: 80,
        mobility: 3,
        weapon: SNIPER,
        abilities: ['move', 'shoot', 'overwatch', 'hunker'],
        accent: 0x3de0ff,
      };
    case 'support':
      return {
        ...base,
        classId,
        maxHp: 6,
        aim: 70,
        mobility: 4,
        weapon: RIFLE,
        abilities: ['move', 'shoot', 'overwatch', 'smoke', 'heal'],
        accent: 0x4dff9a,
      };
    case 'heavy':
      return {
        ...base,
        classId,
        maxHp: 8,
        aim: 65,
        armor: 1,
        mobility: 3,
        weapon: LMG,
        abilities: ['move', 'shoot', 'overwatch', 'suppress', 'grenade'],
        accent: 0xffc14a,
      };
  }
}

export function makeEnemy(
  kind: 'pmc' | 'drone' | 'mech',
  id: string,
  name: string,
): UnitDef {
  if (kind === 'pmc') {
    return {
      id,
      name,
      classId: 'pmc',
      team: 'enemy',
      maxHp: 5,
      aim: 65,
      defense: 5,
      armor: 0,
      mobility: 3,
      sight: 9,
      weapon: PMC_RIFLE,
      abilities: ['move', 'shoot', 'overwatch', 'grenade'],
      color: 0x1a1a1e,
      accent: 0xff3d5a,
    };
  }
  if (kind === 'drone') {
    return {
      id,
      name,
      classId: 'drone',
      team: 'enemy',
      maxHp: 4,
      aim: 60,
      defense: 15,
      armor: 0,
      mobility: 4,
      sight: 8,
      weapon: DRONE_GUN,
      abilities: ['move', 'shoot'],
      color: 0x2a2a32,
      accent: 0xff5a3d,
    };
  }
  return {
    id,
    name,
    classId: 'mech',
    team: 'enemy',
    maxHp: 12,
    aim: 70,
    defense: 10,
    armor: 2,
    mobility: 2,
    sight: 10,
    weapon: MECH_CANNON,
    abilities: ['move', 'shoot', 'suppress'],
    color: 0x121218,
    accent: 0xffc14a,
  };
}

/** Near-future netrunner roles (proto-cyberpunk). */
export const CLASS_LABEL: Record<UnitClass, string> = {
  breacher: 'INTRUDER',
  marksman: 'POINTER',
  support: 'SYSOP',
  heavy: 'FLOODER',
  pmc: 'WARDEN',
  drone: 'SCRAPER',
  mech: 'KERNEL GUARD',
};

/** Apply difficulty stat bonuses to an enemy definition. */
export function scaleEnemyForDifficulty(
  def: UnitDef,
  profile: DifficultyProfile,
): UnitDef {
  const maxHp = Math.max(1, def.maxHp + profile.hpBonus);
  const armor = Math.max(0, def.armor + profile.armorBonus);
  const weapon = {
    ...def.weapon,
    damageMin: Math.max(1, def.weapon.damageMin + profile.damageBonus),
    damageMax: Math.max(1, def.weapon.damageMax + profile.damageBonus),
  };
  return {
    ...def,
    maxHp,
    aim: Math.max(1, Math.min(99, def.aim + profile.aimBonus)),
    defense: Math.max(0, def.defense + profile.defenseBonus),
    armor,
    weapon,
  };
}
