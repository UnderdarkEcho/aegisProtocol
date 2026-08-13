import {
  music,
  MUSIC_TRACKS,
  type MusicPrefs,
  type MusicTrackId,
} from '../audio/music';
import { sfx } from '../audio/sfx';
import { ABILITIES, CLASS_LABEL } from '../content/classes';
import { CREDITS } from '../content/credits';
import { shareScoreToX } from '../content/share';
import { getMapInfo, MAPS, type MapId } from '../content/map';
import {
  campaignProgressLabel,
  defaultCampaign,
  getCampaignOps,
  getCurrentOp,
  getOpCount,
  type CampaignState,
  type CampaignTrack,
  type PlayMode,
} from '../sim/campaign';
import type { Game } from '../sim/game';
import { DIFFICULTIES, getDifficulty, type DifficultyId } from '../sim/difficulty';
import { debugStatusLine } from '../sim/debug';
import {
  applyLoadoutToDef,
  earnCred,
  MEDKIT,
  nextUpgradeCost,
  tryBuyUpgrade,
  UPGRADES,
  type LoadoutState,
  type UpgradeId,
} from '../sim/loadout';
import {
  abilitiesAtLevel,
  abilitiesUnlockedAt,
  applyWoundDebuffs,
  buildSoldierAtLevel,
  debriefGrade,
  levelFromXp,
  MAX_LEVEL,
  privilegeBoostCost,
  unlockTable,
  xpBar,
  xpToReachLevel,
  WOUND_PENALTIES,
  type PlayerClassId,
} from '../sim/progression';
import { loadRoster, resetRoster, saveRoster } from '../sim/roster';
import { computeCampaignScore, computeMissionScore } from '../sim/scores';
import {
  clearLeaderboard,
  insertScore,
  loadLeaderboard,
} from '../sim/scoreStore';
import type {
  AbilityId,
  CoverLevel,
  GameEvent,
  MissionType,
  ShotPreview,
  UnitState,
} from '../sim/types';
import { defaultTurnLimit } from '../content/map';

export type Mode =
  | { type: 'select' }
  | { type: 'move' }
  | { type: 'shoot' }
  | { type: 'grenade' }
  | { type: 'breach' }
  | { type: 'suppress' }
  | { type: 'smoke' }
  | { type: 'heal' };

export class HUD {
  mode: Mode = { type: 'select' };
  difficulty: DifficultyId = 'normal';
  mapId: MapId = 'vesper';
  playMode: PlayMode = 'campaign';
  campaign: CampaignState = defaultCampaign();
  /** Skirmish objective type (campaign ops override) */
  missionType: MissionType = 'standard';
  loadout: LoadoutState | null = null;
  /** Start-menu toggle: when true, in-round debug cheat bar is available */
  debugMode = false;
  private game: Game | null = null;
  private onModeChange: ((m: Mode) => void) | null = null;
  private onSelectUnit: ((id: string) => void) | null = null;
  /** After cheats that change vision/units — sync renderer + HUD */
  private onDebugSync: (() => void) | null = null;
  /** Write current unit XP into localStorage roster */
  private onPersistRoster: (() => void) | null = null;
  /** Mission end: XP + wound flags */
  private onMissionEndPersist: ((practice?: boolean) => void) | null = null;
  /** Persist loadout after shop purchase */
  private onLoadoutChanged: ((l: LoadoutState) => void) | null = null;
  /** Bank mission CRED into loadout */
  private onCredEarned: ((n: number) => void) | null = null;
  /** Campaign progress after mission end (main advances + banks XP + branch) */
  private onMissionResult:
    | ((victory: boolean, missionXp: number, reason: string, practice?: boolean) => void)
    | null = null;
  private onContinue: (() => void) | null = null;
  private onNewCampaign: (() => void) | null = null;
  private onResetSquad: (() => void) | null = null;
  private difficultyWired = false;
  private mapWired = false;
  private modeWired = false;
  private missionTypeWired = false;
  private loadoutWired = false;
  private debugWired = false;
  private debugModeWired = false;
  private musicWired = false;
  private tabsWired = false;
  private trackWired = false;
  private recordsWired = false;
  private squadWired = false;
  private menuTab: 'ops' | 'squad' | 'settings' = 'ops';
  private recordsBoard: 'skirmish' | 'campaign' = 'skirmish';
  /** Selected operative in SQUAD tab dossier */
  private selectedOpId: string | null = null;
  /** Set during missionEnd scoring; applied after debrief panel builds */
  private pendingScoreNote: {
    isBest: boolean;
    placed: boolean;
    rank: number;
    score: number;
    defeat?: boolean;
    campaignRun?: boolean;
    practice?: boolean;
  } | null = null;
  private unbindGame: (() => void) | null = null;
  /** Optional: parent banks mission/campaign scores after debrief math */
  private onMissionScore:
    | ((info: {
        victory: boolean;
        score: number;
        grade: string;
        reason: string;
        stats: ReturnType<typeof collectMissionStats>;
      }) => void)
    | null = null;
  private onCampaignTrackChange: ((track: CampaignTrack) => void) | null = null;
  private missionXpAwarded = false;
  private toastTimer = 0;

  private els = {
    briefing: document.getElementById('briefing')!,
    hud: document.getElementById('hud')!,
    result: document.getElementById('result')!,
    btnDeploy: document.getElementById('btn-deploy')!,
    btnRestart: document.getElementById('btn-restart')!,
    btnContinue: document.getElementById('btn-continue') as HTMLButtonElement | null,
    btnNewCampaign: document.getElementById('btn-new-campaign') as HTMLButtonElement | null,
    btnResetCampaign: document.getElementById('btn-reset-campaign') as HTMLButtonElement | null,
    btnResetSquad: document.getElementById('btn-reset-squad') as HTMLButtonElement | null,
    btnEnd: document.getElementById('btn-end-turn')!,
    turn: document.getElementById('turn-banner')!,
    objective: document.getElementById('objective-strip')!,
    unitPanel: document.getElementById('unit-panel')!,
    unitName: document.getElementById('unit-name')!,
    unitLevel: document.getElementById('unit-level')!,
    unitClass: document.getElementById('unit-class')!,
    unitHp: document.getElementById('unit-hp')!,
    unitAp: document.getElementById('unit-ap')!,
    unitAim: document.getElementById('unit-aim')!,
    unitArmor: document.getElementById('unit-armor')!,
    hpFill: document.getElementById('hp-fill')!,
    xpFill: document.getElementById('xp-fill')!,
    xpText: document.getElementById('xp-text')!,
    abilityBar: document.getElementById('ability-bar')!,
    hitChance: document.getElementById('hit-chance')!,
    hitPct: document.getElementById('hit-pct')!,
    hitMeta: document.getElementById('hit-meta')!,
    hitTarget: document.getElementById('hit-target')!,
    hitIntFill: document.getElementById('hit-int-fill')!,
    hitIntText: document.getElementById('hit-int-text')!,
    hitKill: document.getElementById('hit-kill')!,
    toast: document.getElementById('toast')!,
    floatLayer: document.getElementById('float-damage')!,
    screenFx: document.getElementById('screen-fx')!,
    resultTag: document.getElementById('result-tag')!,
    resultTitle: document.getElementById('result-title')!,
    resultBody: document.getElementById('result-body')!,
    resultStandard: document.getElementById('result-standard'),
    debriefPanel: document.getElementById('debrief-panel'),
    debriefGrade: document.getElementById('debrief-grade'),
    debriefScore: document.getElementById('debrief-score'),
    debriefScoreNote: document.getElementById('debrief-score-note'),
    debriefTurns: document.getElementById('debrief-turns'),
    debriefKills: document.getElementById('debrief-kills'),
    debriefAlive: document.getElementById('debrief-alive'),
    debriefXp: document.getElementById('debrief-xp'),
    debriefWin: document.getElementById('debrief-win'),
    debriefRoster: document.getElementById('debrief-roster'),
    debriefWounds: document.getElementById('debrief-wounds'),
    campaignVictory: document.getElementById('campaign-victory'),
    cvOps: document.getElementById('cv-ops'),
    cvRunScore: document.getElementById('cv-run-score'),
    cvTotalXp: document.getElementById('cv-total-xp'),
    cvMissionXp: document.getElementById('cv-mission-xp'),
    cvTurns: document.getElementById('cv-turns'),
    cvKills: document.getElementById('cv-kills'),
    cvAlive: document.getElementById('cv-alive'),
    cvWin: document.getElementById('cv-win'),
    cvRosterRows: document.getElementById('cv-roster-rows'),
    cvBody: document.getElementById('cv-body'),
    cvSub: document.getElementById('cv-sub'),
    difficultyRow: document.getElementById('difficulty-row')!,
    difficultyBlurb: document.getElementById('difficulty-blurb')!,
    mapRow: document.getElementById('map-row')!,
    mapBlurb: document.getElementById('map-blurb')!,
    mapSectionTitle: document.getElementById('map-section-title'),
    campaignPanel: document.getElementById('campaign-panel'),
    campaignStepper: document.getElementById('campaign-stepper'),
    campaignOpCode: document.getElementById('campaign-op-code'),
    campaignOpTitle: document.getElementById('campaign-op-title'),
    campaignOpBlurb: document.getElementById('campaign-op-blurb'),
    campaignCompleteNote: document.getElementById('campaign-complete-note'),
    campaignMapLock: document.getElementById('campaign-map-lock'),
    campaignLockMap: document.getElementById('campaign-lock-map'),
    modeRow: document.getElementById('mode-row'),
    missionTypeRow: document.getElementById('mission-type-row'),
    missionTypeSection: document.getElementById('mission-type-section'),
    missionTypeBlurb: document.getElementById('mission-type-blurb'),
    squadBar: document.getElementById('squad-bar')!,
    debugBar: document.getElementById('debug-bar')!,
    debugModeToggle: document.getElementById('debug-mode-toggle') as HTMLInputElement | null,
  };

  /** Optional projector for floating combat text (screen px). */
  worldToScreen: ((x: number, y: number) => { x: number; y: number } | null) | null =
    null;

  bind(
    game: Game,
    handlers: {
      onDeploy: () => void;
      onRestart: () => void;
      onEndTurn: () => void;
      onModeChange: (m: Mode) => void;
      onSelectUnit?: (id: string) => void;
      onDebugSync?: () => void;
      onPersistRoster?: () => void;
      onMissionEndPersist?: (practice?: boolean) => void;
      onMissionResult?: (
        victory: boolean,
        missionXp: number,
        reason: string,
        practice?: boolean,
      ) => void;
      onContinue?: () => void;
      onNewCampaign?: () => void;
      onResetSquad?: () => void;
      onLoadoutChanged?: (l: LoadoutState) => void;
      onCredEarned?: (n: number) => void;
      onMissionScore?: (info: {
        victory: boolean;
        score: number;
        grade: string;
        reason: string;
        stats: ReturnType<typeof collectMissionStats>;
      }) => void;
      onCampaignTrackChange?: (track: CampaignTrack) => void;
    },
  ) {
    this.game = game;
    this.onModeChange = handlers.onModeChange;
    this.onSelectUnit = handlers.onSelectUnit ?? null;
    this.onDebugSync = handlers.onDebugSync ?? null;
    this.onPersistRoster = handlers.onPersistRoster ?? null;
    this.onMissionEndPersist = handlers.onMissionEndPersist ?? null;
    this.onMissionResult = handlers.onMissionResult ?? null;
    this.onLoadoutChanged = handlers.onLoadoutChanged ?? null;
    this.onCredEarned = handlers.onCredEarned ?? null;
    this.onContinue = handlers.onContinue ?? null;
    this.onNewCampaign = handlers.onNewCampaign ?? null;
    this.onResetSquad = handlers.onResetSquad ?? null;
    this.onMissionScore = handlers.onMissionScore ?? null;
    this.onCampaignTrackChange = handlers.onCampaignTrackChange ?? null;
    this.missionXpAwarded = false;

    this.els.btnDeploy.onclick = () => handlers.onDeploy();
    this.els.btnRestart.onclick = () => handlers.onRestart();
    this.els.btnEnd.onclick = () => handlers.onEndTurn();
    if (this.els.btnContinue) {
      this.els.btnContinue.onclick = () => this.onContinue?.();
    }
    const resetCamp = () => this.onNewCampaign?.();
    if (this.els.btnNewCampaign) this.els.btnNewCampaign.onclick = resetCamp;
    if (this.els.btnResetCampaign) this.els.btnResetCampaign.onclick = resetCamp;
    if (this.els.btnResetSquad) {
      this.els.btnResetSquad.onclick = () => this.onResetSquad?.();
    }

    this.wireStaticTooltips();
    this.wireMenuTabs();
    this.wirePlayMode();
    this.wireCampaignTrack();
    this.wireMapPicker();
    this.wireMissionType();
    this.wireLoadoutShop();
    this.wireDifficulty();
    this.wireDebugModeToggle();
    this.wireDebugBar();
    this.wireMusicControls();
    this.wireRecords();
    this.wireSquadDossier();
    this.wireCredits();
    // Keep briefing selection in sync with mission (e.g. after redeploy)
    if (game.state.difficulty) {
      this.setDifficulty(game.state.difficulty);
    }
    if (game.state.playMode) {
      this.setPlayMode(game.state.playMode);
    }
    if (game.state.mapId && game.state.mapId in MAPS) {
      this.setMapId(game.state.mapId as MapId);
    }
    if (game.state.missionType) {
      this.setMissionType(game.state.missionType);
    }
    this.refreshCampaignUI();
    this.refreshLoadoutShop();
    this.applyDebugBarVisibility();

    this.unbindGame?.();
    this.unbindGame = game.on((e) => this.onEvent(e));
    this.refresh();
  }

  setLoadout(l: LoadoutState) {
    this.loadout = l;
    this.refreshLoadoutShop();
    this.refreshSquadDossier();
  }

  private wireLoadoutShop() {
    if (this.loadoutWired) return;
    this.loadoutWired = true;
    document.getElementById('loadout-items')?.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('.loadout-item') as HTMLButtonElement | null;
      if (!btn || btn.disabled || !this.loadout) return;
      const id = btn.dataset.upgrade;
      if (!id) return;
      if (id === 'medkit') {
        this.buyMedkit();
        return;
      }
      if (id !== 'inject' && id !== 'armor' && id !== 'cycle') return;
      const r = tryBuyUpgrade(this.loadout, id as UpgradeId);
      const toast = document.getElementById('loadout-toast');
      if (!r.ok) {
        sfx.miss();
        if (toast) {
          toast.textContent = r.reason === 'MAXED' ? 'ALREADY MAXED' : 'INSUFFICIENT CRED';
          toast.classList.remove('hidden');
          toast.classList.add('err');
        }
        return;
      }
      this.loadout = r.state;
      this.onLoadoutChanged?.(this.loadout);
      this.refreshLoadoutShop();
      this.refreshSquadDossier();
      sfx.shop();
      if (toast) {
        toast.textContent = `INSTALLED · ${UPGRADES[id as UpgradeId].name}`;
        toast.classList.remove('hidden', 'err');
      }
    });
  }

  private buyMedkit() {
    if (!this.loadout) return;
    const toast = document.getElementById('loadout-toast');
    if (this.loadout.cred < MEDKIT.cost) {
      sfx.miss();
      if (toast) {
        toast.textContent = 'INSUFFICIENT CRED';
        toast.classList.remove('hidden');
        toast.classList.add('err');
      }
      return;
    }
    const roster = loadRoster();
    const anyWounded = roster.operatives.some((o) => o.wounded);
    if (!anyWounded) {
      sfx.miss();
      if (toast) {
        toast.textContent = 'NO WOUNDS TO CLEAR';
        toast.classList.remove('hidden');
        toast.classList.add('err');
      }
      return;
    }
    this.loadout = { ...this.loadout, cred: this.loadout.cred - MEDKIT.cost };
    const healed = {
      ...roster,
      operatives: roster.operatives.map((o) => ({ ...o, wounded: false })),
    };
    saveRoster(healed);
    this.onLoadoutChanged?.(this.loadout);
    this.refreshLoadoutShop();
    this.refreshLobbyWounds();
    this.refreshSquadDossier();
    sfx.heal();
    if (toast) {
      toast.textContent = 'patch.bay · ALL WOUNDS CLEARED';
      toast.classList.remove('hidden', 'err');
    }
  }

  private wireCredits() {
    const handle = document.getElementById('credits-handle') as HTMLAnchorElement | null;
    const donate = document.getElementById('credits-donate-link') as HTMLAnchorElement | null;
    const qrLink = document.getElementById('credits-qr-link') as HTMLAnchorElement | null;
    const qr = document.getElementById('credits-qr') as HTMLImageElement | null;
    const blurb = document.getElementById('credits-blurb');
    if (handle) {
      handle.href = CREDITS.profileUrl;
      handle.textContent = CREDITS.handle;
    }
    if (donate) donate.href = CREDITS.donateUrl;
    if (qrLink) {
      qrLink.href = CREDITS.donateUrl;
      qrLink.title = `Scan or tap to open ${CREDITS.handle} on X`;
    }
    if (qr) {
      qr.src = CREDITS.qrImage;
      qr.alt = `QR code to tip ${CREDITS.handle} on X`;
    }
    if (blurb) blurb.textContent = CREDITS.blurb;
  }

  private wireSquadDossier() {
    if (this.squadWired) return;
    this.squadWired = true;
    document.getElementById('class-row')?.addEventListener('click', (ev) => {
      const chip = (ev.target as HTMLElement).closest('.class-chip') as HTMLButtonElement | null;
      const id = chip?.dataset.opId;
      if (!id) return;
      this.selectedOpId = this.selectedOpId === id ? null : id;
      this.refreshSquadDossier();
      sfx.ui();
    });
    document.getElementById('btn-buy-privilege')?.addEventListener('click', () => {
      this.buyPrivilegeBoost();
    });
    this.refreshSquadDossier();
  }

  private buyPrivilegeBoost() {
    if (!this.loadout || !this.selectedOpId) return;
    const roster = loadRoster();
    const op = roster.operatives.find((o) => o.id === this.selectedOpId);
    if (!op) return;
    const level = levelFromXp(op.xp);
    const cost = privilegeBoostCost(level);
    const toast = document.getElementById('loadout-toast');
    if (cost == null) {
      sfx.miss();
      if (toast) {
        toast.textContent = 'MAX PRIVILEGE';
        toast.classList.remove('hidden');
        toast.classList.add('err');
      }
      return;
    }
    if (this.loadout.cred < cost) {
      sfx.miss();
      if (toast) {
        toast.textContent = 'INSUFFICIENT CRED';
        toast.classList.remove('hidden');
        toast.classList.add('err');
      }
      return;
    }
    const needXp = xpToReachLevel(op.xp, level + 1);
    const nextXp = op.xp + needXp;
    const newLevel = levelFromXp(nextXp);
    const newAbilities = abilitiesUnlockedAt(op.classId, newLevel);
    this.loadout = { ...this.loadout, cred: this.loadout.cred - cost };
    const updated = {
      ...roster,
      operatives: roster.operatives.map((o) =>
        o.id === op.id ? { ...o, xp: nextXp } : o,
      ),
    };
    saveRoster(updated);
    this.onLoadoutChanged?.(this.loadout);
    this.refreshLoadoutShop();
    this.refreshSquadDossier();
    sfx.levelUp();
    const unlock =
      newAbilities.length > 0
        ? ` · +${newAbilities.map((a) => ABILITIES[a]?.name ?? a).join(', ')}`
        : '';
    if (toast) {
      toast.textContent = `${op.name} · L${newLevel}${unlock}`;
      toast.classList.remove('hidden', 'err');
    }
    this.showToast(`${op.name} · PRIVILEGE L${newLevel}`, false, 2200);
  }

  /** Refresh SQUAD tab chips + selected probe dossier. */
  refreshSquadDossier() {
    const roster = loadRoster();
    const loadout = this.loadout;

    // Chip level badges + selection
    for (const chip of document.querySelectorAll<HTMLButtonElement>('.class-chip[data-op-id]')) {
      const id = chip.dataset.opId!;
      const op = roster.operatives.find((o) => o.id === id);
      const lvl = op ? levelFromXp(op.xp) : 1;
      const meta = chip.querySelector(`[data-chip-meta="${id}"]`);
      if (meta) {
        meta.textContent = op?.wounded ? `L${lvl} · WND` : `L${lvl}`;
      }
      chip.classList.toggle('selected', this.selectedOpId === id);
      chip.classList.toggle('wounded', Boolean(op?.wounded));
      chip.setAttribute('aria-pressed', this.selectedOpId === id ? 'true' : 'false');
      if (op) {
        const role = CLASS_LABEL[op.classId] ?? op.classId;
        setTip(
          chip,
          `${op.name} · ${role} · L${lvl}${op.wounded ? ' · WOUNDED' : ''}\nClick to open probe dossier.`,
          'below',
        );
      }
    }

    const panel = document.getElementById('probe-dossier');
    if (!panel) return;
    if (!this.selectedOpId) {
      panel.classList.add('hidden');
      return;
    }
    const op = roster.operatives.find((o) => o.id === this.selectedOpId);
    if (!op) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    const level = levelFromXp(op.xp);
    let def = buildSoldierAtLevel(op.classId, op.id, op.name, level, {
      gateAbilities: true,
    });
    if (op.wounded) def = applyWoundDebuffs(def);
    if (loadout) def = applyLoadoutToDef(def, loadout);

    const nameEl = document.getElementById('dossier-name');
    const classEl = document.getElementById('dossier-class');
    const levelEl = document.getElementById('dossier-level');
    const woundEl = document.getElementById('dossier-wound');
    const xpFill = document.getElementById('dossier-xp-fill');
    const xpText = document.getElementById('dossier-xp-text');
    const statsEl = document.getElementById('dossier-stats');
    const abEl = document.getElementById('dossier-abilities');
    const buyBtn = document.getElementById('btn-buy-privilege') as HTMLButtonElement | null;
    const buyCost = document.getElementById('dossier-buy-cost');
    const buyHint = document.getElementById('dossier-buy-hint');

    if (nameEl) nameEl.textContent = op.name;
    if (classEl) {
      classEl.textContent = `${CLASS_LABEL[op.classId]} · ${def.weapon.name}`;
    }
    if (levelEl) levelEl.textContent = `L${level}`;
    if (woundEl) woundEl.classList.toggle('hidden', !op.wounded);

    const bar = xpBar(op.xp);
    if (xpFill) {
      xpFill.style.width = level >= MAX_LEVEL ? '100%' : `${bar.pct}%`;
    }
    if (xpText) {
      xpText.textContent =
        level >= MAX_LEVEL ? 'MAX' : `${bar.current}/${bar.need}`;
    }

    // Healthy baseline for wounded comparison
    const healthy = buildSoldierAtLevel(op.classId, op.id, op.name, level, {
      gateAbilities: true,
    });
    const healthyLoad = loadout ? applyLoadoutToDef(healthy, loadout) : healthy;

    if (statsEl) {
      const cyc = 2 + (loadout?.cycle ?? 0);
      const rows: Array<[string, string, string]> = [
        ['INT', `${def.maxHp}`, op.wounded ? `full ${healthyLoad.maxHp}` : 'integrity'],
        ['ACC', `${def.aim}`, op.wounded ? `full ${healthyLoad.aim}` : 'accuracy'],
        ['SHD', `${def.armor}`, 'shield'],
        ['MOB', `${def.mobility}`, 'mobility'],
        ['DMG', `${def.weapon.damageMin}–${def.weapon.damageMax}`, 'payload'],
        ['RNG', `${def.weapon.range}`, 'range'],
        ['CYC', `${cyc}`, 'max cycles'],
        ['DEF', `${def.defense}`, 'defense'],
      ];
      statsEl.innerHTML = rows
        .map(
          ([k, v, hint]) =>
            `<div class="dossier-stat"><span class="ds-k">${k}</span><span class="ds-v">${v}</span><span class="ds-h">${hint}</span></div>`,
        )
        .join('');
    }

    if (abEl) {
      const unlocked = new Set(abilitiesAtLevel(op.classId as PlayerClassId, level));
      const table = unlockTable(op.classId as PlayerClassId);
      const levels = Object.keys(table)
        .map(Number)
        .sort((a, b) => a - b);
      const items: string[] = [];
      for (const lv of levels) {
        for (const aid of table[lv] ?? []) {
          if (aid === 'move') continue;
          const defA = ABILITIES[aid];
          const on = unlocked.has(aid);
          items.push(
            `<div class="dossier-ability${on ? ' on' : ' off'}" title="${defA?.description ?? ''}">` +
              `<span class="da-name">${defA?.name ?? aid}</span>` +
              `<span class="da-lv">${on ? 'ONLINE' : `L${lv}`}</span>` +
              `</div>`,
          );
        }
      }
      // Always show link.sys as contextual
      items.push(
        `<div class="dossier-ability on contextual" title="${ABILITIES.link.description}">` +
          `<span class="da-name">link.sys</span>` +
          `<span class="da-lv">PORT</span></div>`,
      );
      abEl.innerHTML = items.join('');
    }

    const cost = privilegeBoostCost(level);
    const cred = loadout?.cred ?? 0;
    if (buyBtn) {
      buyBtn.disabled = cost == null || cred < cost;
      buyBtn.textContent =
        cost == null ? 'MAX PRIVILEGE' : `BUY PRIVILEGE → L${level + 1}`;
    }
    if (buyCost) {
      buyCost.textContent =
        cost == null ? 'MAX' : `${cost} CRED · you have ${cred}`;
    }
    if (buyHint) {
      const nextAbs = cost != null ? abilitiesUnlockedAt(op.classId, level + 1) : [];
      buyHint.textContent =
        cost == null
          ? 'This probe is at max privilege (L6).'
          : nextAbs.length
            ? `Next unlock: ${nextAbs.map((a) => ABILITIES[a]?.name ?? a).join(', ')}. Squad gear is bought in Loadout Bay.`
            : 'Raises stats for this probe. Squad gear is bought in Loadout Bay.';
    }
  }

  refreshLoadoutShop() {
    const l = this.loadout;
    const credEl = document.getElementById('loadout-cred');
    if (!l) return;
    if (credEl) credEl.textContent = `${l.cred} CRED`;

    for (const id of ['inject', 'armor', 'cycle'] as UpgradeId[]) {
      const def = UPGRADES[id];
      const tier = l[id];
      const cost = nextUpgradeCost(l, id);
      const tierEl = document.querySelector(`[data-tier-for="${id}"]`);
      const costEl = document.querySelector(`[data-cost-for="${id}"]`);
      const btn = document.querySelector(
        `.loadout-item[data-upgrade="${id}"]`,
      ) as HTMLButtonElement | null;
      if (tierEl) tierEl.textContent = `${tier}/${def.max}`;
      if (costEl) {
        costEl.textContent = cost == null ? 'MAX' : `${cost} CRED`;
      }
      if (btn) {
        btn.disabled = cost == null || l.cred < cost;
        setTip(
          btn,
          `${def.name}\n${def.blurb}\nTier ${tier}/${def.max}` +
            (cost != null ? `\nNext: ${cost} CRED` : '\nMAXED'),
          'below',
        );
      }
    }
    const med = document.querySelector(
      '.loadout-item[data-upgrade="medkit"]',
    ) as HTMLButtonElement | null;
    if (med) {
      const roster = loadRoster();
      const wounded = roster.operatives.some((o) => o.wounded);
      med.disabled = !wounded || l.cred < MEDKIT.cost;
      setTip(
        med,
        `${MEDKIT.name}\n${MEDKIT.blurb}\nCost: ${MEDKIT.cost} CRED`,
        'below',
      );
    }
  }

  /** Hover snippets for fixed chrome buttons. */
  private wireStaticTooltips() {
    setTip(
      this.els.btnDeploy,
      'Jack the probe team onto the selected target node.\nStarts the breach at the chosen map and ICE hardness.',
      'below',
    );
    setTip(
      this.els.btnRestart,
      'Drop the current link and return to the breach lobby.\nPick mode, map, and ICE hardness again.',
      'below',
    );
    setTip(
      this.els.btnEnd,
      'End your cycle.\nHostile processes act next — they inject, path, and cascade.',
    );
    if (this.els.btnContinue) {
      setTip(this.els.btnContinue, 'Continue campaign flow — next op, retry, or new campaign.', 'below');
    }
    if (this.els.btnNewCampaign) {
      setTip(
        this.els.btnNewCampaign,
        'Reset campaign to OP-01.\nKeeps probe XP / levels. Clears Vesper path.',
        'below',
      );
    }
    if (this.els.btnResetCampaign) {
      setTip(
        this.els.btnResetCampaign,
        'Reset campaign to OP-01.\nKeeps probe XP / levels. Clears Vesper path.',
        'below',
      );
    }
    if (this.els.btnResetSquad) {
      setTip(
        this.els.btnResetSquad,
        'Full squad wipe (with confirm):\n• L1 / 0 XP, starter abilities\n• Clear wounds\n• Remove all loadout upgrades\n• CRED → 0',
        'below',
      );
    }
  }

  getDifficulty(): DifficultyId {
    return this.difficulty;
  }

  getMapId(): MapId {
    return this.mapId;
  }

  getPlayMode(): PlayMode {
    return this.playMode;
  }

  getMissionType(): MissionType {
    return this.missionType;
  }

  setMissionType(t: MissionType) {
    if (t !== 'standard' && t !== 'deadline') return;
    this.missionType = t;
    const row = this.els.missionTypeRow;
    if (row) {
      for (const btn of row.querySelectorAll<HTMLButtonElement>('.mtype-btn')) {
        const mt = btn.dataset.missionType as MissionType | undefined;
        const on = mt === t;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    const mapId = this.resolveDeployMapId();
    if (this.els.missionTypeBlurb) {
      this.els.missionTypeBlurb.textContent =
        t === 'deadline'
          ? `ICE wake timer — port or wipe before cycle ${defaultTurnLimit(mapId)}. Fail if the clock hits zero.`
          : 'Classic breach — secure the north data port or kill every hostile process.';
    }
    this.refreshDeploySummary();
  }

  private wireMissionType() {
    if (this.missionTypeWired) return;
    this.missionTypeWired = true;
    this.els.missionTypeRow?.addEventListener('click', (ev) => {
      if (this.playMode === 'campaign') return;
      const t = (ev.target as HTMLElement).closest('.mtype-btn') as HTMLButtonElement | null;
      if (!t?.dataset.missionType) return;
      const mt = t.dataset.missionType as MissionType;
      this.setMissionType(mt);
    });
    this.setMissionType(this.missionType);
  }

  setCampaign(state: CampaignState) {
    this.campaign = state;
    this.refreshCampaignUI();
  }

  setPlayMode(mode: PlayMode) {
    this.playMode = mode;
    const row = this.els.modeRow;
    if (row) {
      for (const btn of row.querySelectorAll<HTMLButtonElement>('.mode-btn')) {
        const m = btn.dataset.mode as PlayMode | undefined;
        const on = m === mode;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    this.refreshCampaignUI();
    this.refreshDeploySummary();
  }

  /** Map used for next jack-in (campaign forces current op map). */
  resolveDeployMapId(): MapId {
    if (this.playMode === 'campaign') {
      return getCurrentOp(this.campaign).mapId;
    }
    return this.mapId;
  }

  setMapId(id: MapId) {
    if (!(id in MAPS)) return;
    this.mapId = id;
    const info = getMapInfo(id);
    const buttons = this.els.mapRow.querySelectorAll<HTMLButtonElement>('.map-btn');
    for (const btn of buttons) {
      const m = btn.dataset.map as MapId | undefined;
      const on = m === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (m && m in MAPS) {
        const mi = getMapInfo(m);
        setTip(
          btn,
          `${mi.name}\n${mi.blurb}\nComplexity ${mi.complexity}/3 — select before jack-in.`,
          'below',
        );
      }
    }
    if (this.playMode === 'skirmish') {
      this.els.mapBlurb.textContent = info.blurb;
    }
    this.refreshDeploySummary();
  }

  setDifficulty(id: DifficultyId) {
    this.difficulty = id;
    const profile = getDifficulty(id);
    const buttons = this.els.difficultyRow.querySelectorAll<HTMLButtonElement>('.diff-btn');
    for (const btn of buttons) {
      const d = btn.dataset.difficulty as DifficultyId | undefined;
      const on = d === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (d && d in DIFFICULTIES) {
        const p = getDifficulty(d);
        setTip(
          btn,
          `${p.label}\n${p.blurb}\nSelect before jack-in — scales hostile ACC, integrity, and AI.`,
          'below',
        );
      }
    }
    this.els.difficultyBlurb.textContent = profile.blurb;
    this.refreshDeploySummary();
  }

  private wireMenuTabs() {
    if (this.tabsWired) return;
    this.tabsWired = true;
    const nav = document.getElementById('menu-tabs');
    nav?.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('.menu-tab') as HTMLButtonElement | null;
      const id = btn?.dataset.tab as 'ops' | 'squad' | 'settings' | undefined;
      if (!id) return;
      this.setMenuTab(id);
      sfx.ui();
    });
    this.setMenuTab(this.menuTab);
  }

  setMenuTab(id: 'ops' | 'squad' | 'settings') {
    this.menuTab = id;
    const tabs = document.querySelectorAll<HTMLButtonElement>('.menu-tab');
    for (const btn of tabs) {
      const on = btn.dataset.tab === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const panelId of ['ops', 'squad', 'settings'] as const) {
      const panel = document.getElementById(`tab-${panelId}`);
      if (!panel) continue;
      const on = panelId === id;
      panel.classList.toggle('hidden', !on);
      panel.classList.toggle('active', on);
      if (on) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }
    // Keep sticky tabs readable after long OPS scroll
    const shell = document.querySelector('.briefing-panel');
    if (shell instanceof HTMLElement) {
      shell.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (id === 'ops') this.refreshRecordsPanel();
    if (id === 'squad') this.refreshSquadDossier();
  }

  /** Compact deploy line in sticky footer. */
  private refreshDeploySummary() {
    const el = document.getElementById('menu-deploy-summary');
    if (!el) return;
    const mapId = this.resolveDeployMapId();
    const map = getMapInfo(mapId).short;
    const diff = getDifficulty(this.difficulty).label;
    const mode =
      this.playMode === 'campaign'
        ? this.campaign.track === 'extended'
          ? 'CAMPAIGN EXT'
          : 'CAMPAIGN'
        : 'SKIRMISH';
    let extra = '';
    if (this.playMode === 'skirmish' && this.missionType === 'deadline') {
      extra = ' · DEADLINE';
    } else if (this.playMode === 'campaign') {
      const op = getCurrentOp(this.campaign);
      const n = getOpCount(this.campaign.track);
      extra = ` · ${op.codename} · ${this.campaign.opIndex + 1}/${n}`;
      if (op.missionType === 'deadline') extra += ' · DEADLINE';
    }
    el.textContent = `${mode} · ${map} · ${diff}${extra}`;
  }

  private wirePlayMode() {
    if (this.modeWired) return;
    this.modeWired = true;
    this.els.modeRow?.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest('.mode-btn') as HTMLButtonElement | null;
      if (!t?.dataset.mode) return;
      const mode = t.dataset.mode as PlayMode;
      if (mode !== 'campaign' && mode !== 'skirmish') return;
      this.setPlayMode(mode);
    });
    this.setPlayMode(this.playMode);
  }

  private refreshCampaignUI() {
    const campaign = this.playMode === 'campaign';
    this.els.campaignPanel?.classList.toggle('hidden', !campaign);
    document.getElementById('campaign-track-row')?.classList.toggle('hidden', !campaign);
    this.els.mapRow.classList.toggle('hidden', campaign);
    this.els.campaignMapLock?.classList.toggle('hidden', !campaign);
    // Campaign ops lock objective type; skirmish can pick
    this.els.missionTypeSection?.classList.toggle('hidden', campaign);
    if (this.els.mapSectionTitle) {
      this.els.mapSectionTitle.textContent = campaign ? 'CURRENT OP NODE' : 'TARGET NODE';
    }

    // Track chips
    const track = this.campaign.track ?? 'standard';
    document.querySelectorAll<HTMLButtonElement>('.track-btn').forEach((btn) => {
      const on = btn.dataset.track === track;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // Campaign reset always available (OPS + footer)
    this.els.btnNewCampaign?.classList.remove('hidden');
    this.els.btnResetCampaign?.classList.remove('hidden');
    this.refreshCampaignResetLabels();

    if (!campaign) {
      this.els.campaignCompleteNote?.classList.add('hidden');
      const info = getMapInfo(this.mapId);
      this.els.mapBlurb.textContent = info.blurb;
      this.refreshDeploySummary();
      return;
    }

    const op = getCurrentOp(this.campaign);
    const mapInfo = getMapInfo(op.mapId);
    const n = getOpCount(this.campaign.track);
    // Sync locked map selection for display consistency
    this.mapId = op.mapId;
    this.setMapId(op.mapId);

    if (this.els.campaignOpCode) this.els.campaignOpCode.textContent = op.codename;
    if (this.els.campaignOpTitle) this.els.campaignOpTitle.textContent = op.title;
    if (this.els.campaignOpBlurb) {
      this.els.campaignOpBlurb.textContent = `${op.blurb} · Arc ${this.campaign.opIndex + 1}/${n}`;
    }
    if (this.els.campaignLockMap) this.els.campaignLockMap.textContent = mapInfo.short;
    this.setMissionType(op.missionType);
    const typeNote =
      op.missionType === 'deadline'
        ? ` · DEADLINE ${defaultTurnLimit(op.mapId)} CYC`
        : '';
    this.els.mapBlurb.textContent = `${mapInfo.blurb} · Suggested ICE: ${getDifficulty(op.suggestedDifficulty).label}${typeNote}`;

    if (this.els.campaignCompleteNote) {
      this.els.campaignCompleteNote.classList.toggle('hidden', !this.campaign.completed);
      if (this.campaign.completed) {
        this.els.campaignCompleteNote.textContent =
          this.campaign.track === 'extended'
            ? 'Extended arc complete (10/10). Start a new extended run or switch to Standard / Skirmish.'
            : 'Standard arc complete (3/3). Start a new campaign, try Extended 10, or switch to Skirmish.';
      }
    }

    // Dynamic stepper (3 or 10)
    this.renderCampaignStepper(n);

    // Deploy sublabel
    const sub = this.els.btnDeploy.querySelector('.btn-jack-sub');
    if (sub) {
      if (this.campaign.completed) {
        sub.textContent = 'SKIRMISH OR NEW CAMPAIGN';
      } else {
        sub.textContent = `${op.codename} →`;
      }
    }
    this.refreshDeploySummary();
  }

  private renderCampaignStepper(n: number) {
    const host = this.els.campaignStepper;
    if (!host) return;
    host.innerHTML = '';
    host.classList.toggle('extended', n > 5);
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const line = document.createElement('span');
        line.className = 'camp-line';
        host.appendChild(line);
      }
      const step = document.createElement('span');
      step.className = 'camp-step';
      step.dataset.step = String(i);
      step.textContent = String(i + 1);
      const done =
        (this.campaign.clears[i] ?? 0) > 0 ||
        (this.campaign.completed && i < n);
      step.classList.toggle('done', done);
      step.classList.toggle(
        'active',
        !this.campaign.completed && i === this.campaign.opIndex,
      );
      step.classList.toggle('complete-all', this.campaign.completed);
      host.appendChild(step);
    }
  }

  private wireCampaignTrack() {
    if (this.trackWired) return;
    this.trackWired = true;
    document.getElementById('campaign-track-row')?.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('.track-btn') as HTMLButtonElement | null;
      const track = btn?.dataset.track as CampaignTrack | undefined;
      if (track !== 'standard' && track !== 'extended') return;
      if (track === this.campaign.track) return;
      this.onCampaignTrackChange?.(track);
      sfx.ui();
    });
  }

  private wireRecords() {
    if (this.recordsWired) return;
    this.recordsWired = true;
    document.getElementById('records-board-row')?.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('.records-btn') as HTMLButtonElement | null;
      const board = btn?.dataset.records as 'skirmish' | 'campaign' | undefined;
      if (board !== 'skirmish' && board !== 'campaign') return;
      this.recordsBoard = board;
      this.refreshRecordsPanel();
      sfx.ui();
    });
    document.getElementById('btn-clear-records')?.addEventListener('click', () => {
      if (!window.confirm('Clear all local skirmish and campaign records?')) return;
      clearLeaderboard();
      this.refreshRecordsPanel();
      sfx.ui();
      this.showToast('RECORDS WIPED', false, 1600);
    });
    document.getElementById('btn-share-top')?.addEventListener('click', () => {
      const board = loadLeaderboard();
      const list = this.recordsBoard === 'campaign' ? board.campaign : board.skirmish;
      const top = list[0];
      if (!top) return;
      shareScoreToX(top, 1);
      sfx.ui();
      this.showToast('OPENING X COMPOSE…', false, 1400);
    });
    document.getElementById('records-list')?.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('.rec-share') as HTMLButtonElement | null;
      if (!btn) return;
      const id = btn.dataset.scoreId;
      if (!id) return;
      const board = loadLeaderboard();
      const list = this.recordsBoard === 'campaign' ? board.campaign : board.skirmish;
      const idx = list.findIndex((e) => e.id === id);
      if (idx < 0) return;
      shareScoreToX(list[idx]!, idx + 1);
      sfx.ui();
      this.showToast('OPENING X COMPOSE…', false, 1400);
    });
    this.refreshRecordsPanel();
  }

  refreshRecordsPanel() {
    const board = loadLeaderboard();
    const list = this.recordsBoard === 'campaign' ? board.campaign : board.skirmish;
    document.querySelectorAll<HTMLButtonElement>('.records-btn').forEach((btn) => {
      const on = btn.dataset.records === this.recordsBoard;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const ol = document.getElementById('records-list');
    const empty = document.getElementById('records-empty');
    const head = document.querySelector('.records-list-head');
    const shareTop = document.getElementById('btn-share-top') as HTMLButtonElement | null;
    if (ol) {
      ol.innerHTML = '';
      list.forEach((e, i) => {
        const li = document.createElement('li');
        li.className = 'records-row' + (i === 0 ? ' gold' : i === 1 ? ' silver' : i === 2 ? ' bronze' : '');
        const medal = i === 0 ? '◆' : i === 1 ? '◇' : i === 2 ? '○' : String(i + 1);
        li.innerHTML =
          `<span class="rec-rank">${medal}</span>` +
          `<span class="rec-score">${e.score.toLocaleString()}</span>` +
          `<span class="rec-label" title="${escapeAttr(e.label)}">${escapeHtml(e.label)}</span>` +
          `<button type="button" class="rec-share" data-score-id="${escapeAttr(e.id)}" title="Share this run on X" aria-label="Share score on X">𝕏</button>`;
        ol.appendChild(li);
      });
    }
    empty?.classList.toggle('hidden', list.length > 0);
    head?.classList.toggle('hidden', list.length === 0);
    if (shareTop) {
      shareTop.disabled = list.length === 0;
      shareTop.title =
        list.length > 0
          ? `Share your #1 ${this.recordsBoard} run on X`
          : 'Clear a node first to share';
    }
  }

  /** Footer + OPS button labels: NEW when stack clear, else RESET. */
  private refreshCampaignResetLabels() {
    const label = this.campaign.completed ? 'NEW CAMPAIGN' : 'RESET CAMPAIGN';
    for (const btn of [this.els.btnNewCampaign, this.els.btnResetCampaign]) {
      if (btn) btn.textContent = label;
    }
  }

  private wireMapPicker() {
    if (this.mapWired) return;
    this.mapWired = true;
    this.els.mapRow.addEventListener('click', (ev) => {
      if (this.playMode === 'campaign') return;
      const t = (ev.target as HTMLElement).closest('.map-btn') as HTMLButtonElement | null;
      if (!t?.dataset.map) return;
      const id = t.dataset.map as MapId;
      if (!(id in MAPS)) return;
      this.setMapId(id);
    });
    this.setMapId(this.mapId);
  }

  private wireDifficulty() {
    if (this.difficultyWired) return;
    this.difficultyWired = true;
    this.els.difficultyRow.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest('.diff-btn') as HTMLButtonElement | null;
      if (!t?.dataset.difficulty) return;
      const id = t.dataset.difficulty as DifficultyId;
      if (!(id in DIFFICULTIES)) return;
      this.setDifficulty(id);
    });
    this.setDifficulty(this.difficulty);
  }

  private wireDebugModeToggle() {
    if (this.debugModeWired) return;
    this.debugModeWired = true;
    const el = this.els.debugModeToggle;
    if (!el) return;
    el.checked = this.debugMode;
    el.addEventListener('change', () => {
      this.setDebugMode(el.checked);
    });
  }

  /** Ambient music controls — lobby panel + in-HUD mute. */
  private wireMusicControls() {
    if (this.musicWired) return;
    this.musicWired = true;

    const enabledEl = document.getElementById('music-enabled') as HTMLInputElement | null;
    const volEl = document.getElementById('music-volume') as HTMLInputElement | null;
    const fileEl = document.getElementById('music-file') as HTMLInputElement | null;
    const fileBtn = document.getElementById('music-file-btn');
    const hudBtn = document.getElementById('btn-music-toggle') as HTMLButtonElement | null;
    const trackRow = document.getElementById('music-track-row');

    const sync = (p: MusicPrefs) => this.syncMusicUI(p);
    music.onChange(sync);
    sync(music.getPrefs());

    enabledEl?.addEventListener('change', () => {
      music.unlock();
      music.setEnabled(enabledEl.checked);
      sfx.ui();
    });

    volEl?.addEventListener('input', () => {
      music.setVolume(Number(volEl.value) / 100);
    });

    trackRow?.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('.music-btn') as HTMLButtonElement | null;
      if (!btn?.dataset.music) return;
      music.unlock();
      music.setTrack(btn.dataset.music as MusicTrackId);
      sfx.ui();
      // Local file: open picker when selected with no file yet
      if (btn.dataset.music === 'custom' && !music.getPrefs().customName) {
        fileEl?.click();
      }
    });

    fileBtn?.addEventListener('click', () => {
      music.unlock();
      fileEl?.click();
    });

    fileEl?.addEventListener('change', () => {
      const file = fileEl.files?.[0];
      if (!file) return;
      void music.loadCustomFile(file).then((ok) => {
        if (!ok) {
          this.showToast('UNSUPPORTED AUDIO FILE', true);
          return;
        }
        music.unlock();
        music.setEnabled(true);
        sfx.shop();
        this.showToast(`LOADED · ${file.name}`, false, 2200);
      });
    });

    hudBtn?.addEventListener('click', () => {
      music.unlock();
      const on = music.toggle();
      sfx.ui();
      this.showToast(on ? 'AMBIENT FEED ON' : 'AMBIENT FEED OFF', false, 1400);
    });
  }

  private syncMusicUI(p: MusicPrefs) {
    const enabledEl = document.getElementById('music-enabled') as HTMLInputElement | null;
    const volEl = document.getElementById('music-volume') as HTMLInputElement | null;
    const volPct = document.getElementById('music-vol-pct');
    const status = document.getElementById('music-status');
    const blurb = document.getElementById('music-blurb');
    const fileName = document.getElementById('music-file-name');
    const hudBtn = document.getElementById('btn-music-toggle') as HTMLButtonElement | null;
    const trackRow = document.getElementById('music-track-row');

    if (enabledEl) enabledEl.checked = p.enabled;
    if (volEl) volEl.value = String(Math.round(p.volume * 100));
    if (volPct) volPct.textContent = `${Math.round(p.volume * 100)}%`;

    const info = MUSIC_TRACKS.find((t) => t.id === p.track);
    const label =
      p.track === 'custom' && p.customName
        ? p.customName
        : (info?.name ?? 'NEON RAIN');
    if (status) status.textContent = `${label} · ${p.enabled ? 'on' : 'off'}`;
    if (blurb) {
      blurb.textContent =
        p.track === 'custom' && p.customName
          ? `Playing local file · ${p.customName}`
          : (info?.blurb ?? '');
    }
    if (fileName) {
      fileName.textContent = p.customName ? p.customName : 'No file loaded';
      fileName.classList.toggle('has-file', Boolean(p.customName));
    }

    trackRow?.querySelectorAll<HTMLButtonElement>('.music-btn').forEach((btn) => {
      const on = btn.dataset.music === p.track;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (hudBtn) {
      hudBtn.classList.toggle('muted', !p.enabled);
      hudBtn.setAttribute('aria-pressed', p.enabled ? 'true' : 'false');
      hudBtn.title = p.enabled ? 'Mute ambient music' : 'Unmute ambient music';
    }
  }

  setDebugMode(on: boolean) {
    this.debugMode = on;
    if (this.els.debugModeToggle) {
      this.els.debugModeToggle.checked = on;
    }
    // Enabling debug during an active breach taints the run (no XP / records)
    if (on && this.game && !this.game.isMissionOver() && this.game.state.phase !== 'briefing') {
      this.game.markDebugUsed();
      this.showToast('DBG PRACTICE · THIS RUN: NO XP / RECORDS', true, 2400);
    }
    this.applyDebugBarVisibility();
  }

  private applyDebugBarVisibility() {
    const bar = this.els.debugBar;
    const show = this.debugMode && !this.els.hud.classList.contains('hidden');
    bar.classList.toggle('hidden', !show);
    if (show) bar.removeAttribute('hidden');
    else bar.setAttribute('hidden', '');
  }

  private wireDebugBar() {
    if (this.debugWired) return;
    this.debugWired = true;
    this.els.debugBar.addEventListener('click', (ev) => {
      if (!this.debugMode) return;
      const btn = (ev.target as HTMLElement).closest('.debug-btn') as HTMLButtonElement | null;
      if (!btn?.dataset.debug || !this.game) return;
      this.runDebug(btn.dataset.debug);
    });
  }

  private runDebug(action: string) {
    if (!this.debugMode) return;
    const g = this.game;
    if (action === 'resetXp') {
      // Prefer full squad reset path so main roster state stays in sync
      if (this.onResetSquad) this.onResetSquad();
      else {
        resetRoster();
        this.refreshLobbyWounds();
        this.showToast('DBG · ROSTER XP WIPED — re-jack to apply', false);
      }
      return;
    }
    if (!g || g.isMissionOver()) return;
    // Any cheat use disqualifies XP / leaderboard for this breach
    g.markDebugUsed();
    switch (action) {
      case 'fog':
        g.debugClearFog();
        break;
      case 'freeCyc':
        g.debugToggleFreeCyc();
        break;
      case 'god':
        g.debugToggleGod();
        break;
      case 'hit':
        g.debugToggleAlwaysHit();
        break;
      case 'heal':
        g.debugHealTeam();
        break;
      case 'refill':
        g.debugRefillCyc();
        break;
      case 'kill':
        g.debugKillHostiles();
        break;
      case 'port':
        g.debugWinPort();
        break;
      case 'xp':
        g.debugGrantXp(80);
        break;
      default:
        return;
    }
    this.refreshDebugBar();
    this.refresh();
    this.onDebugSync?.();
  }

  refreshDebugBar() {
    if (!this.game) return;
    const d = this.game.debug;
    for (const btn of this.els.debugBar.querySelectorAll<HTMLButtonElement>('.debug-btn')) {
      const id = btn.dataset.debug;
      const on =
        (id === 'fog' && d.revealAll) ||
        (id === 'freeCyc' && d.freeCyc) ||
        (id === 'god' && d.godMode) ||
        (id === 'hit' && d.alwaysHit);
      btn.classList.toggle('active', on);
    }
  }

  showBriefing() {
    this.els.briefing.classList.remove('hidden');
    this.els.hud.classList.add('hidden');
    this.els.result.classList.add('hidden');
    this.els.result.classList.remove('campaign-finale', 'deadline-fail');
    this.els.campaignVictory?.classList.add('hidden');
    this.els.resultStandard?.classList.remove('hidden');
    this.els.debriefPanel?.classList.add('hidden');
    this.refreshLobbyWounds();
    this.refreshLoadoutShop();
    this.refreshCampaignUI();
    this.refreshRecordsPanel();
    this.applyDebugBarVisibility();
  }

  showHud() {
    this.els.briefing.classList.add('hidden');
    this.els.hud.classList.remove('hidden');
    this.els.result.classList.add('hidden');
    this.els.result.classList.remove('campaign-finale');
    this.applyDebugBarVisibility();
  }

  showResult(
    victory: boolean,
    detail?: string,
    opts?: { campaignFinale?: boolean; reason?: string; credEarned?: number },
  ) {
    this.els.result.classList.remove('hidden');
    this.els.hud.classList.add('hidden');
    this.els.btnEnd.classList.remove('deadline-urgent');

    const finale = Boolean(opts?.campaignFinale && victory);
    const deadline = !victory && opts?.reason === 'deadline';
    this.els.result.classList.toggle('campaign-finale', finale);
    this.els.result.classList.toggle('deadline-fail', deadline);
    this.els.campaignVictory?.classList.toggle('hidden', !finale);
    this.els.resultStandard?.classList.toggle('hidden', finale);

    if (finale) {
      this.els.debriefPanel?.classList.add('hidden');
      this.populateCampaignVictory(opts?.reason ?? '');
      this.els.resultTitle.textContent = 'STACK CLEAR';
      this.els.resultTitle.className = 'victory';
      this.els.resultTag.textContent = 'CAMPAIGN COMPLETE';
      this.els.resultBody.textContent = detail ?? '';
      sfx.campaignVictory();
    } else {
      this.els.resultTitle.textContent = victory
        ? 'NODE CLEAN'
        : deadline
          ? 'ICE WAKE'
          : 'LINK DEAD';
      this.els.resultTitle.className = victory ? 'victory' : 'defeat';
      this.els.resultTag.textContent = victory
        ? 'BREACH SUCCESS'
        : deadline
          ? 'DEADLINE MISSED'
          : 'BREACH FAILED';
      this.els.resultBody.textContent =
        detail ??
        (victory
          ? 'All hostile processes killed. Mini-game complete — return to the outer sim.'
          : 'Probe team integrity zeroed. Corporate ICE holds the die. Mini-game failed.');
      this.populateDebrief(victory, opts?.reason ?? '', opts?.credEarned ?? 0);
    }

    // Continue CTA: campaign next / retry / new; hidden in skirmish
    const cont = this.els.btnContinue;
    if (cont) {
      if (this.playMode !== 'campaign') {
        cont.classList.add('hidden');
        cont.onclick = null;
      } else if (victory && this.campaign.completed) {
        cont.textContent = 'NEW CAMPAIGN';
        cont.classList.remove('hidden');
        cont.onclick = () => this.onNewCampaign?.();
      } else if (victory) {
        cont.textContent = 'NEXT OP';
        cont.classList.remove('hidden');
        cont.onclick = () => this.onContinue?.();
      } else {
        cont.textContent = 'RETRY OP';
        cont.classList.remove('hidden');
        cont.onclick = () => this.onContinue?.();
      }
    }
    this.els.btnRestart.textContent =
      this.playMode === 'campaign' ? 'LOBBY' : 'RE-JACK / LOBBY';

    this.applyDebugBarVisibility();
  }

  /** Post-op debrief for every finished breach (skirmish + mid-campaign). */
  private populateDebrief(victory: boolean, reason: string, credEarned: number) {
    const panel = this.els.debriefPanel;
    if (!panel || !this.game) return;
    panel.classList.remove('hidden');

    const stats = collectMissionStats(this.game, reason);
    const grade = debriefGrade({
      victory,
      turns: stats.turns,
      squadAlive: stats.squadAlive,
      squadTotal: stats.squadTotal,
      reason,
    });
    const score = computeMissionScore({
      victory,
      grade,
      turns: stats.turns,
      squadAlive: stats.squadAlive,
      squadTotal: stats.squadTotal,
      enemyKills: stats.enemyKills,
      reason,
      difficulty: this.difficulty,
      mapId: this.game.state.mapId,
      missionType: this.game.state.missionType,
    });

    if (this.els.debriefGrade) {
      this.els.debriefGrade.textContent = grade;
      this.els.debriefGrade.className = `debrief-grade grade-${grade.toLowerCase()}`;
    }
    if (this.els.debriefScore) this.els.debriefScore.textContent = score.toLocaleString();
    // Apply ranking note written just before showResult
    if (this.pendingScoreNote) {
      const n = this.pendingScoreNote;
      this.pendingScoreNote = null;
      if (n.practice) {
        if (this.els.debriefScoreNote) {
          this.els.debriefScoreNote.textContent =
            'DBG PRACTICE — no XP, CRED, or RECORDS from this breach.';
          this.els.debriefScoreNote.classList.remove('hidden', 'pb');
        }
        if (this.els.debriefScore) this.els.debriefScore.textContent = '—';
      } else if (n.campaignRun) this.setDebriefScoreNoteCampaign(n.score);
      else this.setDebriefScoreNote(n.isBest, n.placed, n.rank, n.score, n.defeat);
    } else if (this.els.debriefScoreNote) {
      this.els.debriefScoreNote.classList.add('hidden');
    }
    if (this.els.debriefTurns) this.els.debriefTurns.textContent = String(stats.turns);
    if (this.els.debriefKills) this.els.debriefKills.textContent = String(stats.enemyKills);
    if (this.els.debriefAlive) {
      this.els.debriefAlive.textContent = `${stats.squadAlive}/${stats.squadTotal}`;
    }
    if (this.els.debriefXp) this.els.debriefXp.textContent = `+${stats.missionXpTotal}`;
    if (this.els.debriefWin) {
      this.els.debriefWin.textContent = !victory
        ? reason === 'deadline'
          ? 'DEADLINE'
          : 'LINK DEAD'
        : reason === 'data_port'
          ? 'DATA PORT'
          : 'HOSTILE WIPE';
    }

    const rosterEl = this.els.debriefRoster;
    if (rosterEl) {
      rosterEl.innerHTML = '';
      const players = [...this.game.state.units.values()]
        .filter((u) => u.def.team === 'player')
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const u of players) {
        const row = document.createElement('div');
        const willWound = !u.alive;
        row.className =
          'debrief-row' + (u.alive ? '' : ' dead') + (u.wounded && u.alive ? ' was-wounded' : '');
        const status = !u.alive
          ? 'CRASH → WOUNDED'
          : u.wounded
            ? 'HEALED'
            : 'STABLE';
        row.innerHTML =
          `<span class="db-name">${u.def.name}</span>` +
          `<span class="db-lvl">L${u.level}</span>` +
          `<span class="db-xp">+${u.missionXp} XP</span>` +
          `<span class="db-status">${status}</span>`;
        if (willWound) row.classList.add('wound-next');
        rosterEl.appendChild(row);
      }
    }

    const woundsEl = this.els.debriefWounds;
    if (woundsEl) {
      const crashed = [...this.game.state.units.values()].filter(
        (u) => u.def.team === 'player' && !u.alive,
      );
      const credLine =
        credEarned > 0 ? ` · +${credEarned} CRED banked` : '';
      if (crashed.length === 0) {
        woundsEl.textContent =
          `All probes stable. No wound flags for the next breach.${credLine}`;
        woundsEl.classList.remove('warn');
      } else {
        woundsEl.textContent =
          `${crashed.map((u) => u.def.name).join(', ')} crashed — next deploy: −1 INT, −12 ACC, −1 mobility. Survive a mission to clear.${credLine}`;
        woundsEl.classList.add('warn');
      }
    }
  }

  /** Fill campaign-complete deck with stats + roster XP. */
  private populateCampaignVictory(reason: string) {
    if (!this.game) return;
    const stats = collectMissionStats(this.game, reason);
    const missionXp = stats.missionXpTotal;

    const n = getOpCount(this.campaign.track);
    const track = this.campaign.track ?? 'standard';
    if (this.els.cvOps) {
      this.els.cvOps.textContent = `${n}/${n}${track === 'extended' ? ' EXT' : ''}`;
    }
    const runScore = computeCampaignScore({
      missionScores: [this.campaign.runScore],
      completed: true,
      track,
      difficulty: this.campaign.runDifficulty ?? this.difficulty,
    });
    if (this.els.cvRunScore) this.els.cvRunScore.textContent = String(runScore);
    if (this.els.cvTotalXp) {
      this.els.cvTotalXp.textContent = `+${this.campaign.totalXpEarned}`;
    }
    if (this.els.cvMissionXp) this.els.cvMissionXp.textContent = `+${missionXp}`;
    if (this.els.cvTurns) this.els.cvTurns.textContent = String(stats.turns);
    if (this.els.cvKills) this.els.cvKills.textContent = String(stats.enemyKills);
    if (this.els.cvAlive) {
      this.els.cvAlive.textContent = `${stats.squadAlive}/${stats.squadTotal}`;
    }
    if (this.els.cvWin) {
      this.els.cvWin.textContent =
        reason === 'data_port' ? 'DATA PORT LINK' : 'HOSTILE WIPE';
    }
    if (this.els.cvSub) {
      this.els.cvSub.textContent =
        track === 'extended'
          ? `Extended arc cleared — all ${n} operations. Probe privilege retained across the die.`
          : `Standard arc cleared — all ${n} operations. Probe privilege retained across the die.`;
    }
    if (this.els.cvBody) {
      this.els.cvBody.textContent =
        `Final op closed on cycle T${stats.turns}. ` +
        `${stats.enemyKills} hostile process${stats.enemyKills === 1 ? '' : 'es'} terminated. ` +
        `Run score ${runScore}. Campaign XP banked: +${this.campaign.totalXpEarned}.`;
    }

    const rows = this.els.cvRosterRows;
    if (rows) {
      rows.innerHTML = '';
      const players = [...this.game.state.units.values()]
        .filter((u) => u.def.team === 'player')
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const u of players) {
        const row = document.createElement('div');
        row.className = 'cv-roster-row' + (u.alive ? '' : ' dead');
        row.innerHTML =
          `<span class="cv-r-name">${u.def.name}</span>` +
          `<span class="cv-r-lvl">L${u.level}</span>` +
          `<span class="cv-r-xp">+${u.missionXp} XP</span>` +
          `<span class="cv-r-status">${u.alive ? (u.wounded ? 'WND→OK' : 'ONLINE') : 'CRASH'}</span>`;
        rows.appendChild(row);
      }
    }
  }

  /** Lobby: show which probes are still wounded from last crash. */
  refreshLobbyWounds() {
    this.refreshSquadDossier();
    const el = document.getElementById('lobby-wound-strip');
    if (!el) return;
    try {
      const r = loadRoster();
      const wounded = r.operatives.filter((o) => o.wounded);
      if (wounded.length === 0) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
      }
      el.classList.remove('hidden');
      el.textContent =
        `WOUNDED DEPLOY: ${wounded.map((o) => o.name).join(', ')} — −1 INT · −12 ACC · −1 mobility until they finish a breach alive.`;
    } catch {
      el.classList.add('hidden');
    }
  }

  setMode(m: Mode) {
    this.mode = m;
    this.setModeCursor(m.type);
    this.onModeChange?.(m);
    this.refreshAbilities();
  }

  refresh() {
    if (!this.game) return;
    const g = this.game;
    const phase = g.state.phase;

    const diffLabel = getDifficulty(g.state.difficulty).label;
    const mapLabel = getMapInfo(
      (g.state.mapId in MAPS ? g.state.mapId : 'vesper') as MapId,
    ).short;
    const campPrefix =
      g.state.playMode === 'campaign' && g.state.campaignOpId
        ? `${getCampaignOps(this.campaign.track).find((o) => o.id === g.state.campaignOpId)?.codename ?? 'OP'}  ·  `
        : g.state.playMode === 'campaign'
          ? `${campaignProgressLabel(this.campaign)}  ·  `
          : '';
    if (phase === 'victory') {
      this.els.turn.textContent = 'BREACH OK';
      this.els.turn.classList.remove('enemy', 'deadline');
      this.els.btnEnd.classList.remove('deadline-urgent');
      this.els.objective.classList.remove('clock-warn');
      this.els.objective.textContent = g.state.dataPortSecured
        ? 'DATA PORT SECURED — EXFIL COMPLETE'
        : 'BREACH COMPLETE — ALL HOSTILE PROCESSES KILLED';
    } else if (phase === 'defeat') {
      this.els.turn.textContent = 'LINK DEAD';
      this.els.turn.classList.add('enemy');
      this.els.turn.classList.remove('deadline');
      this.els.btnEnd.classList.remove('deadline-urgent');
      this.els.objective.classList.remove('clock-warn');
      this.els.objective.textContent = 'PROBE TEAM CRASHED — MINI-GAME FAILED';
    } else {
      const rem = g.cyclesRemaining();
      const lastCycle = rem != null && rem <= 1;
      const clockWarn = rem != null && rem <= 3;
      this.els.turn.textContent =
        phase === 'enemy'
          ? 'HOSTILE CYCLE'
          : lastCycle
            ? `LAST CYCLE  ·  T${g.state.turn}`
            : `YOUR CYCLE  ·  T${g.state.turn}`;
      this.els.turn.classList.toggle('enemy', phase === 'enemy');
      this.els.turn.classList.toggle('deadline', clockWarn && phase === 'player');
      this.els.btnEnd.classList.toggle('deadline-urgent', lastCycle && phase === 'player');
      const hostiles = g.hostilesRemaining();
      const squad = g.squadAliveCount();
      const dbg = debugStatusLine(g.debug);
      const clock =
        rem != null
          ? `  ·  CLOCK ${rem}/${g.state.turnLimit}`
          : '';
      let portStatus = 'PORT:N';
      if (g.state.dataPortSecured) {
        portStatus = 'PORT:OK';
      } else if (g.state.portLinkUnitId) {
        portStatus = `PORT:${g.state.portLinkProgress}/${g.state.portLinkRequired}`;
      } else {
        const anyOnPort = g.playerUnits().some((p) => g.isOnDataPort(p));
        if (anyOnPort) portStatus = 'PORT:READY';
      }
      this.els.objective.textContent = `${campPrefix}${mapLabel}  ·  ${diffLabel}${clock}  ·  ${portStatus}  ·  HOSTILES ${hostiles}  ·  PROBES ${squad}/4${dbg ? `  ·  ${dbg}` : ''}`;
      this.els.objective.classList.toggle('clock-warn', clockWarn);
      this.els.objective.classList.toggle('port-linking', Boolean(g.state.portLinkUnitId));
    }

    const sel = g.getSelected();
    if (sel && sel.alive) {
      this.els.unitPanel.classList.remove('hidden');
      this.els.unitName.textContent = sel.def.name;
      this.els.unitLevel.textContent = `L${sel.level}`;
      const cover = bestCoverOnTile(g, sel.pos.x, sel.pos.y);
      const coverLabel =
        cover === 2 ? 'FULL MASK' : cover === 1 ? 'HALF MASK' : 'EXPOSED';
      const woundLabel = sel.wounded ? '  ·  WOUNDED' : '';
      this.els.unitClass.textContent = `${CLASS_LABEL[sel.def.classId]}  ·  ${coverLabel}${woundLabel}`;
      // Wounded: show current (healthy max) — e.g. INT 5/6(7), ACC 58(70)
      this.els.unitHp.innerHTML = formatStatHp(sel);
      this.els.unitAp.textContent = g.debug.freeCyc ? '∞' : `${sel.ap}`;
      this.els.unitAim.innerHTML = formatStatAim(sel);
      this.els.unitArmor.textContent = `${sel.def.armor}`;
      const hpRatio = sel.hp / sel.def.maxHp;
      this.els.hpFill.style.width = `${hpRatio * 100}%`;
      this.els.unitPanel.classList.toggle('unit-wounded', sel.wounded);
      this.els.unitPanel.classList.toggle('unit-critical', sel.alive && hpRatio <= 0.35);
      const bar = xpBar(sel.xp);
      if (bar.level >= MAX_LEVEL) {
        this.els.xpFill.style.width = '100%';
        this.els.xpText.textContent = 'MAX';
      } else {
        this.els.xpFill.style.width = `${bar.pct}%`;
        this.els.xpText.textContent = `${bar.current}/${bar.need}`;
      }
    } else {
      this.els.unitPanel.classList.add('hidden');
    }

    this.refreshAbilities();
    this.refreshSquad();
    this.refreshDebugBar();
  }

  refreshSquad() {
    if (!this.game) return;
    const g = this.game;
    const bar = this.els.squadBar;
    if (g.state.phase === 'briefing' || g.isMissionOver()) {
      bar.innerHTML = '';
      return;
    }
    const players = [...g.state.units.values()]
      .filter((u) => u.def.team === 'player')
      .sort((a, b) => a.id.localeCompare(b.id));

    bar.innerHTML = '';
    for (const u of players) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'squad-chip';
      if (g.state.selectedId === u.id) btn.classList.add('selected');
      if (!u.alive) btn.classList.add('dead');
      const hpPct = Math.max(0, (u.hp / u.def.maxHp) * 100);
      if (u.wounded) btn.classList.add('wounded');
      if (u.alive && hpPct <= 35) btn.classList.add('critical');
      btn.innerHTML = `<div class="sc-name">${u.def.name} <span class="sc-lvl">L${u.level}</span>${u.wounded ? ' <span class="sc-wound">WND</span>' : ''}</div>
        <div class="sc-meta">${CLASS_LABEL[u.def.classId]} · <span class="sc-ap">${u.alive ? u.ap + ' CYC' : 'CRASH'}</span></div>
        <div class="sc-hp"><i style="width:${hpPct}%"></i></div>`;
      if (u.alive && g.state.phase === 'player') {
        btn.onclick = () => this.onSelectUnit?.(u.id);
        const bar = xpBar(u.xp);
        const xpLine =
          bar.level >= MAX_LEVEL
            ? 'XP MAX'
            : `XP ${bar.current}/${bar.need}`;
        const full = healthyTotals(u);
        setTip(
          btn,
          `${u.def.name} · L${u.level} · ${CLASS_LABEL[u.def.classId]}${u.wounded ? ' · WOUNDED' : ''}\n` +
            (u.wounded
              ? `INT ${u.hp}/${u.def.maxHp}(${full.maxHp}) integrity (wounded / full)\n` +
                `CYC ${u.ap} cycles\n` +
                `ACC ${u.def.aim}(${full.aim}) accuracy · mobility ${u.def.mobility}(${full.mobility})\n` +
                `SHD ${u.def.armor} shield\n`
              : `INT ${u.hp}/${u.def.maxHp} integrity (HP)\n` +
                `CYC ${u.ap} cycles (action points)\n` +
                `ACC ${u.def.aim} accuracy · SHD ${u.def.armor} shield (armor)\n`) +
            `${xpLine}\nClick to select this probe.`,
        );
      } else if (!u.alive) {
        setTip(btn, `${u.def.name} · CRASHED\nIntegrity zero — process is offline.`);
      }
      bar.appendChild(btn);
    }
  }

  refreshAbilities() {
    if (!this.game) return;
    const g = this.game;
    const sel = g.getSelected();
    const bar = this.els.abilityBar;
    bar.innerHTML = '';
    if (!sel || sel.def.team !== 'player' || g.state.phase !== 'player') return;

    const keys = ['1', '2', '3', '4', '5', '6', '7'];
    const list = sel.def.abilities.filter((a) => a !== 'move' && a !== 'dash');
    // Always include move as mode default; link.sys only when on the pylon
    const abilities: AbilityId[] = ['move', ...list];
    if (g.isOnDataPort(sel) && !g.state.dataPortSecured) {
      abilities.push('link');
    }

    abilities.forEach((id, i) => {
      const def = ABILITIES[id];
      const btn = document.createElement('button');
      btn.className = 'ability';
      if (id === 'link') btn.classList.add('ability-link');
      if (
        (this.mode.type === 'shoot' && id === 'shoot') ||
        (this.mode.type === 'grenade' && id === 'grenade') ||
        (this.mode.type === 'breach' && id === 'breach') ||
        (this.mode.type === 'suppress' && id === 'suppress') ||
        (this.mode.type === 'smoke' && id === 'smoke') ||
        (this.mode.type === 'heal' && id === 'heal') ||
        (this.mode.type === 'move' && id === 'move') ||
        (this.mode.type === 'select' && id === 'move')
      ) {
        btn.classList.add('active');
      }
      if (id === 'link' && g.state.portLinkUnitId === sel.id) {
        btn.classList.add('active');
      }

      const ready = g.abilityReady(sel, id);
      const onCd = (sel.cooldowns[id] ?? 0) > 0;
      btn.disabled = !ready && id !== 'move';

      const costLabel = g.debug.freeCyc ? 'FREE' : `${def.apCost} CYC`;
      btn.innerHTML = `<span class="key">${keys[i] ?? ''}</span><span class="label">${def.name}</span><span class="cost">${costLabel}</span>`;
      btn.onclick = () => this.activateAbility(id);

      const tipLines = [
        def.name,
        def.description,
        `Cost: ${g.debug.freeCyc ? 'FREE (debug)' : `${def.apCost} CYC (cycles / action points)`}` +
          (def.range != null ? ` · Range: ${def.range} tiles` : ''),
      ];
      if (id === 'link') {
        const need = g.state.portLinkRequired;
        const prog = g.state.portLinkProgress;
        tipLines.push(
          g.state.portLinkUnitId === sel.id
            ? `Channel armed · sync ${prog}/${need} after hostile cycles.`
            : `Arm uplink, then hold the pylon for ${need} hostile cycle${need === 1 ? '' : 's'}.`,
        );
      }
      if (def.endsTurn) tipLines.push('Ends this probe’s cycle when used.');
      if (onCd) tipLines.push(`On cooldown (${sel.cooldowns[id]} turn(s)).`);
      else if (!ready && id !== 'move') tipLines.push('Not ready — need CYC (cycles) or valid target mode.');
      if (id === 'shoot' || id === 'grenade' || id === 'breach' || id === 'suppress' || id === 'smoke' || id === 'heal') {
        tipLines.push('Click to arm, then click a target/tile.');
      }
      setTip(btn, tipLines.join('\n'));

      bar.appendChild(btn);
    });
  }

  activateAbility(id: AbilityId) {
    if (!this.game) return;
    const sel = this.game.getSelected();
    if (!sel) return;

    if (id === 'move') {
      this.setMode({ type: 'move' });
      return;
    }
    if (id === 'shoot') {
      this.setMode({ type: 'shoot' });
      return;
    }
    if (id === 'overwatch') {
      this.game.tryOverwatch(sel.id);
      this.setMode({ type: 'select' });
      this.refresh();
      return;
    }
    if (id === 'grenade') {
      this.setMode({ type: 'grenade' });
      return;
    }
    if (id === 'breach') {
      this.setMode({ type: 'breach' });
      return;
    }
    if (id === 'suppress') {
      this.setMode({ type: 'suppress' });
      return;
    }
    if (id === 'smoke') {
      this.setMode({ type: 'smoke' });
      return;
    }
    if (id === 'heal') {
      this.setMode({ type: 'heal' });
      return;
    }
    if (id === 'link') {
      this.game.tryLinkPort(sel.id);
      this.setMode({ type: 'select' });
      this.refresh();
      return;
    }
    if (id === 'hunker') {
      this.game.tryHunker(sel.id);
      this.setMode({ type: 'select' });
      this.refresh();
    }
  }

  showHitPreview(
    p: ShotPreview | null,
    target?: { name: string; hp: number; maxHp: number } | null,
  ) {
    if (!p) {
      this.els.hitChance.classList.add('hidden');
      return;
    }
    this.els.hitChance.classList.remove('hidden');
    this.els.hitChance.classList.toggle('flank', p.flanked);
    this.els.hitChance.classList.toggle('low', p.hitChance < 40);
    this.els.hitPct.textContent = `${p.hitChance}%`;
    const reason =
      p.reason === 'FLANK'
        ? 'SIDE-CHANNEL'
        : p.reason === 'FULL COVER'
          ? 'FULL MASK'
          : p.reason === 'HALF COVER'
            ? 'HALF MASK'
            : p.reason === 'EXPOSED'
              ? 'EXPOSED'
              : p.reason;
    this.els.hitMeta.textContent = `${reason}  ·  ${p.damageMin}–${p.damageMax} INT dmg  ·  CRIT ${p.critChance}%`;
    this.els.hitMeta.setAttribute(
      'data-tip',
      `Cover: ${reason}\nDamage: ${p.damageMin}–${p.damageMax} integrity if the inject hits\nCrit chance: ${p.critChance}% (bonus damage)`,
    );

    if (target) {
      this.els.hitTarget.textContent = target.name;
      const pct = Math.max(0, (target.hp / target.maxHp) * 100);
      this.els.hitIntFill.style.width = `${pct}%`;
      this.els.hitIntText.textContent = `${target.hp}/${target.maxHp}`;
      // Expected damage framing
      if (p.damageMin >= target.hp) {
        this.els.hitKill.textContent = 'LIKELY KILL ON HIT';
        this.els.hitKill.className = 'hit-kill';
      } else if (p.damageMax >= target.hp) {
        this.els.hitKill.textContent = 'POSSIBLE KILL (HIGH ROLL)';
        this.els.hitKill.className = 'hit-kill warn';
      } else {
        const leftMin = Math.max(0, target.hp - p.damageMax);
        const leftMax = Math.max(0, target.hp - p.damageMin);
        this.els.hitKill.textContent = `SURVIVES AT ${leftMin}–${leftMax} INT`;
        this.els.hitKill.className = 'hit-kill warn';
      }
    } else {
      this.els.hitTarget.textContent = 'TARGET';
      this.els.hitIntFill.style.width = '100%';
      this.els.hitIntText.textContent = '—';
      this.els.hitKill.textContent = '';
    }
  }

  setModeCursor(mode: string) {
    document.body.classList.remove('mode-shoot', 'mode-move', 'mode-target');
    if (mode === 'shoot' || mode === 'suppress' || mode === 'heal') {
      document.body.classList.add('mode-shoot');
    } else if (mode === 'grenade' || mode === 'breach' || mode === 'smoke') {
      document.body.classList.add('mode-target');
    } else if (mode === 'move' || mode === 'select') {
      document.body.classList.add('mode-move');
    }
  }

  flashDamageScreen() {
    const fx = this.els.screenFx;
    fx.classList.remove('flash');
    // reflow to restart animation
    void fx.offsetWidth;
    fx.classList.add('flash');
  }

  private onEvent(e: GameEvent) {
    if (e.type === 'toast') {
      const text = String(e.payload.text);
      const danger = Boolean(e.payload.danger);
      // Hold critical toasts a beat longer
      const long =
        danger ||
        text.includes('LVL') ||
        text.includes('LAST CYCLE') ||
        text.includes('DEADLINE') ||
        text.includes('DATA PORT') ||
        text.includes('BREACH');
      this.showToast(text, danger, long ? 2800 : 2000);
    }
    if (e.type === 'damage') {
      this.floatDamage(
        e.payload.pos as { x: number; y: number },
        Number(e.payload.damage),
        Boolean(e.payload.crit),
        false,
      );
      // Screen flash when a player probe is hit
      const uid = String(e.payload.unitId ?? '');
      const u = this.game?.state.units.get(uid);
      if (u?.def.team === 'player') this.flashDamageScreen();
    }
    if (e.type === 'miss') {
      this.floatDamage(
        e.payload.to as { x: number; y: number },
        0,
        false,
        true,
      );
    }
    if (e.type === 'kill') {
      const uid = String(e.payload.unitId ?? '');
      const u = this.game?.state.units.get(uid);
      if (u) {
        this.showToast(
          u.def.team === 'enemy'
            ? `${u.def.name} · PROCESS KILLED`
            : `${u.def.name} · PROBE CRASHED`,
          u.def.team === 'player',
          u.def.team === 'player' ? 2600 : 2000,
        );
        // Bank XP immediately when a probe crashes so a wipe/reload cannot drop progress
        if (u.def.team === 'player') this.onPersistRoster?.();
      }
    }
    if (
      e.type === 'turnStart' ||
      e.type === 'move' ||
      e.type === 'shot' ||
      e.type === 'kill' ||
      e.type === 'xp' ||
      e.type === 'levelUp' ||
      e.type === 'heal'
    ) {
      this.refresh();
    }
    if (e.type === 'xp') {
      this.onPersistRoster?.();
      if (e.payload.source === 'kill' && this.game) {
        const killer = this.game.state.units.get(String(e.payload.unitId ?? ''));
        if (killer) this.floatXp(killer.pos, Number(e.payload.amount ?? 0));
      }
    }
    if (e.type === 'levelUp') {
      this.onPersistRoster?.();
      if (this.game) {
        const u = this.game.state.units.get(String(e.payload.unitId ?? ''));
        if (u) this.floatLevelUp(u.pos, Number(e.payload.level ?? u.level));
      }
      // Pulse XP bar
      this.els.xpFill.classList.remove('xp-pop');
      void this.els.xpFill.offsetWidth;
      this.els.xpFill.classList.add('xp-pop');
    }
    if (e.type === 'heal') {
      const pos = e.payload.pos as { x: number; y: number } | undefined;
      const amount = Number(e.payload.amount ?? 0);
      if (pos && amount > 0) this.floatHeal(pos, amount);
    }
    if (e.type === 'pickupCollected' && e.payload.kind === 'integrity') {
      const pos = e.payload.pos as { x: number; y: number } | undefined;
      const amount = Number(e.payload.amount ?? 0);
      if (pos && amount > 0) this.floatHeal(pos, amount);
    }
    if (e.type === 'missionEnd') {
      const victory = e.payload.result === 'victory';
      const alive = Number(e.payload.squadAlive ?? 0);
      const reason = String(e.payload.reason ?? '');
      // Debug mode / cheats → practice run: no XP bank, no CRED, no RECORDS
      const practice = Boolean(this.game?.debugTainted);

      // Mission bonus XP once, then persist roster + wound flags
      if (!this.missionXpAwarded && this.game) {
        this.missionXpAwarded = true;
        if (!practice) {
          this.game.awardMissionXp(victory, reason);
        } else {
          // Zero mission XP so debrief lines don't look banked
          for (const u of this.game.state.units.values()) {
            if (u.def.team === 'player') u.missionXp = 0;
          }
        }
        this.onMissionEndPersist?.(practice);
      }

      const missionXp = practice
        ? 0
        : this.game
          ? [...this.game.state.units.values()]
              .filter((u) => u.def.team === 'player')
              .reduce((s, u) => s + u.missionXp, 0)
          : 0;

      // Advance campaign (still OK for practice) but skip XP bank when tainted
      this.onMissionResult?.(victory, missionXp, reason, practice);

      const campaignFinale =
        this.playMode === 'campaign' && victory && this.campaign.completed;

      const stats = this.game
        ? collectMissionStats(this.game, reason)
        : null;
      const grade = stats
        ? debriefGrade({
            victory,
            turns: stats.turns,
            squadAlive: stats.squadAlive,
            squadTotal: stats.squadTotal,
            reason,
          })
        : 'F';
      const credEarned =
        practice || !stats
          ? 0
          : earnCred({
              victory,
              grade,
              enemyKills: stats.enemyKills,
              reason,
            });
      if (credEarned > 0) this.onCredEarned?.(credEarned);

      // Local scores / personal bests — never for debug practice runs
      if (stats && !practice) {
        const score = computeMissionScore({
          victory,
          grade,
          turns: stats.turns,
          squadAlive: stats.squadAlive,
          squadTotal: stats.squadTotal,
          enemyKills: stats.enemyKills,
          reason,
          difficulty: this.difficulty,
          mapId: this.game?.state.mapId,
          missionType: this.game?.state.missionType,
        });
        this.onMissionScore?.({ victory, score, grade, reason, stats });
        this.recordLocalScores({
          victory,
          score,
          grade,
          reason,
          stats,
          campaignFinale,
        });
      } else if (practice) {
        this.pendingScoreNote = {
          isBest: false,
          placed: false,
          rank: 0,
          score: 0,
          defeat: false,
          campaignRun: false,
          practice: true,
        };
      }

      const xpLines = practice ? 'DBG PRACTICE · NO XP BANKED' : this.missionXpSummary();
      let base = victory
        ? reason === 'data_port'
          ? `Data port linked on the far side of the die. ${alive} probe${alive === 1 ? '' : 's'} still live — payload streamed to the outer system.`
          : `Breach success — hostile processes wiped. ${alive} probe${alive === 1 ? '' : 's'} still live. Return to the outer game.`
        : reason === 'deadline'
          ? 'ICE wake timer expired. Deadline missed — corporate kernel reclaimed the die.'
          : 'Probe team crashed. Link severed. Mini-game failed — ICE keeps the node.';

      if (practice) {
        base +=
          '\n\nDBG PRACTICE RUN — debug mode or cheats were used. No XP, CRED, or RECORDS from this breach.';
      }

      if (this.playMode === 'campaign' && !campaignFinale) {
        if (victory) {
          // Branch just locked if path is set and next/current is kernel
          if (this.campaign.vesperPath) {
            const cur = getCurrentOp(this.campaign);
            if (cur.mapId === 'kernel' || this.campaign.opIndex > 0) {
              // Only announce once when path is fresh — after locking op advances past it
              const justLocked =
                this.campaign.vesperPath &&
                (this.campaign.track === 'standard'
                  ? this.campaign.opIndex === 2
                  : this.campaign.opIndex === 4);
              if (justLocked) {
                base +=
                  this.campaign.vesperPath === 'stealth'
                    ? '\n\nVESPER PATH: QUIET — Kernel will be understaffed.'
                    : '\n\nVESPER PATH: LOUD — Kernel is on full alert.';
              }
            }
          }
          const next = getCurrentOp(this.campaign);
          base += `\n\nNext: ${next.codename} — ${next.title}.`;
        } else {
          const cur = getCurrentOp(this.campaign);
          base += `\n\nRetry ${cur.codename} when ready. XP is kept.`;
        }
      }

      const detail = campaignFinale
        ? ''
        : xpLines
          ? `${base}\n\n${xpLines}`
          : base;
      this.showResult(victory, detail, { campaignFinale, reason, credEarned });
      this.refreshRecordsPanel();
      this.refresh();
    }
  }

  private recordLocalScores(opts: {
    victory: boolean;
    score: number;
    grade: string;
    reason: string;
    stats: ReturnType<typeof collectMissionStats>;
    campaignFinale: boolean;
  }) {
    const { victory, score, grade, reason, stats, campaignFinale } = opts;
    const mapId = this.game?.state.mapId ?? this.mapId;
    const mapShort = getMapInfo(mapId as MapId).short;
    const diffLabel = getDifficulty(this.difficulty).label;

    if (this.playMode === 'skirmish' && victory) {
      const r = insertScore(loadLeaderboard(), {
        mode: 'skirmish',
        score,
        grade,
        mapId,
        difficulty: this.difficulty,
        reason,
        turns: stats.turns,
        kills: stats.enemyKills,
        squadAlive: stats.squadAlive,
        label: `${mapShort} · ${diffLabel} · ${grade} · T${stats.turns}`,
      });
      this.pendingScoreNote = {
        isBest: r.isBest,
        placed: r.placed,
        rank: r.rank,
        score,
      };
      if (r.isBest) this.showToast(`PERSONAL BEST · ${score.toLocaleString()}`, false, 2400);
      else if (r.placed) this.showToast(`RECORDS #${r.rank} · ${score.toLocaleString()}`, false, 2000);
    } else if (this.playMode === 'campaign' && victory && !campaignFinale) {
      this.pendingScoreNote = {
        isBest: false,
        placed: false,
        rank: 0,
        score,
        campaignRun: true,
      };
    } else if (!victory) {
      this.pendingScoreNote = {
        isBest: false,
        placed: false,
        rank: 0,
        score,
        defeat: true,
      };
    }

    if (campaignFinale) {
      const track = this.campaign.track ?? 'standard';
      const n = getOpCount(track);
      // runScore already includes this mission (banked via onMissionScore)
      const finalScore = computeCampaignScore({
        missionScores: [Math.max(this.campaign.runScore, score)],
        completed: true,
        track,
        difficulty: this.campaign.runDifficulty ?? this.difficulty,
      });
      const r = insertScore(loadLeaderboard(), {
        mode: 'campaign',
        track,
        score: finalScore,
        difficulty: this.campaign.runDifficulty ?? this.difficulty,
        totalXp: this.campaign.totalXpEarned,
        opsCleared: n,
        label: `${track === 'extended' ? 'EXT' : 'STD'} ${n}/${n} · ${getDifficulty(this.campaign.runDifficulty ?? this.difficulty).label} · ${finalScore}`,
      });
      this.pendingScoreNote = {
        isBest: r.isBest,
        placed: r.placed,
        rank: r.rank,
        score: finalScore,
      };
      if (r.isBest) this.showToast(`CAMPAIGN PB · ${finalScore.toLocaleString()}`, false, 2600);
    }
  }

  private setDebriefScoreNote(
    isBest: boolean,
    placed: boolean,
    rank: number,
    score: number,
    defeat = false,
  ) {
    const el = this.els.debriefScoreNote;
    if (!el) return;
    if (defeat) {
      el.textContent = 'Defeat scores are not ranked on RECORDS.';
      el.classList.remove('hidden', 'pb');
      return;
    }
    if (isBest) {
      el.textContent = `★ NEW PERSONAL BEST · ${score.toLocaleString()} — logged to RECORDS`;
      el.classList.remove('hidden');
      el.classList.add('pb');
    } else if (placed) {
      el.textContent = `Logged to RECORDS · rank #${rank} · ${score.toLocaleString()}`;
      el.classList.remove('hidden', 'pb');
    } else {
      el.classList.add('hidden');
    }
  }

  private setDebriefScoreNoteCampaign(score: number) {
    const el = this.els.debriefScoreNote;
    if (!el) return;
    const run = this.campaign.runScore;
    el.textContent = `Run total ${run.toLocaleString()} · this breach +${score.toLocaleString()} (stack clear ranks on RECORDS)`;
    el.classList.remove('hidden', 'pb');
  }

  private missionXpSummary(): string {
    if (!this.game) return '';
    const players = [...this.game.state.units.values()]
      .filter((u) => u.def.team === 'player')
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!players.length) return '';
    const lines = players.map((u) => {
      const gained = u.missionXp;
      return `${u.def.name}  L${u.level}  +${gained} XP`;
    });
    return `PRIVILEGE GAIN\n${lines.join('\n')}`;
  }

  showToast(text: string, danger: boolean, ms = 2000) {
    const t = this.els.toast;
    t.textContent = text;
    t.classList.toggle('danger', danger);
    t.classList.toggle('ok', !danger);
    t.classList.remove('hidden');
    // Restart toast-in animation
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.add('hidden'), ms);
  }

  floatDamage(
    pos: { x: number; y: number },
    dmg: number,
    crit: boolean,
    miss: boolean,
  ) {
    const el = document.createElement('div');
    el.className = 'float-dmg' + (miss ? ' miss' : crit ? ' crit' : '');
    el.textContent = miss ? 'MISS' : crit ? `−${dmg} INT!` : `−${dmg} INT`;
    const scr = this.worldToScreen?.(pos.x, pos.y);
    if (scr) {
      el.style.left = `${scr.x}px`;
      el.style.top = `${scr.y}px`;
    } else {
      el.style.left = `${50 + (Math.random() * 10 - 5)}%`;
      el.style.top = `${40 + (Math.random() * 8 - 4)}%`;
    }
    this.els.floatLayer.appendChild(el);
    window.setTimeout(() => el.remove(), crit ? 1100 : 900);
  }

  /** Soft floating XP at world tile (kill privilege). */
  floatXp(pos: { x: number; y: number }, amount: number) {
    if (amount <= 0) return;
    const el = document.createElement('div');
    el.className = 'float-xp';
    el.textContent = `+${amount} XP`;
    const scr = this.worldToScreen?.(pos.x, pos.y);
    if (scr) {
      el.style.left = `${scr.x + 12}px`;
      el.style.top = `${scr.y - 18}px`;
    } else {
      el.style.left = '55%';
      el.style.top = '38%';
    }
    this.els.floatLayer.appendChild(el);
    window.setTimeout(() => el.remove(), 1000);
  }

  /** Level-up burst above the probe. */
  floatLevelUp(pos: { x: number; y: number }, level: number) {
    const el = document.createElement('div');
    el.className = 'float-lvl';
    el.textContent = `LVL ${level}`;
    const scr = this.worldToScreen?.(pos.x, pos.y);
    if (scr) {
      el.style.left = `${scr.x}px`;
      el.style.top = `${scr.y - 28}px`;
    } else {
      el.style.left = '50%';
      el.style.top = '36%';
    }
    this.els.floatLayer.appendChild(el);
    window.setTimeout(() => el.remove(), 1400);
  }

  /** Integrity restore float (patch.sys / pickup). */
  floatHeal(pos: { x: number; y: number }, amount: number) {
    if (amount <= 0) return;
    const el = document.createElement('div');
    el.className = 'float-heal';
    el.textContent = `+${amount} INT`;
    const scr = this.worldToScreen?.(pos.x, pos.y);
    if (scr) {
      el.style.left = `${scr.x}px`;
      el.style.top = `${scr.y - 10}px`;
    } else {
      el.style.left = '50%';
      el.style.top = '42%';
    }
    this.els.floatLayer.appendChild(el);
    window.setTimeout(() => el.remove(), 1000);
  }

  handleKey(key: string) {
    if (!this.game || this.game.state.phase !== 'player') return;
    const map: Record<string, number> = {
      '1': 0,
      '2': 1,
      '3': 2,
      '4': 3,
      '5': 4,
      '6': 5,
    };
    if (key in map) {
      const sel = this.game.getSelected();
      if (!sel) return;
      const abilities: AbilityId[] = [
        'move',
        ...sel.def.abilities.filter((a) => a !== 'move' && a !== 'dash'),
      ];
      const id = abilities[map[key]!];
      if (id) this.activateAbility(id);
    }
    if (key === 'Escape') {
      this.setMode({ type: 'select' });
      this.showHitPreview(null);
    }
  }
}

function bestCoverOnTile(g: Game, x: number, y: number): CoverLevel {
  const tile = g.state.tiles[y]?.[x];
  if (!tile) return 0;
  let best: CoverLevel = 0;
  for (const edge of tile.cover) {
    const prop = g.state.props.get(edge.propId);
    if (!prop || prop.destroyed) continue;
    if (edge.level > best) best = edge.level;
  }
  return best;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function setTip(el: HTMLElement, text: string, pos?: 'below' | 'right' | 'start') {
  el.setAttribute('data-tip', text);
  if (pos) el.setAttribute('data-tip-pos', pos);
  else el.removeAttribute('data-tip-pos');
  el.setAttribute('title', ''); // prefer custom tip over browser default
}

function collectMissionStats(g: Game, reason: string) {
  const players = [...g.state.units.values()].filter((u) => u.def.team === 'player');
  const enemies = [...g.state.units.values()].filter((u) => u.def.team === 'enemy');
  return {
    turns: g.state.turn,
    enemyKills: enemies.filter((u) => !u.alive).length,
    squadAlive: players.filter((u) => u.alive).length,
    squadTotal: players.length,
    missionXpTotal: players.reduce((s, u) => s + u.missionXp, 0),
    reason,
  };
}

/** Healthy (unwounded) totals for display when debuffs are active. */
function healthyTotals(u: UnitState): { maxHp: number; aim: number; mobility: number } {
  if (!u.wounded) {
    return { maxHp: u.def.maxHp, aim: u.def.aim, mobility: u.def.mobility };
  }
  return {
    maxHp: u.def.maxHp + WOUND_PENALTIES.maxHp,
    aim: Math.min(99, u.def.aim + WOUND_PENALTIES.aim),
    mobility: u.def.mobility + WOUND_PENALTIES.mobility,
  };
}

/** INT: `5/6(7)` when wounded — current/woundedMax(healthyMax). */
function formatStatHp(u: UnitState): string {
  if (!u.wounded) return `${u.hp}/${u.def.maxHp}`;
  const full = healthyTotals(u);
  return `${u.hp}/${u.def.maxHp}<span class="stat-full">(${full.maxHp})</span>`;
}

/** ACC: `58(70)` when wounded — current(healthy). */
function formatStatAim(u: UnitState): string {
  if (!u.wounded) return `${u.def.aim}`;
  const full = healthyTotals(u);
  return `${u.def.aim}<span class="stat-full">(${full.aim})</span>`;
}
