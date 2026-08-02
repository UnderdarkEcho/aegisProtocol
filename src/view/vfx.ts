import * as THREE from 'three';
import { TILE } from '../sim/grid';

interface Tracer {
  line: THREE.Line;
  life: number;
  max: number;
}

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

/** Electrical / data-pulse VFX for motherboard combat. */
export class VFX {
  readonly root = new THREE.Group();
  private tracers: Tracer[] = [];
  private particles: Particle[] = [];
  private flashLight: THREE.PointLight;

  constructor() {
    this.flashLight = new THREE.PointLight(0x40ffe0, 0, 12, 2);
    this.root.add(this.flashLight);
  }

  tracer(from: { x: number; y: number }, to: { x: number; y: number }, crit = false) {
    const a = new THREE.Vector3(from.x * TILE, 1.15, from.y * TILE);
    const b = new THREE.Vector3(to.x * TILE, 1.1, to.y * TILE);
    b.x += (Math.random() - 0.5) * 0.06;
    b.z += (Math.random() - 0.5) * 0.06;

    // Zigzag arc along the shot path (looks like a current jump)
    const pts: THREE.Vector3[] = [];
    const segs = crit ? 10 : 7;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = a.clone().lerp(b, t);
      if (i > 0 && i < segs) {
        const side = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize();
        p.addScaledVector(side, (Math.random() - 0.5) * (crit ? 0.45 : 0.28));
        p.y += (Math.random() - 0.5) * 0.35;
      }
      pts.push(p);
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: crit ? 0xffee66 : 0x40ffe8,
      transparent: true,
      opacity: 1,
    });
    const line = new THREE.Line(geo, mat);
    this.root.add(line);
    this.tracers.push({ line, life: crit ? 0.32 : 0.18, max: crit ? 0.32 : 0.18 });

    // Second faint parallel arc
    if (crit) {
      const pts2 = pts.map((p) =>
        p
          .clone()
          .add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.05, (Math.random() - 0.5) * 0.15)),
      );
      const geo2 = new THREE.BufferGeometry().setFromPoints(pts2);
      const mat2 = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.7,
      });
      const line2 = new THREE.Line(geo2, mat2);
      this.root.add(line2);
      this.tracers.push({ line: line2, life: 0.2, max: 0.2 });
    }

    this.flashLight.position.copy(a);
    this.flashLight.intensity = crit ? 22 : 14;
    this.flashLight.color.set(crit ? 0xffee88 : 0x40ffe0);

    for (let i = 0; i < (crit ? 8 : 5); i++) {
      this.spawnParticle(
        a.clone(),
        new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          Math.random() * 2,
          (Math.random() - 0.5) * 3,
        ),
        0.14,
        crit ? 0xffee66 : 0x60ffe8,
        0.04,
      );
    }
  }

  explosion(at: { x: number; y: number }) {
    const origin = new THREE.Vector3(at.x * TILE, 0.45, at.y * TILE);
    this.flashLight.position.copy(origin);
    this.flashLight.intensity = 32;
    this.flashLight.color.set(0xff9040);

    // Radial spark burst — short circuit
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * Math.PI * 2 + Math.random() * 0.2;
      const speed = 2 + Math.random() * 4;
      this.spawnParticle(
        origin.clone(),
        new THREE.Vector3(
          Math.cos(ang) * speed,
          Math.random() * 3 + 0.5,
          Math.sin(ang) * speed,
        ),
        0.45 + Math.random() * 0.35,
        i % 3 === 0 ? 0xffaa44 : i % 3 === 1 ? 0x40ffe0 : 0xffffff,
        0.06 + Math.random() * 0.04,
      );
    }

    // Ring flash on board surface
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.2 + r * 0.25, 0.28 + r * 0.25, 24),
        new THREE.MeshBasicMaterial({
          color: 0x40ffe0,
          transparent: true,
          opacity: 0.7 - r * 0.2,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(origin);
      ring.position.y = 0.08;
      this.root.add(ring);
      // dispose via particle system using zero vel + scale
      this.particles.push({
        mesh: ring as unknown as THREE.Mesh,
        vel: new THREE.Vector3(0, 0.4 + r * 0.2, 0),
        life: 0.35,
      });
    }
  }

  impact(at: { x: number; y: number }) {
    const origin = new THREE.Vector3(at.x * TILE, 1.1, at.y * TILE);
    this.flashLight.position.copy(origin);
    this.flashLight.intensity = Math.max(this.flashLight.intensity, 10);
    this.flashLight.color.set(0x80ffe0);

    for (let i = 0; i < 14; i++) {
      this.spawnParticle(
        origin.clone(),
        new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          Math.random() * 2.2,
          (Math.random() - 0.5) * 3,
        ),
        0.3,
        Math.random() > 0.5 ? 0x40ffe0 : 0xffffff,
        0.04,
      );
    }
  }

  coverBreak(at: { x: number; y: number }) {
    this.explosion(at);
  }

  private spawnParticle(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    life: number,
    color: number,
    size: number,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshBasicMaterial({ color }),
    );
    mesh.position.copy(pos);
    this.root.add(mesh);
    this.particles.push({ mesh, vel, life });
  }

  update(dt: number) {
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 48);

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.life -= dt;
      const mat = t.line.material as THREE.LineBasicMaterial;
      mat.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) {
        this.root.remove(t.line);
        t.line.geometry.dispose();
        mat.dispose();
        this.tracers.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.mesh.geometry.type === 'RingGeometry') {
        p.mesh.scale.multiplyScalar(1 + dt * 3.2);
        p.mesh.position.y += dt * 0.15;
        const m = p.mesh.material as THREE.MeshBasicMaterial;
        if (m.opacity != null) m.opacity = Math.max(0, p.life * 2.2);
      } else {
        p.vel.y -= 9 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += dt * 6;
        p.mesh.rotation.z += dt * 5;
      }
      if (p.life <= 0 || p.mesh.position.y < -0.2) {
        this.root.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
    }
  }
}
