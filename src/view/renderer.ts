import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { sfx } from '../audio/sfx';
import type { Game } from '../sim/game';
import type { GameEvent } from '../sim/types';
import { TacticalCamera } from './camera';
import { createMaterials } from './materials';
import { MapView } from './mapView';
import { UnitsView } from './unitsView';
import { VFX } from './vfx';

/** Color grade: teal shadows, warm mids, mild contrast, soft vignette. */
const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // PCB grade: green lift in shadows, copper warmth in mids
      vec3 lift = vec3(0.03, 0.09, 0.06);
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 graded = c.rgb + lift * (1.0 - smoothstep(0.0, 0.4, luma));
      graded.r = mix(graded.r, graded.r * 1.08, 0.25);
      graded.g = mix(graded.g, graded.g * 1.06, 0.3);
      graded.b = mix(graded.b, graded.b * 0.96, 0.2);
      vec2 vc = vUv - 0.5;
      float vig = smoothstep(1.05, 0.22, dot(vc, vc) * 1.4);
      graded *= mix(0.8, 1.0, vig);
      graded = (graded - 0.5) * 1.08 + 0.5;
      graded = max(graded, vec3(0.0));
      gl_FragColor = vec4(mix(c.rgb, graded, amount), c.a);
    }
  `,
};

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: TacticalCamera;
  readonly mapView: MapView;
  readonly unitsView: UnitsView;
  readonly vfx: VFX;
  private composer: EffectComposer;
  private mats = createMaterials();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private clock = new THREE.Clock();
  private unbindGame: (() => void) | null = null;
  private boundGame: Game | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x020806);
    this.scene.fog = new THREE.FogExp2(0x04120a, 0.014);

    this.cam = new TacticalCamera(window.innerWidth / window.innerHeight);
    this.cam.bind(canvas);

    this.mapView = new MapView(this.mats);
    this.unitsView = new UnitsView();
    this.unitsView.setCamera(this.cam.camera);
    this.vfx = new VFX();
    this.scene.add(this.mapView.root);
    this.scene.add(this.unitsView.root);
    this.scene.add(this.vfx.root);

    this.setupLights();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.cam.camera));
    // Bloom tuned for LED packages + inject arcs without blowing highlights
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.48,
      0.55,
      0.78,
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new ShaderPass(ColorGradeShader));
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.onResize());
  }

  private setupLights() {
    // Lab-bench / PCB inspection lighting — cool green fill + warm copper rims
    const hemi = new THREE.HemisphereLight(0x60c8a0, 0x1a1008, 0.95);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xe8fff4, 1.15);
    key.position.set(-16, 36, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    key.shadow.camera.left = -32;
    key.shadow.camera.right = 32;
    key.shadow.camera.top = 32;
    key.shadow.camera.bottom = -32;
    key.shadow.bias = -0.00025;
    key.shadow.normalBias = 0.035;
    this.scene.add(key);

    const amb = new THREE.AmbientLight(0x143028, 0.5);
    this.scene.add(amb);

    const copperRim = new THREE.DirectionalLight(0xffa050, 0.55);
    copperRim.position.set(14, 5, -16);
    this.scene.add(copperRim);

    const cyanRim = new THREE.DirectionalLight(0x40ffe0, 0.4);
    cyanRim.position.set(-10, 6, 14);
    this.scene.add(cyanRim);

    const playFill = new THREE.PointLight(0x60ffc8, 32, 42, 1.35);
    playFill.position.set(13, 12, 14);
    this.scene.add(playFill);

    const southFill = new THREE.PointLight(0xffb060, 22, 28, 1.5);
    southFill.position.set(12, 8, 20);
    this.scene.add(southFill);
  }

  bindGame(game: Game) {
    this.unbindGame?.();
    this.boundGame = game;
    // Fresh mission: drop corpse meshes / path tweens so stable unit ids
    // (e_pmc1, …) do not keep death poses from the previous breach.
    this.unitsView.clear();
    this.mapView.build(game.state);
    this.unitsView.sync(game.state);
    this.cam.clearLock();
    this.cam.setFollowResolver((id) => this.unitsView.getWorldPos(id));
    this.cam.focusTile(12, 18, true);
    this.unbindGame = game.on((e) => {
      if (this.boundGame) this.onEvent(e, this.boundGame);
    });
  }

  private onEvent(e: GameEvent, game: Game) {
    if (e.type === 'shot' || e.type === 'miss') {
      const from = e.payload.from as { x: number; y: number };
      const to = e.payload.to as { x: number; y: number };
      const crit = Boolean(e.payload.crit);
      const attackerId = e.payload.attackerId as string;
      const attacker = game.state.units.get(attackerId);
      this.vfx.tracer(from, to, crit);
      this.unitsView.faceUnit(attackerId, to);
      sfx.shoot();
      // Stay locked on the shooter — no midpoint juggling
      if (attacker?.def.team === 'enemy') {
        this.cam.keepLockOnUnit(attackerId, 1100);
        if (e.type === 'shot') this.cam.shake(crit ? 0.12 : 0.06);
      } else {
        this.cam.keepLockOnUnit(attackerId, 450);
        if (e.type === 'shot') this.cam.shake(crit ? 0.2 : 0.1);
      }
      if (e.type === 'shot') {
        this.vfx.impact(to);
        this.unitsView.flashHit(e.payload.targetId as string, crit);
        if (crit) sfx.crit();
        else sfx.hit();
      } else {
        sfx.miss();
      }
    }
    if (e.type === 'grenade') {
      const t = e.payload.target as { x: number; y: number };
      const throwerId = e.payload.unitId as string;
      this.vfx.explosion(t);
      this.cam.shake(0.18);
      sfx.grenade();
      // Hold on thrower so we don't bounce to blast then back
      this.cam.keepLockOnUnit(throwerId, 1200);
    }
    if (e.type === 'coverDestroyed') {
      const pos = e.payload.pos as { x: number; y: number };
      this.vfx.coverBreak(pos);
      this.mapView.syncProps(game.state);
    }
    if (e.type === 'pickupCollected') {
      const pos = e.payload.pos as { x: number; y: number };
      this.vfx.impact(pos);
      this.mapView.syncPickups(game.state);
      this.unitsView.sync(game.state);
      if (e.payload.kind === 'integrity') sfx.heal();
      else sfx.ui();
    }
    if (e.type === 'heal') {
      const pos = e.payload.pos as { x: number; y: number };
      this.vfx.impact(pos);
      this.unitsView.sync(game.state);
      sfx.heal();
    }
    if (e.type === 'pickupSpawned') {
      this.mapView.syncPickups(game.state);
    }
    if (e.type === 'move') {
      const id = e.payload.unitId as string;
      const path = e.payload.path as Array<{ x: number; y: number }> | undefined;
      const scamper = Boolean(e.payload.scamper);
      if (path && path.length > 0) {
        this.unitsView.playMove(id, path, path.length > 5 ? 11 : 9);
      }
      this.unitsView.sync(game.state);
      const u = game.state.units.get(id);
      if (u?.def.team === 'player') {
        this.cam.lockOnUnit(id, 800);
        sfx.move();
      } else if (u && (scamper || game.state.phase === 'enemy')) {
        // Track the moving enemy mesh the whole walk — no jump-to-destination
        this.cam.lockOnUnit(id, scamper ? 1400 : 1000);
      }
    }
    if (e.type === 'kill') {
      this.unitsView.sync(game.state);
      sfx.kill();
      // Keep framing the killer if we have one; otherwise victim once
      const killerId = e.payload.killerId as string | undefined;
      if (killerId && game.state.units.get(killerId)) {
        this.cam.keepLockOnUnit(killerId, 700);
      }
    }
    if (e.type === 'damage') {
      this.unitsView.sync(game.state);
      const id = e.payload.unitId as string;
      this.unitsView.flashHit(id, Boolean(e.payload.crit));
    }
    if (e.type === 'podActivated') {
      this.unitsView.sync(game.state);
      sfx.pod();
      const podId = e.payload.podId as string;
      const pod = game.state.pods.get(podId);
      if (pod) {
        // Lock first living member; scamper moves will keepLock same/next units smoothly
        const lead = pod.memberIds
          .map((id) => game.state.units.get(id))
          .find((m) => m && m.alive);
        if (lead) {
          this.cam.lockOnUnit(lead.id, 1600);
        }
      }
    }
    if (e.type === 'overwatch') {
      sfx.overwatch();
      const id = e.payload.unitId as string;
      this.cam.keepLockOnUnit(id, 500);
    }
    if (e.type === 'unitSelected') {
      const id = e.payload.unitId as string;
      const u = game.state.units.get(id);
      if (u?.def.team === 'player' && u.alive) {
        // Smooth lock on selected probe (click, squad bar, Tab, or auto-swap)
        this.cam.lockOnUnit(id, 2500);
      }
    }
    if (e.type === 'turnStart') {
      sfx.turn();
      if (e.payload.team === 'enemy') {
        const enemies = game.enemyUnits();
        if (enemies[0]) this.cam.lockOnUnit(enemies[0].id, 700);
      } else {
        const sel = game.getSelected();
        if (sel) this.cam.lockOnUnit(sel.id, 2500);
        else this.cam.clearLock();
      }
    }
    if (e.type === 'missionEnd') {
      this.cam.clearLock();
      if (e.payload.result === 'victory') sfx.victory();
      else {
        sfx.defeat();
        if (e.payload.reason === 'deadline') sfx.deadline();
      }
    }
    if (e.type === 'levelUp') {
      sfx.levelUp();
      this.cam.shake(0.05);
    }
    if (e.type === 'xp' && e.payload.source === 'kill') {
      sfx.xp();
    }
    if (e.type === 'toast') {
      const text = String(e.payload.text ?? '');
      // Pressure ping on last cycle (missionEnd already plays deadline on fail)
      if (text.includes('LAST CYCLE')) sfx.deadline();
      if (text.includes('link.sys ARMED') || text.includes('PORT SYNC')) sfx.jackIn();
      if (text.includes('PORT LINK SEVERED')) sfx.miss();
    }
  }

  /** Project a world tile to CSS pixel position for floating UI. */
  worldToScreen(tileX: number, tileY: number, height = 1.4): { x: number; y: number } | null {
    const v = new THREE.Vector3(tileX, height, tileY);
    v.project(this.cam.camera);
    if (v.z > 1) return null;
    const canvas = this.renderer.domElement;
    return {
      x: (v.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * canvas.clientHeight,
    };
  }

  pickTile(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.cam.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      return { x: Math.round(hit.x), y: Math.round(hit.z) };
    }
    return null;
  }

  pickUnit(clientX: number, clientY: number, game: Game): string | null {
    const tile = this.pickTile(clientX, clientY);
    if (!tile) return null;
    for (const u of game.state.units.values()) {
      if (!u.alive) continue;
      if (u.def.team === 'enemy' && !game.state.visibleEnemyIds.has(u.id)) continue;
      if (u.pos.x === tile.x && u.pos.y === tile.y) return u.id;
    }
    return null;
  }

  refreshMoves(game: Game) {
    const sel = game.getSelected();
    if (!sel || game.state.phase !== 'player' || sel.def.team !== 'player') {
      this.mapView.clearMoves();
      this.mapView.setSelect(null);
      return;
    }
    const { blue, yellow } = game.getReachable(sel.id);
    this.mapView.showMoves(blue, yellow);
    this.mapView.setSelect(sel.pos);
  }

  sync(game: Game) {
    this.unitsView.sync(game.state);
    this.mapView.syncProps(game.state);
    this.mapView.updateFog(game.state, true);
    this.refreshMoves(game);
  }

  /** Lightweight path for headless capture / low GPU (no shadows, no post). */
  setCaptureMode(on: boolean) {
    this.renderer.shadowMap.enabled = !on;
    if (on) {
      this.scene.traverse((o) => {
        const l = o as THREE.Light;
        if ((l as THREE.DirectionalLight).isDirectionalLight) {
          (l as THREE.DirectionalLight).castShadow = false;
        }
      });
    }
  }

  render(opts?: { simple?: boolean }) {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.unitsView.tick(dt);
    this.mapView.tick(dt);
    this.vfx.update(dt);
    this.cam.update();
    if (opts?.simple) {
      this.renderer.render(this.scene, this.cam.camera);
    } else {
      this.composer.render();
    }
  }

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.cam.setAspect(w / h);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }
}
