import * as THREE from 'three';
import { TILE } from '../sim/grid';
import type { MissionState, UnitState, Vec2 } from '../sim/types';

/** World-space path animation for a unit mesh. */
interface MoveAnim {
  points: THREE.Vector3[];
  i: number;
  /** tiles per second */
  speed: number;
}

export class UnitsView {
  readonly root = new THREE.Group();
  private meshes = new Map<string, THREE.Group>();
  /** Last-known FOW ghosts (enemy id → mesh at last seen tile) */
  private ghosts = new Map<string, THREE.Group>();
  private clock = 0;
  /** Active move tweens keyed by unit id */
  private moves = new Map<string, MoveAnim>();
  private camera: THREE.Camera | null = null;
  private aimedId: string | null = null;

  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  /** Highlight aimed hostile (inject targeting). */
  setAimed(unitId: string | null) {
    this.aimedId = unitId;
  }

  /**
   * Drop every mesh/anim — call when binding a fresh mission so corpse poses
   * and death-tile positions from the last breach do not stick to reused unit ids.
   */
  clear() {
    for (const g of this.meshes.values()) {
      this.root.remove(g);
    }
    this.meshes.clear();
    for (const g of this.ghosts.values()) {
      this.root.remove(g);
    }
    this.ghosts.clear();
    this.moves.clear();
    this.aimedId = null;
  }

  sync(state: MissionState) {
    const seen = new Set<string>();
    for (const u of state.units.values()) {
      seen.add(u.id);
      let g = this.meshes.get(u.id);
      if (!g) {
        g = this.buildUnit(u);
        this.meshes.set(u.id, g);
        this.root.add(g);
        // New mesh: snap to sim tile immediately
        g.position.set(u.pos.x * TILE, 0, u.pos.y * TILE);
      }
      this.updateUnit(g, u, state);
    }
    for (const [id, g] of this.meshes) {
      if (!seen.has(id)) {
        this.root.remove(g);
        this.meshes.delete(id);
        this.moves.delete(id);
      }
    }
    this.syncGhosts(state);
  }

  /**
   * Show translucent last-known silhouettes for living enemies that left LOS.
   * Ghosts sit on the last seen tile — not the real (fogged) position.
   */
  private syncGhosts(state: MissionState) {
    const keep = new Set<string>();
    for (const [id, pos] of state.lastKnownEnemyPos) {
      if (state.visibleEnemyIds.has(id)) continue; // real mesh is showing
      const u = state.units.get(id);
      if (!u || !u.alive || u.def.team !== 'enemy') continue;
      keep.add(id);
      let g = this.ghosts.get(id);
      if (!g) {
        g = this.buildGhost(u);
        this.ghosts.set(id, g);
        this.root.add(g);
      }
      g.position.set(pos.x * TILE, 0.02, pos.y * TILE);
      g.visible = true;
    }
    for (const [id, g] of this.ghosts) {
      if (!keep.has(id)) {
        this.root.remove(g);
        this.ghosts.delete(id);
      }
    }
  }

  private buildGhost(u: UnitState): THREE.Group {
    const g = new THREE.Group();
    g.userData.isGhost = true;
    g.userData.unitId = u.id;
    // Ghosts always read cyan so they never look like live hostiles
    const accent = new THREE.Color(0x3de0ff);

    const mat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      wireframe: false,
    });
    const wire = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.5,
      wireframe: true,
      depthWrite: false,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.66, 0.3), mat);
    body.position.y = 0.52;
    g.add(body);
    const outline = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.36), wire);
    outline.position.y = 0.52;
    g.add(outline);

    // Ground disc — last ping
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.4, 28),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.04;
    g.add(disc);
    g.userData.disc = disc;
    g.userData.accent = accent.getHex();

    // Inner ping dot
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 12),
      new THREE.MeshBasicMaterial({
        color: 0x00ffc8,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    dot.rotation.x = -Math.PI / 2;
    dot.position.y = 0.05;
    g.add(dot);
    g.userData.dot = dot;

    // Floating LAST marker (horizontal bar)
    const tag = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.06, 0.06),
      new THREE.MeshBasicMaterial({
        color: 0x00ffc8,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    tag.position.y = 1.18;
    g.add(tag);
    g.userData.tag = tag;

    return g;
  }

  /**
   * Play a full path after a move command. One click → walk every tile → land exactly.
   */
  playMove(unitId: string, path: Vec2[], speed = 9) {
    const g = this.meshes.get(unitId);
    if (!g || path.length === 0) return;

    const points = path.map((p) => new THREE.Vector3(p.x * TILE, 0, p.y * TILE));
    // Drop leading points already under the mesh (start tile)
    let start = 0;
    while (
      start < points.length - 1 &&
      g.position.distanceTo(points[start]!) < 0.08
    ) {
      start++;
    }
    const trimmed = points.slice(start);
    if (trimmed.length === 0) {
      const last = points[points.length - 1]!;
      g.position.copy(last);
      this.moves.delete(unitId);
      return;
    }
    // Slightly snappier paths for AAA pacing
    this.moves.set(unitId, { points: trimmed, i: 0, speed: Math.max(speed, 10) });
  }

  /** True while any unit is still sliding along a path. */
  isMoving(unitId?: string): boolean {
    if (unitId) return this.moves.has(unitId);
    return this.moves.size > 0;
  }

  /** Resolve when all path animations have finished (enemy-turn pacing). */
  waitUntilIdle(): Promise<void> {
    return new Promise((resolve) => {
      const tick = () => {
        if (!this.isMoving()) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }

  tick(dt: number) {
    this.clock += dt;
    const stepBudget = Math.min(dt, 0.05);

    for (const [id, anim] of this.moves) {
      const g = this.meshes.get(id);
      if (!g) {
        this.moves.delete(id);
        continue;
      }

      let remaining = anim.speed * stepBudget;
      while (remaining > 0 && anim.i < anim.points.length) {
        const target = anim.points[anim.i]!;
        const dx = target.x - g.position.x;
        const dz = target.z - g.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.001) {
          g.position.x = target.x;
          g.position.z = target.z;
          anim.i++;
          continue;
        }
        // Face travel direction
        g.rotation.y = Math.atan2(dx, dz);
        if (dist <= remaining) {
          g.position.x = target.x;
          g.position.z = target.z;
          remaining -= dist;
          anim.i++;
        } else {
          const t = remaining / dist;
          g.position.x += dx * t;
          g.position.z += dz * t;
          remaining = 0;
        }
      }

      if (anim.i >= anim.points.length) {
        const last = anim.points[anim.points.length - 1]!;
        g.position.x = last.x;
        g.position.z = last.z;
        this.moves.delete(id);
      }
    }

    // Pulse FOW ghosts so they read as "last known", not live units
    for (const g of this.ghosts.values()) {
      if (!g.visible) continue;
      const disc = g.userData.disc as THREE.Mesh | undefined;
      const dot = g.userData.dot as THREE.Mesh | undefined;
      const tag = g.userData.tag as THREE.Mesh | undefined;
      const wave = Math.sin(this.clock * 3.2 + g.position.x);
      const pulse = 0.32 + wave * 0.14;
      if (disc && disc.material instanceof THREE.MeshBasicMaterial) {
        disc.material.opacity = pulse;
        disc.scale.setScalar(1 + wave * 0.08);
      }
      if (dot && dot.material instanceof THREE.MeshBasicMaterial) {
        dot.material.opacity = 0.45 + wave * 0.25;
      }
      if (tag) {
        tag.position.y = 1.18 + Math.sin(this.clock * 2.6) * 0.04;
      }
      g.position.y = 0.02 + Math.sin(this.clock * 2.4) * 0.018;
    }

    for (const g of this.meshes.values()) {
      if (!g.visible) continue;
      // Death settle
      if (g.userData.dying) {
        const t = Math.min(1, (g.userData.deathT as number) + dt * 2.2);
        g.userData.deathT = t;
        g.rotation.z = t * (Math.PI / 2);
        g.position.y = t * 0.15;
        if (t >= 1) {
          g.userData.dying = false;
          g.userData.dead = true;
        }
        continue;
      }
      if (g.userData.dead) continue;

      const bob = Math.sin(this.clock * 2 + g.position.x) * 0.012;
      const body = g.userData.body as THREE.Object3D | undefined;
      if (body) body.position.y = (g.userData.baseBodyY as number) + bob;

      // Pulse package LEDs / accent materials slightly
      g.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mat = obj.material;
        if (!(mat instanceof THREE.MeshStandardMaterial)) return;
        if (mat.emissiveIntensity > 0.5 && mat.emissive.getHex() !== 0) {
          const base = (obj.userData.emBase as number) ?? mat.emissiveIntensity;
          obj.userData.emBase = base;
          mat.emissiveIntensity = base * (0.75 + 0.35 * Math.sin(this.clock * 4 + g.position.x));
        }
      });

      const bar = g.userData.hpBar as THREE.Group | undefined;
      if (bar) {
        bar.visible = true;
        // Billboard INT bars toward camera
        if (this.camera) {
          bar.quaternion.copy(this.camera.quaternion);
        }
        const fill = g.userData.hpFill as THREE.Mesh | undefined;
        const ratio = (g.userData.hpRatio as number) ?? 1;
        const isEnemy = Boolean(g.userData.isEnemy);
        if (fill) {
          fill.scale.x = Math.max(0.02, ratio);
          fill.position.x = -(isEnemy ? 0.42 : 0.35) * (1 - ratio);
          const mat = fill.material as THREE.MeshBasicMaterial;
          mat.color.set(
            isEnemy
              ? ratio > 0.5
                ? 0xff5a6a
                : ratio > 0.3
                  ? 0xff9040
                  : 0xff3030
              : ratio > 0.5
                ? 0x40ffe0
                : ratio > 0.3
                  ? 0xffc14a
                  : 0xff3d5a,
          );
        }
        const labelKey = `${g.userData.hpCur ?? 0}/${g.userData.hpMax ?? 0}`;
        if (g.userData.hpLabelKey !== labelKey) {
          g.userData.hpLabelKey = labelKey;
          this.updateHpLabel(g, Number(g.userData.hpCur ?? 0), Number(g.userData.hpMax ?? 1), isEnemy);
        }
      }

      // Aim target pulse
      const aimed = this.aimedId != null && g.userData.unitId === this.aimedId;
      const ring = g.userData.ring as THREE.Mesh | undefined;
      if (aimed && ring && ring.material instanceof THREE.MeshBasicMaterial) {
        ring.material.opacity = 1;
        ring.scale.setScalar(1.35 + Math.sin(this.clock * 8) * 0.12);
        ring.material.color.set(0xff3d5a);
      }
    }
  }

  private updateHpLabel(g: THREE.Group, cur: number, max: number, isEnemy: boolean) {
    const sprite = g.userData.hpLabel as THREE.Sprite | undefined;
    if (!sprite) return;
    const canvas = g.userData.hpCanvas as HTMLCanvasElement | undefined;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isEnemy ? '#ff8a96' : '#a8fff0';
    ctx.fillText(`INT ${cur}/${max}`, w / 2, h / 2);
    const tex = sprite.material.map;
    if (tex) tex.needsUpdate = true;
  }

  getWorldPos(unitId: string): THREE.Vector3 | null {
    const g = this.meshes.get(unitId);
    if (!g) return null;
    return g.position.clone();
  }

  private addHpBar(g: THREE.Group, height: number, isEnemy: boolean) {
    const bar = new THREE.Group();
    bar.position.set(0, height + 0.32, 0);
    const barW = isEnemy ? 0.85 : 0.7;
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, isEnemy ? 0.1 : 0.07),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
      }),
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(barW * 0.94, isEnemy ? 0.065 : 0.045),
      new THREE.MeshBasicMaterial({
        color: isEnemy ? 0xff5a6a : 0x4dff9a,
        depthTest: false,
      }),
    );
    fill.position.z = 0.01;
    bar.add(bg);
    bar.add(fill);

    // Numeric INT sprite above the bar
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    });
    const label = new THREE.Sprite(mat);
    label.scale.set(isEnemy ? 1.05 : 0.85, isEnemy ? 0.28 : 0.22, 1);
    label.position.set(0, isEnemy ? 0.22 : 0.16, 0);
    bar.add(label);

    g.add(bar);
    g.userData.hpBar = bar;
    g.userData.hpFill = fill;
    g.userData.hpLabel = label;
    g.userData.hpCanvas = canvas;
    g.userData.hpRatio = 1;
    g.userData.hpCur = 0;
    g.userData.hpMax = 1;
    g.userData.isEnemy = isEnemy;
    g.userData.hpLabelKey = '';
  }

  private buildUnit(u: UnitState): THREE.Group {
    const g = new THREE.Group();
    g.userData.unitId = u.id;
    const isEnemy = u.def.team === 'enemy';
    const accent = new THREE.Color(u.def.accent);

    // Circuit agents: epoxy / metal packages with LED status lights
    const litBody = isEnemy
      ? new THREE.Color(0x1a1014)
      : new THREE.Color(0x1a2820);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: litBody,
      roughness: 0.4,
      metalness: isEnemy ? 0.35 : 0.45,
      emissive: isEnemy ? new THREE.Color(0x300810) : new THREE.Color(0x0a2818),
      emissiveIntensity: 0.35,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: isEnemy ? 1.4 : 1.5,
      roughness: 0.22,
      metalness: 0.55,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x0c0e12,
      roughness: 0.4,
      metalness: 0.7,
    });
    const pinMat = new THREE.MeshStandardMaterial({
      color: 0xd4af6a,
      roughness: 0.3,
      metalness: 0.95,
    });
    const silMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.BackSide,
    });

    if (u.def.classId === 'mech') {
      return this.buildMech(g, bodyMat, accentMat, darkMat, silMat, isEnemy);
    }
    if (u.def.classId === 'drone') {
      return this.buildDrone(g, bodyMat, accentMat, silMat, isEnemy);
    }

    // DIP / SOIC style agent on gold pins
    const height = isEnemy ? 1.35 : 1.45;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, height * 0.55, 0.38),
      bodyMat,
    );
    body.position.y = height * 0.42;
    body.castShadow = true;
    g.add(body);
    g.userData.body = body;
    g.userData.baseBodyY = body.position.y;

    const sil = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, height * 0.58, 0.44),
      silMat,
    );
    sil.position.y = height * 0.42;
    g.add(sil);

    // "Die" window / laser etch face
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.22, 0.06),
      darkMat,
    );
    face.position.set(0, height * 0.55, 0.2);
    g.add(face);

    // LED eyes
    const eyeY = height * 0.58;
    for (const sx of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.04), accentMat);
      eye.position.set(sx, eyeY, 0.24);
      g.add(eye);
    }

    // Gold legs / pins
    for (const sx of [-0.18, 0.18]) {
      for (const sz of [-0.12, 0.12]) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.06), pinMat);
        pin.position.set(sx, 0.18, sz);
        pin.castShadow = true;
        g.add(pin);
      }
    }

    // Probe / antenna weapon
    const gunLen = u.def.classId === 'marksman' ? 0.75 : 0.45;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, gunLen), pinMat);
    gun.position.set(0.32, height * 0.48, gunLen * 0.25);
    g.add(gun);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), accentMat);
    tip.position.set(0.32, height * 0.48, gunLen * 0.55);
    g.add(tip);

    // Class LED stripe on package top
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.04, 0.12),
      accentMat,
    );
    stripe.position.set(0, height * 0.72, 0);
    g.add(stripe);

    this.addTeamRing(g, isEnemy ? 0xff3d5a : 0x00ffc8, 0.32, 0.4);
    this.addTeamBeacon(g, isEnemy ? 0xff3d5a : 0x00ffc8, height + 0.12);
    this.addHpBar(g, height, isEnemy);

    const ow = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.18, 4),
      new THREE.MeshBasicMaterial({ color: 0xffb020 }),
    );
    ow.position.y = height + 0.35;
    ow.visible = false;
    g.add(ow);
    g.userData.ow = ow;

    return g;
  }

  private addTeamRing(
    g: THREE.Group,
    color: number,
    inner: number,
    outer: number,
  ) {
    // Soft filled disc + hard ring for tactical clarity
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(inner * 0.92, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.025;
    g.add(disc);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    g.userData.ring = ring;
  }

  /** Small floating team pip — readable when ring is occluded by cover. */
  private addTeamBeacon(g: THREE.Group, color: number, y: number) {
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
      }),
    );
    beacon.position.y = y;
    g.add(beacon);
    g.userData.beacon = beacon;
  }

  private buildMech(
    g: THREE.Group,
    bodyMat: THREE.Material,
    accentMat: THREE.Material,
    darkMat: THREE.Material,
    silMat: THREE.Material,
    isEnemy: boolean,
  ): THREE.Group {
    // Large multi-chip power module / GPU block
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.7), bodyMat);
    torso.position.y = 0.85;
    torso.castShadow = true;
    g.add(torso);
    g.userData.body = torso;
    g.userData.baseBodyY = 0.85;

    const sil = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.8, 0.8), silMat);
    sil.position.y = 0.85;
    g.add(sil);

    const die = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), darkMat);
    die.position.set(0, 1.28, 0);
    g.add(die);

    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.05), accentMat);
    eye.position.set(0, 1.0, 0.38);
    g.add(eye);

    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.45, 0.55),
        darkMat,
      );
      fin.position.set(i * 0.14, 1.45, 0);
      g.add(fin);
    }

    for (const sx of [-0.28, 0.28]) {
      for (const sz of [-0.22, 0.22]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), darkMat);
        leg.position.set(sx, 0.25, sz);
        leg.castShadow = true;
        g.add(leg);
      }
    }

    const cannon = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.7), darkMat);
    cannon.position.set(0.5, 0.9, 0.35);
    g.add(cannon);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), accentMat);
    tip.position.set(0.5, 0.9, 0.75);
    g.add(tip);

    this.addTeamRing(g, isEnemy ? 0xffc14a : 0x00ffc8, 0.42, 0.52);
    this.addTeamBeacon(g, isEnemy ? 0xffc14a : 0x00ffc8, 1.7);
    this.addHpBar(g, 1.65, isEnemy);
    g.userData.ow = null;
    return g;
  }

  private buildDrone(
    g: THREE.Group,
    bodyMat: THREE.Material,
    accentMat: THREE.Material,
    silMat: THREE.Material,
    isEnemy: boolean,
  ): THREE.Group {
    // Floating SMD package
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.4), bodyMat);
    body.position.y = 1.05;
    body.castShadow = true;
    g.add(body);
    g.userData.body = body;
    g.userData.baseBodyY = 1.05;

    const sil = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.24, 0.48), silMat);
    sil.position.y = 1.05;
    g.add(sil);

    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.04), accentMat);
    eye.position.set(0, 1.05, 0.22);
    g.add(eye);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.04, 0.06),
        bodyMat,
      );
      arm.position.set(Math.cos(a) * 0.28, 1.05, Math.sin(a) * 0.28);
      arm.rotation.y = -a;
      g.add(arm);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.05, 0.08),
        accentMat,
      );
      pad.position.set(Math.cos(a) * 0.5, 1.05, Math.sin(a) * 0.5);
      g.add(pad);
    }

    this.addTeamRing(g, isEnemy ? 0xff5a3d : 0x00ffc8, 0.28, 0.36);
    this.addTeamBeacon(g, isEnemy ? 0xff5a3d : 0x00ffc8, 1.35);
    this.addHpBar(g, 1.3, isEnemy);
    g.userData.ow = null;
    return g;
  }

  private updateUnit(g: THREE.Group, u: UnitState, state: MissionState) {
    // Revive mesh if sim unit is alive again (new mission, same id)
    if (u.alive && (g.userData.dead || g.userData.dying)) {
      g.userData.dead = false;
      g.userData.dying = false;
      g.userData.deathT = 0;
      g.userData.corpseHideAt = undefined;
      g.userData.wasVisible = false;
      g.rotation.z = 0;
      g.position.y = 0;
      const bar = g.userData.hpBar as THREE.Object3D | undefined;
      if (bar) bar.visible = true;
      this.moves.delete(u.id);
    }

    // Position: if not mid-path, snap exactly to sim tile (no multi-click creep)
    if (!this.moves.has(u.id)) {
      g.position.x = u.pos.x * TILE;
      g.position.z = u.pos.y * TILE;
      if (u.alive) g.position.y = 0;
    }

    const ratio = Math.max(0, u.hp / u.def.maxHp);
    g.userData.hpRatio = ratio;
    g.userData.hpCur = u.hp;
    g.userData.hpMax = u.def.maxHp;
    g.userData.isEnemy = u.def.team === 'enemy';

    if (!u.alive) {
      this.moves.delete(u.id);
      // Start death pose once; keep corpse briefly for enemy if was visible
      if (!g.userData.dead && !g.userData.dying) {
        g.userData.dying = true;
        g.userData.deathT = 0;
        const bar = g.userData.hpBar as THREE.Object3D | undefined;
        if (bar) bar.visible = false;
      }
      if (u.def.team === 'enemy') {
        // Stay visible if explored death; hide only if never seen
        g.visible = state.visibleEnemyIds.has(u.id) || g.userData.wasVisible === true;
        if (state.visibleEnemyIds.has(u.id)) g.userData.wasVisible = true;
      } else {
        g.visible = true; // player corpses stay until mission end
      }
      if (g.userData.dead && u.def.team === 'enemy') {
        if (g.userData.corpseHideAt == null) {
          g.userData.corpseHideAt = this.clock + 3.5;
        }
        if (this.clock > (g.userData.corpseHideAt as number)) g.visible = false;
      }
      return;
    }

    if (u.def.team === 'enemy') {
      const visible = state.visibleEnemyIds.has(u.id);
      g.visible = visible;
      if (visible) g.userData.wasVisible = true;
    } else {
      g.visible = true;
    }

    const ow = g.userData.ow as THREE.Object3D | null;
    if (ow) ow.visible = u.overwatching;

    const ring = g.userData.ring as THREE.Mesh | undefined;
    if (ring && ring.material instanceof THREE.MeshBasicMaterial) {
      // Restore team color unless aimed (aimed handled in tick)
      if (this.aimedId !== u.id) {
        ring.material.color.set(u.def.team === 'enemy' ? 0xff3d5a : 0x00ffc8);
        if (state.selectedId === u.id) {
          ring.material.opacity = 1;
          ring.scale.setScalar(1.18 + Math.sin(this.clock * 4) * 0.06);
        } else {
          ring.material.opacity = 0.75;
          ring.scale.setScalar(1);
        }
      }
    }

    const beacon = g.userData.beacon as THREE.Mesh | undefined;
    if (beacon && beacon.material instanceof THREE.MeshBasicMaterial) {
      beacon.material.opacity = 0.75 + Math.sin(this.clock * 3 + g.position.x) * 0.15;
      if (state.selectedId === u.id) {
        beacon.scale.setScalar(1.35);
      } else {
        beacon.scale.setScalar(1);
      }
    }

    const body = g.userData.body as THREE.Mesh | undefined;
    if (body && body.material instanceof THREE.MeshStandardMaterial) {
      if (ratio < 0.35) {
        body.material.emissive = new THREE.Color(0x550000);
        body.material.emissiveIntensity = 0.35;
      }
    }
  }

  faceUnit(unitId: string, toward: { x: number; y: number }) {
    const g = this.meshes.get(unitId);
    if (!g) return;
    const dx = toward.x * TILE - g.position.x;
    const dz = toward.y * TILE - g.position.z;
    if (Math.abs(dx) + Math.abs(dz) < 0.01) return;
    g.rotation.y = Math.atan2(dx, dz);
  }

  /** Brief emissive flash on hit. */
  flashHit(unitId: string, crit = false) {
    const g = this.meshes.get(unitId);
    if (!g) return;
    const body = g.userData.body as THREE.Mesh | undefined;
    if (!body || !(body.material instanceof THREE.MeshStandardMaterial)) return;
    const mat = body.material;
    const prevE = mat.emissive.clone();
    const prevI = mat.emissiveIntensity;
    mat.emissive.set(crit ? 0xffaa44 : 0xff3333);
    mat.emissiveIntensity = crit ? 1.2 : 0.85;
    window.setTimeout(() => {
      mat.emissive.copy(prevE);
      mat.emissiveIntensity = prevI;
    }, crit ? 180 : 120);
  }
}
