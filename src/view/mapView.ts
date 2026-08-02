import * as THREE from 'three';
import { PICKUP_COLOR } from '../sim/pickups';
import { TILE } from '../sim/grid';
import type { CoverProp, MissionState, Pickup } from '../sim/types';
import type { Materials } from './materials';

/** Subtle flowing electricity outline for move zones. */
function createElectricOutlineMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vWorld;
      void main() {
        // Soft traveling shimmer — barely brighter than the pad color
        float flow = 0.5 + 0.5 * sin((vWorld.x + vWorld.z) * 5.0 - uTime * 3.5);
        float hot = pow(flow, 3.0);
        float breathe = 0.85 + 0.15 * sin(uTime * 1.6);
        vec3 col = uColor * (0.55 + hot * 0.35) * breathe;
        float alpha = 0.22 + hot * 0.18;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export class MapView {
  readonly root = new THREE.Group();
  private propMeshes = new Map<string, THREE.Object3D>();
  private fogMeshes: THREE.Mesh[] = [];
  private moveMarkers = new THREE.Group();
  private pathGroup = new THREE.Group();
  private aimGroup = new THREE.Group();
  private selectMarker: THREE.Mesh;
  private hoverMarker: THREE.Mesh;
  private mats: Materials;
  private gridHelper: THREE.GridHelper;
  private clock = 0;
  private electricMats: THREE.ShaderMaterial[] = [];
  private pickupMeshes = new Map<string, THREE.Group>();
  private pickupRoot = new THREE.Group();

  constructor(mats: Materials) {
    this.mats = mats;
    this.root.add(this.moveMarkers);
    this.root.add(this.pathGroup);
    this.root.add(this.aimGroup);
    this.root.add(this.pickupRoot);

    const ringGeo = new THREE.RingGeometry(0.35, 0.48, 32);
    this.selectMarker = new THREE.Mesh(ringGeo, mats.selectRing);
    this.selectMarker.rotation.x = -Math.PI / 2;
    this.selectMarker.position.y = 0.05;
    this.selectMarker.visible = false;
    this.root.add(this.selectMarker);

    const hoverGeo = new THREE.PlaneGeometry(0.95, 0.95);
    hoverGeo.rotateX(-Math.PI / 2);
    this.hoverMarker = new THREE.Mesh(hoverGeo, mats.hoverTile);
    this.hoverMarker.position.y = 0.06;
    this.hoverMarker.visible = false;
    this.root.add(this.hoverMarker);

    // Copper-trace grid overlay on the PCB
    this.gridHelper = new THREE.GridHelper(40, 40, 0xb87333, 0x1a4028);
    this.gridHelper.position.set(13.5, 0.025, 11.5);
    const gmat = this.gridHelper.material;
    if (Array.isArray(gmat)) {
      gmat.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.28;
      });
    } else {
      gmat.transparent = true;
      gmat.opacity = 0.28;
    }
    this.root.add(this.gridHelper);
  }

  build(state: MissionState) {
    const keep = new Set<THREE.Object3D>([
      this.moveMarkers,
      this.pathGroup,
      this.aimGroup,
      this.pickupRoot,
      this.selectMarker,
      this.hoverMarker,
      this.gridHelper,
    ]);
    [...this.root.children].forEach((c) => {
      if (!keep.has(c)) this.root.remove(c);
    });
    this.propMeshes.clear();
    this.fogMeshes = [];
    this.pickupMeshes.clear();
    this.pickupRoot.clear();

    const groundGeo = new THREE.PlaneGeometry(
      state.width * TILE,
      state.height * TILE,
      state.width,
      state.height,
    );
    groundGeo.rotateX(-Math.PI / 2);
    // UV for repeating asphalt: mapView plane spans full map
    const uvs = groundGeo.attributes.uv;
    if (uvs) {
      for (let i = 0; i < uvs.count; i++) {
        uvs.setXY(i, uvs.getX(i) * (state.width / 4), uvs.getY(i) * (state.height / 4));
      }
      uvs.needsUpdate = true;
    }
    const ground = new THREE.Mesh(groundGeo, this.mats.ground);
    ground.position.set(
      ((state.width - 1) * TILE) / 2,
      0,
      ((state.height - 1) * TILE) / 2,
    );
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.root.add(ground);

    // Copper pour islands / test pads on the PCB
    for (let i = 0; i < 18; i++) {
      const w = 0.8 + Math.random() * 2.4;
      const d = 0.6 + Math.random() * 1.8;
      const geo = new THREE.PlaneGeometry(w, d);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.mats.groundWet);
      m.position.set(
        Math.random() * state.width * TILE,
        0.014,
        Math.random() * state.height * TILE,
      );
      m.rotation.y = (Math.random() > 0.5 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.1;
      m.receiveShadow = true;
      this.root.add(m);
    }

    // Scattered SMD dots (tiny chips on empty board areas)
    for (let i = 0; i < 40; i++) {
      const sx = 1 + Math.random() * (state.width - 2);
      const sz = 1 + Math.random() * (state.height - 2);
      const smd = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.06, 0.12),
        Math.random() > 0.5 ? this.mats.crate : this.mats.sandbag,
      );
      smd.position.set(sx, 0.04, sz);
      smd.castShadow = true;
      this.root.add(smd);
    }

    this.buildStructures(state);

    for (const p of state.props.values()) {
      this.addProp(p);
    }

    for (const pk of state.pickups.values()) {
      if (!pk.collected) this.addPickupMesh(pk);
    }

    for (const e of state.extractTiles) {
      // South jack-in pads
      const pad = new THREE.Group();
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.05, 0.55),
        this.mats.extract,
      );
      m.position.y = 0.03;
      pad.add(m);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.5, 4),
        new THREE.MeshBasicMaterial({
          color: 0xffcc44,
          transparent: true,
          opacity: 0.65,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      pad.add(ring);
      pad.position.set(e.x * TILE, 0, e.y * TILE);
      this.root.add(pad);
    }

    // North data port — primary infiltrate objective
    this.addDataPort(state);

    this.addLedTower(5, 9);
    this.addLedTower(22, 9);
    this.addLedTower(14, 18);
    this.addLedTower(8, 5);

    // Pin-header fence along board edges
    for (let x = 1; x < state.width - 1; x += 2) {
      this.addPinHeader(x, 1);
      this.addPinHeader(x, state.height - 2);
    }
  }

  private buildStructures(state: MissionState) {
    const visited = Array.from({ length: state.height }, () =>
      Array.from({ length: state.width }, () => false),
    );

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const t = state.tiles[y]![x]!;
        if (!t.blocked || visited[y]![x]) continue;
        let x1 = x;
        while (
          x1 + 1 < state.width &&
          state.tiles[y]![x1 + 1]!.blocked &&
          !visited[y]![x1 + 1]
        ) {
          x1++;
        }
        let y1 = y;
        outer: while (y1 + 1 < state.height) {
          for (let xx = x; xx <= x1; xx++) {
            if (!state.tiles[y1 + 1]![xx]!.blocked) break outer;
          }
          y1++;
        }
        for (let yy = y; yy <= y1; yy++) {
          for (let xx = x; xx <= x1; xx++) visited[yy]![xx] = true;
        }

        const w = (x1 - x + 1) * TILE;
        const d = (y1 - y + 1) * TILE;
        // IC packages sit lower / wider than buildings
        const h = 0.55 + ((x + y) % 3) * 0.22 + Math.min(w, d) * 0.08;
        const cx = (x + x1) * 0.5 * TILE;
        const cz = (y + y1) * 0.5 * TILE;
        const useDark = (x + y) % 2 === 0;
        const mat = useDark ? this.mats.concreteDark : this.mats.concrete;

        // Main epoxy package body
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.9, h, d * 0.9),
          mat,
        );
        body.position.set(cx, h / 2 + 0.08, cz);
        body.castShadow = true;
        body.receiveShadow = true;
        this.root.add(body);

        // Substrate / interposer under package
        const substrate = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.96, 0.08, d * 0.96),
          this.mats.metalDark,
        );
        substrate.position.set(cx, 0.04, cz);
        substrate.castShadow = true;
        substrate.receiveShadow = true;
        this.root.add(substrate);

        // Gold pin legs / BGA balls around perimeter
        this.addIcPins(cx, cz, w * 0.9, d * 0.9, 0.08);

        // Label plate on top
        const label = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.55, 0.02, d * 0.35),
          this.mats.metal,
        );
        label.position.set(cx, h + 0.09, cz);
        this.root.add(label);

        // Status LEDs on package (activity lights)
        this.addFacadeWindows(cx, cz, w * 0.9, d * 0.9, h + 0.08, x + y);
      }
    }
  }

  private addIcPins(cx: number, cz: number, w: number, d: number, y: number) {
    const pinGeo = new THREE.BoxGeometry(0.06, 0.1, 0.06);
    const spacing = 0.22;
    const halfW = w / 2;
    const halfD = d / 2;
    // North / south rows
    for (let side of [-1, 1]) {
      for (let t = -halfW + 0.15; t <= halfW - 0.15; t += spacing) {
        const pin = new THREE.Mesh(pinGeo, this.mats.metalEdge);
        pin.position.set(cx + t, y, cz + side * halfD);
        pin.castShadow = true;
        this.root.add(pin);
      }
      for (let t = -halfD + 0.15; t <= halfD - 0.15; t += spacing) {
        const pin = new THREE.Mesh(pinGeo, this.mats.metalEdge);
        pin.position.set(cx + side * halfW, y, cz + t);
        pin.castShadow = true;
        this.root.add(pin);
      }
    }
  }

  /** Status LEDs on IC package tops (blink via emissive materials). */
  private addFacadeWindows(
    cx: number,
    cz: number,
    w: number,
    d: number,
    h: number,
    seed: number,
  ) {
    const mats = [this.mats.windowLit, this.mats.windowDim, this.mats.emissiveOrange];
    const count = Math.max(2, Math.min(6, Math.floor(Math.max(w, d) * 1.8)));
    const y = h + 0.12;
    for (let i = 0; i < count; i++) {
      const mat = mats[(seed + i * 3) % mats.length]!;
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.06, 0.12),
        mat,
      );
      const ox = ((i % 3) - 1) * Math.min(0.35, w * 0.25);
      const oz = (Math.floor(i / 3) - 0.5) * Math.min(0.3, d * 0.2);
      led.position.set(cx + ox, y, cz + oz);
      led.userData.blinkPhase = (seed + i) * 0.7;
      led.userData.isLed = true;
      this.root.add(led);
    }
  }

  private addProp(p: CoverProp) {
    const group = new THREE.Group();
    group.position.set(p.pos.x * TILE, 0, p.pos.y * TILE);
    group.userData.propId = p.id;

    let mesh: THREE.Mesh;
    if (p.kind === 'crate') {
      // Multilayer ceramic capacitor (tan brick)
      const h = p.level === 2 ? 0.95 : 0.55;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.75, h, 0.45), this.mats.crate);
      mesh.position.y = h / 2;
      const endL = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, h * 0.95, 0.48),
        this.mats.metalEdge,
      );
      endL.position.set(-0.38, h / 2, 0);
      const endR = endL.clone();
      endR.position.x = 0.38;
      group.add(endL);
      group.add(endR);
    } else if (p.kind === 'barrier') {
      // Aluminum heatsink fin stack (full cover)
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 1.15, 0.4),
        this.mats.barrier,
      );
      mesh.position.y = 0.58;
      for (let i = -2; i <= 2; i++) {
        const fin = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 1.2, 0.42),
          this.mats.metal,
        );
        fin.position.set(i * 0.16, 0.62, 0);
        fin.castShadow = true;
        group.add(fin);
      }
    } else if (p.kind === 'sandbag') {
      // Through-hole resistor body
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.7, 10),
        this.mats.sandbag,
      );
      mesh.rotation.z = Math.PI / 2;
      mesh.position.y = 0.22;
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.19, 0.19, 0.08, 10),
        this.mats.emissiveOrange,
      );
      band.rotation.z = Math.PI / 2;
      band.position.y = 0.22;
      group.add(band);
    } else {
      // Edge connector / black plastic header
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.35, 0.55, 0.55),
        this.mats.vehicle,
      );
      mesh.position.y = 0.28;
      for (let i = 0; i < 6; i++) {
        const pin = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.35, 0.08),
          this.mats.metalEdge,
        );
        pin.position.set(-0.5 + i * 0.2, 0.55, 0);
        group.add(pin);
      }
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Cover-level LED
    const pip = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      p.level === 2 ? this.mats.emissiveCyan : this.mats.emissiveOrange,
    );
    pip.position.set(0, 1.25, 0);
    group.add(pip);

    this.root.add(group);
    this.propMeshes.set(p.id, group);
  }

  private addDataPort(state: MissionState) {
    if (!state.dataPortTiles?.length) return;
    let cx = 0;
    let cz = 0;
    for (const t of state.dataPortTiles) {
      cx += t.x;
      cz += t.y;
      // Floor tiles under port
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(0.92, 0.06, 0.92),
        new THREE.MeshStandardMaterial({
          color: 0x0a2030,
          emissive: 0x00e8c0,
          emissiveIntensity: 0.45,
          roughness: 0.35,
          metalness: 0.7,
        }),
      );
      floor.position.set(t.x * TILE, 0.03, t.y * TILE);
      floor.receiveShadow = true;
      this.root.add(floor);
    }
    cx = (cx / state.dataPortTiles.length) * TILE;
    cz = (cz / state.dataPortTiles.length) * TILE;

    // Vertical uplink pillar
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.28, 1.4, 10),
      new THREE.MeshStandardMaterial({
        color: 0x1a2830,
        emissive: 0x0088aa,
        emissiveIntensity: 0.5,
        metalness: 0.8,
        roughness: 0.3,
      }),
    );
    pillar.position.set(cx, 0.75, cz);
    pillar.castShadow = true;
    this.root.add(pillar);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.2, 0.2, 10),
      new THREE.MeshStandardMaterial({
        color: 0x0a1018,
        emissive: 0x00ffc8,
        emissiveIntensity: 1.2,
        metalness: 0.6,
        roughness: 0.25,
      }),
    );
    cap.position.set(cx, 1.5, cz);
    this.root.add(cap);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8),
      new THREE.MeshBasicMaterial({
        color: 0x40ffe0,
        transparent: true,
        opacity: 0.35,
      }),
    );
    beam.position.set(cx, 2.6, cz);
    this.root.add(beam);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.15, 32),
      new THREE.MeshBasicMaterial({
        color: 0x00ffc8,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(cx, 0.08, cz);
    halo.userData.isLed = true;
    halo.userData.blinkPhase = 1.2;
    this.root.add(halo);

    const light = new THREE.PointLight(0x40ffe0, 10, 12, 1.5);
    light.position.set(cx, 1.8, cz);
    this.root.add(light);
  }

  private addLedTower(x: number, z: number) {
    // Indicator LED stanchion / test point mast
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.07, 2.4, 8),
      this.mats.metalDark,
    );
    pole.position.set(x, 1.2, z);
    pole.castShadow = true;
    this.root.add(pole);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.08, 0.35),
      this.mats.vehicle,
    );
    base.position.set(x, 0.04, z);
    this.root.add(base);

    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 10),
      this.mats.emissiveCyan,
    );
    led.position.set(x, 2.45, z);
    this.root.add(led);

    const light = new THREE.PointLight(0x40ffe0, 8, 14, 1.6);
    light.position.set(x, 2.4, z);
    this.root.add(light);

    const fill = new THREE.PointLight(0x80ffc0, 2.2, 9, 2);
    fill.position.set(x, 1.2, z);
    this.root.add(fill);
  }

  private addPinHeader(x: number, z: number) {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.22, 0.28),
      this.mats.vehicle,
    );
    block.position.set(x, 0.12, z);
    block.castShadow = true;
    this.root.add(block);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const pin = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.55, 0.05),
          this.mats.metalEdge,
        );
        pin.position.set(x - 0.06 + i * 0.12, 0.4, z - 0.06 + j * 0.12);
        pin.castShadow = true;
        this.root.add(pin);
      }
    }
  }

  syncProps(state: MissionState) {
    for (const [id, mesh] of this.propMeshes) {
      const p = state.props.get(id);
      if (!p || p.destroyed) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
      }
    }
    this.syncPickups(state);
  }

  syncPickups(state: MissionState) {
    for (const p of state.pickups.values()) {
      let g = this.pickupMeshes.get(p.id);
      if (!g && !p.collected) {
        this.addPickupMesh(p);
        g = this.pickupMeshes.get(p.id);
      }
      if (g) g.visible = !p.collected;
    }
  }

  private addPickupMesh(p: Pickup) {
    const color = PICKUP_COLOR[p.kind];
    const g = new THREE.Group();
    g.position.set(p.pos.x * TILE, 0, p.pos.y * TILE);
    g.userData.pickupId = p.id;
    g.userData.bobPhase = Math.random() * Math.PI * 2;

    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.85,
        roughness: 0.25,
        metalness: 0.55,
      }),
    );
    core.position.y = 0.45;
    core.castShadow = true;
    g.add(core);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.34, 16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);

    const light = new THREE.PointLight(color, 1.6, 3.5, 2);
    light.position.y = 0.5;
    g.add(light);

    this.pickupRoot.add(g);
    this.pickupMeshes.set(p.id, g);
  }

  setSelect(tile: { x: number; y: number } | null) {
    if (!tile) {
      this.selectMarker.visible = false;
      return;
    }
    this.selectMarker.visible = true;
    this.selectMarker.position.set(tile.x * TILE, 0.05, tile.y * TILE);
  }

  setHover(tile: { x: number; y: number } | null) {
    if (!tile) {
      this.hoverMarker.visible = false;
      return;
    }
    this.hoverMarker.visible = true;
    this.hoverMarker.position.set(tile.x * TILE, 0.06, tile.y * TILE);
  }

  showMoves(
    blue: Map<string, unknown>,
    yellow: Map<string, unknown>,
  ) {
    this.moveMarkers.clear();
    // Contact pads (fill only — outline is the zone perimeter, not per-tile)
    const padGeo = new THREE.CircleGeometry(0.42, 6);
    padGeo.rotateX(-Math.PI / 2);

    for (const k of blue.keys()) {
      const [xs, ys] = k.split(',');
      const m = new THREE.Mesh(padGeo, this.mats.blueMove);
      m.position.set(Number(xs) * TILE, 0.04, Number(ys) * TILE);
      this.moveMarkers.add(m);
    }
    for (const k of yellow.keys()) {
      const [xs, ys] = k.split(',');
      const m = new THREE.Mesh(padGeo, this.mats.yellowMove);
      m.position.set(Number(xs) * TILE, 0.04, Number(ys) * TILE);
      this.moveMarkers.add(m);
    }

    // Blue outline for blue pads, yellow for yellow — thick + electric flow
    this.addZoneOutline(blue, 0x3d9cff, 0.052, 0.05);
    this.addZoneOutline(yellow, 0xffc14a, 0.056, 0.05);
  }

  /**
   * Thick perimeter for a tile set. Inset toward zone interior so adjacent
   * blue/yellow zones each keep their own colored border.
   * Uses flat ribbon meshes + shader for reliable thickness + electricity glow.
   */
  private addZoneOutline(
    tiles: Map<string, unknown>,
    color: number,
    y: number,
    inset: number,
  ) {
    if (tiles.size === 0) return;

    const half = TILE * 0.5;
    const has = (x: number, y: number) => tiles.has(`${x},${y}`);
    const mat = createElectricOutlineMaterial(color);
    this.electricMats.push(mat);

    const edges: Array<{ ax: number; az: number; bx: number; bz: number }> = [];

    for (const k of tiles.keys()) {
      const [xs, ys] = k.split(',');
      const tx = Number(xs);
      const ty = Number(ys);
      const cx = tx * TILE;
      const cz = ty * TILE;
      const x0 = cx - half + inset;
      const x1 = cx + half - inset;
      const z0 = cz - half + inset;
      const z1 = cz + half - inset;

      if (!has(tx - 1, ty)) edges.push({ ax: x0, az: z0, bx: x0, bz: z1 });
      if (!has(tx + 1, ty)) edges.push({ ax: x1, az: z0, bx: x1, bz: z1 });
      if (!has(tx, ty - 1)) edges.push({ ax: x0, az: z0, bx: x1, bz: z0 });
      if (!has(tx, ty + 1)) edges.push({ ax: x0, az: z1, bx: x1, bz: z1 });
    }

    for (const e of edges) {
      // Thin ribbon only — keep outline quiet against the pads
      this.addOutlineRibbon(e.ax, e.az, e.bx, e.bz, y, 0.032, mat);
    }
  }

  private addOutlineRibbon(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    y: number,
    width: number,
    mat: THREE.Material,
  ) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const geo = new THREE.PlaneGeometry(len + width * 0.2, width);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((ax + bx) * 0.5, y, (az + bz) * 0.5);
    mesh.rotation.y = Math.atan2(-dz, dx);
    mesh.renderOrder = 2;
    this.moveMarkers.add(mesh);
  }

  clearMoves() {
    for (const m of this.electricMats) m.dispose();
    this.electricMats = [];
    this.moveMarkers.clear();
    this.clearPath();
  }

  showPath(path: Array<{ x: number; y: number }>, dash = false) {
    this.clearPath();
    if (path.length < 2) return;

    const pts = path.map(
      (p) => new THREE.Vector3(p.x * TILE, 0.12, p.y * TILE),
    );
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = this.mats.pathLine.clone();
    mat.color.set(dash ? 0xffc14a : 0x7ad7ff);
    const line = new THREE.Line(geo, mat);
    this.pathGroup.add(line);

    // Dots on each waypoint
    const dotGeo = new THREE.SphereGeometry(0.08, 8, 8);
    for (let i = 0; i < pts.length; i++) {
      const c = i === pts.length - 1 ? 0xffffff : dash ? 0xffc14a : 0x3de0ff;
      const dot = new THREE.Mesh(
        dotGeo,
        new THREE.MeshBasicMaterial({ color: c }),
      );
      dot.position.copy(pts[i]!);
      this.pathGroup.add(dot);
    }
  }

  clearPath() {
    while (this.pathGroup.children.length) {
      const c = this.pathGroup.children[0]!;
      this.pathGroup.remove(c);
      if (c instanceof THREE.Line || c instanceof THREE.Mesh) {
        c.geometry.dispose();
        const m = c.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else if (m !== this.mats.pathLine) m.dispose();
      }
    }
  }

  /** Dashed-feeling aim reticle from shooter to target. */
  showAimLine(
    from: { x: number; y: number },
    to: { x: number; y: number },
    hitChance: number,
  ) {
    this.clearAimLine();
    const a = new THREE.Vector3(from.x * TILE, 1.2, from.y * TILE);
    const b = new THREE.Vector3(to.x * TILE, 1.15, to.y * TILE);
    const color =
      hitChance >= 70 ? 0x4dff9a : hitChance >= 40 ? 0xffc14a : 0xff3d5a;
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineDashedMaterial({
      color,
      dashSize: 0.25,
      gapSize: 0.12,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    this.aimGroup.add(line);

    // Target diamond
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.36, 4),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(to.x * TILE, 0.08, to.y * TILE);
    this.aimGroup.add(ring);
  }

  clearAimLine() {
    while (this.aimGroup.children.length) {
      const c = this.aimGroup.children[0]!;
      this.aimGroup.remove(c);
      if (c instanceof THREE.Line || c instanceof THREE.Mesh) {
        c.geometry.dispose();
        const m = c.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    }
  }

  /** Pulse package LEDs + drive electricity on move-zone outlines + bob pickups. */
  tick(dt: number) {
    this.clock += dt;
    for (const m of this.electricMats) {
      const t = m.uniforms['uTime'];
      if (t) t.value = this.clock;
    }
    this.root.traverse((obj) => {
      if (!obj.userData.isLed) return;
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material;
      if (!(mat instanceof THREE.MeshStandardMaterial)) return;
      const phase = (mesh.userData.blinkPhase as number) ?? 0;
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * 3.2 + phase);
      mat.emissiveIntensity = 0.4 + pulse * 1.2;
    });
    for (const g of this.pickupMeshes.values()) {
      if (!g.visible) continue;
      const phase = (g.userData.bobPhase as number) ?? 0;
      const core = g.children[0];
      if (core) {
        core.position.y = 0.42 + Math.sin(this.clock * 2.4 + phase) * 0.08;
        core.rotation.y = this.clock * 1.2 + phase;
      }
    }
  }

  updateFog(state: MissionState, showFog: boolean) {
    for (const m of this.fogMeshes) this.root.remove(m);
    this.fogMeshes = [];
    if (!showFog) return;

    const geo = new THREE.PlaneGeometry(0.98, 0.98);
    geo.rotateX(-Math.PI / 2);
    const visible = state.visibleTiles ?? new Set<string>();
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const explored = state.explored[y]?.[x];
        const key = `${x},${y}`;
        if (!explored) {
          const m = new THREE.Mesh(geo, this.mats.fogMat);
          m.position.set(x * TILE, 0.22, y * TILE);
          this.root.add(m);
          this.fogMeshes.push(m);
        } else if (!visible.has(key)) {
          const m = new THREE.Mesh(geo, this.mats.fogDim);
          m.position.set(x * TILE, 0.18, y * TILE);
          this.root.add(m);
          this.fogMeshes.push(m);
        }
      }
    }
  }
}
