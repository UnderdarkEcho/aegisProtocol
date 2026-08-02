import * as THREE from 'three';
import { TILE } from '../sim/grid';

export class TacticalCamera {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(14, 0, 12);
  yaw = Math.PI / 4;
  pitch = Math.PI / 3.2;
  distance = 22;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private bounds = { minX: 2, maxX: 26, minZ: 2, maxZ: 22 };

  private goal = new THREE.Vector3(14, 0, 12);
  private goalActive = false;
  /** Higher = snappier; kept moderate to avoid bounce */
  private followLambda = 6;
  private lastUpdate = performance.now();

  /** Hard lock onto a unit mesh — stable center while they act */
  private followUnitId: string | null = null;
  private followUntil = 0;
  private resolveFollowPos: ((id: string) => THREE.Vector3 | null) | null = null;

  private shakeAmp = 0;
  private shakeDecay = 8;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 200);
    this.goal.copy(this.target);
    this.update();
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Provide world positions for unit lock-on (usually mesh position). */
  setFollowResolver(fn: (id: string) => THREE.Vector3 | null) {
    this.resolveFollowPos = fn;
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;

    // Unit lock: continuously center on that unit's current mesh position
    if (this.followUnitId && this.resolveFollowPos) {
      if (now > this.followUntil) {
        this.followUnitId = null;
      } else {
        const p = this.resolveFollowPos(this.followUnitId);
        if (p) {
          this.goal.set(p.x, 0, p.z);
          this.clampGoal();
          this.goalActive = true;
        }
      }
    }

    if (this.goalActive) {
      // Exponential damp — smooth, no overshoot thrash
      const t = 1 - Math.exp(-this.followLambda * dt);
      this.target.x += (this.goal.x - this.target.x) * t;
      this.target.z += (this.goal.z - this.target.z) * t;
      this.clampTarget();
      if (
        !this.followUnitId &&
        Math.hypot(this.goal.x - this.target.x, this.goal.z - this.target.z) < 0.04
      ) {
        this.target.x = this.goal.x;
        this.target.z = this.goal.z;
        this.goalActive = false;
      }
    }

    const x = this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance;
    const y = this.target.y + Math.sin(this.pitch) * this.distance;
    const z = this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance;
    this.camera.position.set(x, y, z);

    // Horizontal-only residual shake (no vertical juggle)
    if (this.shakeAmp > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmp * 0.5;
      this.shakeAmp = Math.max(0, this.shakeAmp - this.shakeDecay * dt);
    }

    this.camera.lookAt(this.target);
  }

  focusWorld(wx: number, wz: number, instant = false) {
    this.followUnitId = null;
    if (instant) {
      this.target.set(wx, 0, wz);
      this.goal.copy(this.target);
      this.goalActive = false;
      this.clampTarget();
      this.update();
      return;
    }
    this.goal.set(wx, 0, wz);
    this.clampGoal();
    this.goalActive = true;
    this.followLambda = 6;
  }

  focusTile(tx: number, ty: number, instant = false) {
    this.focusWorld(tx * TILE, ty * TILE, instant);
  }

  /**
   * Lock camera center on a unit for holdMs. Tracks mesh every frame.
   * Prefer this for enemy actions so the frame doesn't juggle midpoints.
   */
  lockOnUnit(unitId: string, holdMs = 900) {
    this.followUnitId = unitId;
    this.followUntil = performance.now() + holdMs;
    this.goalActive = true;
    this.followLambda = 7;
    // Seed goal immediately if we can
    if (this.resolveFollowPos) {
      const p = this.resolveFollowPos(unitId);
      if (p) {
        this.goal.set(p.x, 0, p.z);
        this.clampGoal();
      }
    }
  }

  /** Extend current lock if already on this unit; otherwise switch. */
  keepLockOnUnit(unitId: string, holdMs = 700) {
    if (this.followUnitId === unitId) {
      this.followUntil = Math.max(this.followUntil, performance.now() + holdMs);
      return;
    }
    this.lockOnUnit(unitId, holdMs);
  }

  /** Soft pan to a fixed world point (pod centroid, etc.) — no unit lock. */
  focusAction(wx: number, wz: number, opts?: { speed?: number; holdMs?: number }) {
    this.followUnitId = null;
    this.goal.set(wx, 0, wz);
    this.clampGoal();
    this.goalActive = true;
    this.followLambda = opts?.speed != null ? opts.speed * 30 : 6;
    // holdMs unused for fixed points — damp settles naturally
  }

  focusActionTiles(a: { x: number; y: number }, b?: { x: number; y: number }) {
    if (b) {
      this.focusAction(((a.x + b.x) / 2) * TILE, ((a.y + b.y) / 2) * TILE);
    } else {
      this.focusAction(a.x * TILE, a.y * TILE);
    }
  }

  clearLock() {
    this.followUnitId = null;
    this.goalActive = false;
  }

  isLocked(): boolean {
    return this.followUnitId != null && performance.now() <= this.followUntil;
  }

  bind(dom: HTMLElement) {
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.clearLock();
      }
    });
    window.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, 0.35, 1.35);
      this.update();
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(
          this.distance + e.deltaY * 0.02,
          10,
          40,
        );
        this.update();
      },
      { passive: false },
    );
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      const step = 0.8;
      if (e.key === 'q' || e.key === 'Q') {
        this.yaw += 0.12;
        this.update();
      }
      if (e.key === 'e' || e.key === 'E') {
        this.yaw -= 0.12;
        this.update();
      }
      if (e.key === 'w' || e.key === 'ArrowUp') {
        this.pan(0, -step);
      }
      if (e.key === 's' || e.key === 'ArrowDown') {
        this.pan(0, step);
      }
      if (e.key === 'a' || e.key === 'ArrowLeft') {
        this.pan(-step, 0);
      }
      if (e.key === 'd' || e.key === 'ArrowRight') {
        this.pan(step, 0);
      }
    });
  }

  private pan(localX: number, localZ: number) {
    this.clearLock();
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.target.x += localX * cos + localZ * sin;
    this.target.z += -localX * sin + localZ * cos;
    this.goal.copy(this.target);
    this.clampTarget();
    this.update();
  }

  private clampTarget() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ);
  }

  private clampGoal() {
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, this.bounds.minX, this.bounds.maxX);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, this.bounds.minZ, this.bounds.maxZ);
  }

  /** Subtle horizontal shake only — no vertical bounce. */
  shake(amount = 0.15) {
    this.shakeAmp = Math.min(0.35, this.shakeAmp + amount * 0.55);
  }
}
