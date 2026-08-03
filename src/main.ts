import './style.css';
import { music } from './audio/music';
import { sfx } from './audio/sfx';
import { createMission, getMapInfo } from './content/map';
import { runEnemyTurn } from './sim/ai';
import {
  applyCampaignOutcome,
  bankCampaignXp,
  getCurrentOp,
  type CampaignState,
} from './sim/campaign';
import { loadCampaign, resetCampaign, saveCampaign } from './sim/campaignStore';
import { getDifficulty } from './sim/difficulty';
import { Game } from './sim/game';
import { keyOf } from './sim/grid';
import type { LoadoutState } from './sim/loadout';
import { loadLoadout, resetLoadout, saveLoadout } from './sim/loadoutStore';
import { applyPostMissionWounds, rosterFromUnits } from './sim/progression';
import { loadRoster, resetRoster, saveRoster } from './sim/roster';
import type { DifficultyId } from './sim/types';
import { HUD } from './ui/hud';
import { GameRenderer } from './view/renderer';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new GameRenderer(canvas);
const hud = new HUD();
hud.worldToScreen = (x, y) => renderer.worldToScreen(x, y);

let roster = loadRoster();
let campaign: CampaignState = loadCampaign();
let loadout: LoadoutState = loadLoadout();
hud.setCampaign(campaign);
hud.setPlayMode('campaign');
hud.setLoadout(loadout);

let game = new Game(
  createMission(Date.now() & 0xffff, 'normal', {
    roster,
    gateAbilities: true,
    mapId: getCurrentOp(campaign).mapId,
    playMode: 'campaign',
    campaignOpId: getCurrentOp(campaign).id,
    missionType: getCurrentOp(campaign).missionType,
    loadout,
  }),
);
let busy = false;
/** Enemy id currently shown in hit preview (second click confirms fire). */
let aimedId: string | null = null;

function persistRosterFromGame(opts?: { applyWounds?: boolean }) {
  roster = rosterFromUnits(game.state.units.values(), roster);
  if (opts?.applyWounds) {
    roster = applyPostMissionWounds(roster, game.state.units.values());
  }
  saveRoster(roster);
}

function handlers() {
  return {
    onDeploy: () => deploy(),
    onRestart: () => restart(),
    onEndTurn: () => {
      void endTurn();
    },
    onModeChange: () => {
      aimedId = null;
      hud.showHitPreview(null);
      renderer.mapView.clearAimLine();
      renderer.unitsView.setAimed(null);
      renderer.refreshMoves(game);
      hud.refresh();
    },
    onSelectUnit: (id: string) => {
      selectPlayer(id);
    },
    onDebugSync: () => {
      renderer.sync(game);
      hud.refresh();
      persistRosterFromGame();
    },
    onPersistRoster: () => {
      persistRosterFromGame();
    },
    onMissionEndPersist: () => {
      // XP + wound flags for next deploy
      persistRosterFromGame({ applyWounds: true });
    },
    onMissionResult: (victory: boolean, missionXp: number, reason: string) => {
      if (hud.getPlayMode() !== 'campaign') return;
      // Bank XP first so the finale screen shows the full run total
      campaign = bankCampaignXp(campaign, missionXp);
      // reason locks Vesper path when OP-02 is cleared
      campaign = applyCampaignOutcome(campaign, victory, reason);
      saveCampaign(campaign);
      hud.setCampaign(campaign);
    },
    onCredEarned: (n: number) => {
      if (n <= 0) return;
      loadout = { ...loadout, cred: loadout.cred + n };
      saveLoadout(loadout);
      hud.setLoadout(loadout);
    },
    onLoadoutChanged: (l: LoadoutState) => {
      loadout = l;
      saveLoadout(loadout);
      hud.setLoadout(loadout);
    },
    onContinue: () => {
      // Next op or retry — back to lobby with campaign UI for current op
      restart();
    },
    onNewCampaign: () => {
      const done = campaign.completed;
      const msg = done
        ? 'Start a new campaign from OP-01?\nProbe XP is kept.'
        : 'Reset campaign to OP-01?\nProgress and Vesper path clear. Probe XP is kept.';
      if (!window.confirm(msg)) return;
      campaign = resetCampaign();
      hud.setCampaign(campaign);
      hud.setPlayMode('campaign');
      restart();
      hud.showToast(done ? 'NEW CAMPAIGN · OP-01' : 'CAMPAIGN RESET · OP-01', false, 2400);
    },
    onResetSquad: () => {
      if (
        !window.confirm(
          'Reset squad completely?\n\n' +
            '• All probes return to L1 (0 XP)\n' +
            '• Ability unlocks back to starter kit\n' +
            '• Wound flags cleared\n' +
            '• Loadout upgrades removed (inject / armor / cycle)\n' +
            '• CRED bank wiped to 0\n\n' +
            'This cannot be undone.',
        )
      ) {
        return;
      }
      roster = resetRoster();
      loadout = resetLoadout();
      hud.setLoadout(loadout);
      hud.refreshLobbyWounds();
      sfx.ui();
      hud.showToast('SQUAD RESET · L1 · NO GEAR · 0 CRED', false, 2800);
    },
  };
}

/** Select a probe and frame the camera on them. */
function selectPlayer(id: string) {
  if (busy || game.state.phase !== 'player') return;
  const u = game.state.units.get(id);
  if (!u?.alive || u.def.team !== 'player') return;
  game.selectUnit(id);
  hud.setMode({ type: 'move' });
  aimedId = null;
  hud.showHitPreview(null);
  renderer.mapView.clearAimLine();
  renderer.unitsView.setAimed(null);
  sfx.select();
  renderer.sync(game);
  hud.refresh();
  // unitSelected event also locks camera; call explicitly for re-select same unit
  renderer.cam.lockOnUnit(id, 2500);
}

function attachGame(g: Game) {
  game = g;
  aimedId = null;
  renderer.bindGame(game);
  hud.bind(game, handlers());
  renderer.sync(game);
}

function deploy() {
  sfx.unlock();
  music.unlock();
  busy = false;
  aimedId = null;
  const difficulty = hud.getDifficulty();
  const playMode = hud.getPlayMode();
  const mapId = hud.resolveDeployMapId();
  const op = playMode === 'campaign' ? getCurrentOp(campaign) : null;

  // Completed campaign cannot jack into campaign ops — nudge to skirmish or new campaign
  if (playMode === 'campaign' && campaign.completed) {
    hud.showToast('CAMPAIGN COMPLETE · NEW CAMPAIGN or switch to SKIRMISH', true);
    return;
  }

  roster = loadRoster();
  campaign = loadCampaign();
  loadout = loadLoadout();
  hud.setCampaign(campaign);
  hud.setLoadout(loadout);

  const missionType =
    playMode === 'campaign'
      ? (op?.missionType ?? 'standard')
      : hud.getMissionType();
  const kernelBranch =
    playMode === 'campaign' && mapId === 'kernel' ? campaign.vesperPath : null;

  attachGame(
    new Game(
      createMission(Date.now() & 0xffff, difficulty, {
        roster,
        gateAbilities: true,
        mapId,
        playMode,
        campaignOpId: op?.id,
        missionType,
        loadout,
        kernelBranch,
      }),
    ),
  );
  game.startMission();
  hud.showHud();
  hud.setMode({ type: 'move' });
  renderer.sync(game);
  hud.refresh();
  sfx.jackIn();
  const avgLvl = Math.round(
    [...game.state.units.values()]
      .filter((u) => u.def.team === 'player')
      .reduce((s, u) => s + u.level, 0) / 4,
  );
  const mapName = getMapInfo(mapId).short;
  const prefix = op ? `${op.codename} · ` : '';
  const limit =
    game.state.missionType === 'deadline' && game.state.turnLimit != null
      ? ` · ${game.state.turnLimit} CYC LIMIT`
      : '';
  const branchTag =
    kernelBranch === 'stealth'
      ? ' · QUIET PATH'
      : kernelBranch === 'loud'
        ? ' · FULL ALERT'
        : '';
  hud.showToast(
    `${prefix}${mapName} · ${getDifficulty(difficulty).label} · TEAM L${avgLvl}${limit}${branchTag}`,
    false,
    2800,
  );
  const first = game.getSelected();
  if (first) renderer.cam.lockOnUnit(first.id, 3000);
  else {
    const pad = game.state.extractTiles[0];
    if (pad) renderer.cam.focusTile(pad.x, pad.y, true);
  }
}

function restart() {
  busy = false;
  aimedId = null;
  const difficulty = hud.getDifficulty();
  const playMode = hud.getPlayMode();
  roster = loadRoster();
  campaign = loadCampaign();
  loadout = loadLoadout();
  hud.setCampaign(campaign);
  hud.setLoadout(loadout);

  const mapId =
    playMode === 'campaign' ? getCurrentOp(campaign).mapId : hud.getMapId();
  const op = playMode === 'campaign' ? getCurrentOp(campaign) : null;

  const missionType =
    playMode === 'campaign'
      ? (op?.missionType ?? 'standard')
      : hud.getMissionType();
  const kernelBranch =
    playMode === 'campaign' && mapId === 'kernel' ? campaign.vesperPath : null;

  attachGame(
    new Game(
      createMission(Date.now() & 0xffff, difficulty, {
        roster,
        gateAbilities: true,
        mapId,
        playMode,
        campaignOpId: op?.id,
        missionType,
        loadout,
        kernelBranch,
      }),
    ),
  );
  hud.setDifficulty(difficulty);
  hud.setPlayMode(playMode);
  hud.setMapId(mapId);
  hud.setMissionType(missionType);
  hud.setCampaign(campaign);
  hud.setLoadout(loadout);
  hud.showBriefing();
  renderer.sync(game);
  hud.refresh();
}

async function endTurn() {
  if (busy || game.isMissionOver() || game.state.phase !== 'player') return;
  if (renderer.unitsView.isMoving()) return;
  busy = true;
  aimedId = null;
  hud.setMode({ type: 'select' });
  hud.showHitPreview(null);
  renderer.mapView.clearPath();
  game.endPlayerTurn();
  hud.refresh();
  renderer.sync(game);
  await runEnemyTurn(
    game,
    (ms) => new Promise((r) => setTimeout(r, ms)),
    () => renderer.unitsView.waitUntilIdle(),
  );
  await renderer.unitsView.waitUntilIdle();
  renderer.sync(game);
  hud.refresh();
  busy = false;
}

function canInteract(): boolean {
  return !busy && !game.isMissionOver() && game.state.phase === 'player' && !renderer.unitsView.isMoving();
}

function fireAt(attackerId: string, targetId: string) {
  if (game.tryShoot(attackerId, targetId)) {
    aimedId = null;
    hud.showHitPreview(null);
    renderer.mapView.clearAimLine();
    renderer.unitsView.setAimed(null);
    hud.setMode({ type: 'move' });
    renderer.mapView.clearPath();
    renderer.sync(game);
    hud.refresh();
    return true;
  }
  return false;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !canInteract()) return;
  if (e.altKey) return;
  sfx.unlock();
  music.unlock();

  const unitId = renderer.pickUnit(e.clientX, e.clientY, game);
  const tile = renderer.pickTile(e.clientX, e.clientY);
  const mode = hud.mode;
  const sel = game.getSelected();

  // Select player unit
  if (unitId) {
    const u = game.state.units.get(unitId);
    if (u?.def.team === 'player') {
      selectPlayer(unitId);
      return;
    }
  }

  if (!sel || !tile) return;

  // Targeting modes that need a unit
  if (mode.type === 'shoot' || mode.type === 'suppress') {
    if (unitId) {
      const target = game.state.units.get(unitId);
      if (target && target.def.team === 'enemy') {
        if (mode.type === 'shoot') fireAt(sel.id, unitId);
        else {
          game.trySuppress(sel.id, unitId);
          hud.setMode({ type: 'move' });
          renderer.sync(game);
          hud.refresh();
        }
      }
    }
    return;
  }

  if (mode.type === 'heal') {
    if (unitId) {
      game.tryHeal(sel.id, unitId);
      hud.setMode({ type: 'move' });
      renderer.sync(game);
      hud.refresh();
    }
    return;
  }

  if (mode.type === 'grenade') {
    game.tryGrenade(sel.id, tile);
    hud.setMode({ type: 'move' });
    renderer.sync(game);
    hud.refresh();
    return;
  }

  if (mode.type === 'breach') {
    game.tryBreach(sel.id, tile);
    hud.setMode({ type: 'move' });
    renderer.sync(game);
    hud.refresh();
    return;
  }

  if (mode.type === 'smoke') {
    game.trySmoke(sel.id, tile);
    hud.setMode({ type: 'move' });
    renderer.sync(game);
    hud.refresh();
    return;
  }

  // Click enemy: preview, second click fires (or Fire mode)
  if (unitId) {
    const target = game.state.units.get(unitId);
    if (target?.def.team === 'enemy') {
      const preview = game.previewAttack(sel.id, unitId);
      hud.showHitPreview(preview, {
        name: target.def.name,
        hp: target.hp,
        maxHp: target.def.maxHp,
      });
      renderer.unitsView.setAimed(unitId);
      if (preview && (aimedId === unitId || e.detail >= 2)) {
        fireAt(sel.id, unitId);
      } else {
        aimedId = unitId;
        sfx.ui();
      }
      return;
    }
  }

  // Move
  const { blue, yellow } = game.getReachable(sel.id);
  const dest = resolveMoveTile(tile, blue, yellow);
  if (dest) {
    aimedId = null;
    hud.showHitPreview(null);
    renderer.mapView.clearPath();
    game.tryMove(sel.id, dest);
    renderer.sync(game);
    hud.refresh();
  } else {
    aimedId = null;
    hud.showHitPreview(null);
    renderer.mapView.clearPath();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!canInteract()) {
    renderer.mapView.setHover(null);
    renderer.mapView.clearPath();
    return;
  }
  const sel = game.getSelected();
  const tile = renderer.pickTile(e.clientX, e.clientY);
  const mode = hud.mode;

  if (tile) renderer.mapView.setHover(tile);
  else renderer.mapView.setHover(null);

  // Path preview on reachable tiles
  if (sel && tile && (mode.type === 'move' || mode.type === 'select')) {
    const { blue, yellow } = game.getReachable(sel.id);
    const dest = resolveMoveTile(tile, blue, yellow);
    if (dest) {
      const k = keyOf(dest.x, dest.y);
      const path = (blue.get(k) ?? yellow.get(k)) as { path: Array<{ x: number; y: number }> } | undefined;
      if (path) {
        renderer.mapView.showPath(path.path, yellow.has(k));
      } else {
        renderer.mapView.clearPath();
      }
    } else {
      renderer.mapView.clearPath();
    }
  } else {
    renderer.mapView.clearPath();
  }

  // Hit preview + aim line on enemies
  if (sel && (mode.type === 'shoot' || mode.type === 'select' || mode.type === 'move')) {
    const unitId = renderer.pickUnit(e.clientX, e.clientY, game);
    if (unitId) {
      const t = game.state.units.get(unitId);
      if (t?.def.team === 'enemy') {
        const preview = game.previewAttack(sel.id, unitId);
        hud.showHitPreview(preview, {
          name: t.def.name,
          hp: t.hp,
          maxHp: t.def.maxHp,
        });
        renderer.unitsView.setAimed(unitId);
        if (preview) {
          renderer.mapView.showAimLine(sel.pos, t.pos, preview.hitChance);
        } else {
          renderer.mapView.clearAimLine();
        }
        return;
      }
    }
    if (mode.type === 'shoot' || aimedId == null) {
      if (mode.type === 'shoot') hud.showHitPreview(null);
      else if (aimedId == null) hud.showHitPreview(null);
      renderer.mapView.clearAimLine();
      if (aimedId == null) renderer.unitsView.setAimed(null);
    }
  } else {
    renderer.mapView.clearAimLine();
    renderer.unitsView.setAimed(null);
  }
});

window.addEventListener('keydown', (e) => {
  if (game.isMissionOver()) return;
  if (e.key === 'r' || e.key === 'R') {
    void endTurn();
    return;
  }
  // Tab cycle squad
  if (e.key === 'Tab' && game.state.phase === 'player') {
    e.preventDefault();
    const players = game.playerUnits();
    if (players.length === 0) return;
    const idx = players.findIndex((p) => p.id === game.state.selectedId);
    const next = players[(idx + 1) % players.length]!;
    selectPlayer(next.id);
    return;
  }
  // F to fire at aimed target
  if ((e.key === 'f' || e.key === 'F') && aimedId && game.getSelected()) {
    fireAt(game.getSelected()!.id, aimedId);
    return;
  }
  hud.handleKey(e.key);
  renderer.refreshMoves(game);
});

function resolveMoveTile(
  tile: { x: number; y: number },
  blue: Map<string, unknown>,
  yellow: Map<string, unknown>,
): { x: number; y: number } | null {
  const k = keyOf(tile.x, tile.y);
  if (blue.has(k) || yellow.has(k)) return tile;

  let best: { x: number; y: number } | null = null;
  let bestD = 0.75;
  for (const key of [...blue.keys(), ...yellow.keys()]) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    const d = Math.hypot(x - tile.x, y - tile.y);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

// Bootstrap
attachGame(game);
hud.setDifficulty('normal');
hud.setCampaign(campaign);
hud.setPlayMode('campaign');
// Briefing stays hidden until splash completes
const bootPad = game.state.extractTiles[0];
if (bootPad) renderer.cam.focusTile(bootPad.x, bootPad.y, true);
else renderer.cam.focusTile(12, 18, true);

/** First-load splash → cyberdeck menu (15s auto, or early via button/key). */
const SPLASH_DURATION_MS = 15_000;

function runSplash(): Promise<void> {
  const el = document.getElementById('splash');
  if (!el) return Promise.resolve();

  const pct = document.getElementById('splash-pct');
  const bootText = document.getElementById('splash-boot-text');
  const bootLines = [
    'DECK BOOT · AUTH SEQUENCE',
    'UPLINK HANDSHAKE…',
    'PROBE FIRMWARE OK',
    'ICE TABLE LOADED',
    'LINK STABLE · READY',
  ];

  return new Promise((resolve) => {
    let finished = false;
    let tick = 0;
    let autoTimer = 0;
    const started = performance.now();

    const finish = () => {
      if (finished) return;
      finished = true;
      el.classList.remove('splash-in');
      el.classList.add('splash-out');
      window.clearInterval(tick);
      window.clearTimeout(autoTimer);
      window.removeEventListener('keydown', onKey);
      window.setTimeout(() => {
        el.classList.add('hidden');
        el.setAttribute('aria-hidden', 'true');
        resolve();
      }, 950);
    };

    // Fade in next frame so CSS transition runs
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('splash-in'));
    });

    // Progress % + boot lines over the full splash duration
    let line = 0;
    tick = window.setInterval(() => {
      const elapsed = performance.now() - started;
      // Reach 100% slightly before auto-advance
      const p = Math.min(100, Math.floor((elapsed / (SPLASH_DURATION_MS - 600)) * 100));
      if (pct) pct.textContent = `${String(p).padStart(2, '0')}%`;
      if (p >= 18 && line < 1) {
        line = 1;
        if (bootText) bootText.textContent = bootLines[1]!;
      } else if (p >= 40 && line < 2) {
        line = 2;
        if (bootText) bootText.textContent = bootLines[2]!;
      } else if (p >= 65 && line < 3) {
        line = 3;
        if (bootText) bootText.textContent = bootLines[3]!;
      } else if (p >= 92 && line < 4) {
        line = 4;
        if (bootText) bootText.textContent = bootLines[4]!;
      }
      if (p >= 100) window.clearInterval(tick);
    }, 80);

    const skip = () => finish();
    el.querySelector('#splash-skip')?.addEventListener('click', skip, { once: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ' || e.key.length === 1) {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    // Auto-advance after full boot window
    autoTimer = window.setTimeout(finish, SPLASH_DURATION_MS);
  });
}

void runSplash().then(() => {
  hud.showBriefing();
  // User gesture (skip/key) unlocks audio; auto-timeout may still be blocked until next click
  sfx.unlock();
  music.unlock();
  const armAudio = () => {
    sfx.unlock();
    music.unlock();
  };
  window.addEventListener('pointerdown', armAudio, { once: true, capture: true });
  window.addEventListener('keydown', armAudio, { once: true, capture: true });
  const briefing = document.getElementById('briefing');
  briefing?.classList.add('menu-from-splash');
  window.setTimeout(() => briefing?.classList.remove('menu-from-splash'), 1000);
  sfx.ui();
});

let paused = false;
(window as unknown as {
  __aegis: {
    game: () => Game;
    renderer: GameRenderer;
    pause: (v?: boolean) => boolean;
    captureDataUrl: () => string;
    captureSimple: () => string;
    getDifficulty: () => DifficultyId;
  };
}).__aegis = {
  game: () => game,
  renderer,
  pause: (v?: boolean) => {
    if (typeof v === 'boolean') paused = v;
    return paused;
  },
  captureDataUrl: () => renderer.renderer.domElement.toDataURL('image/png'),
  captureSimple: () => {
    renderer.setCaptureMode(true);
    renderer.render({ simple: true });
    const url = renderer.renderer.domElement.toDataURL('image/png');
    renderer.setCaptureMode(false);
    return url;
  },
  getDifficulty: () => hud.getDifficulty(),
};

function frame() {
  if (!paused) {
    // Unit lock-on (enemy/player) is handled inside cam.update via mesh resolver
    renderer.render();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
