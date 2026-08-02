import * as THREE from 'three';

/** Seeded LCG for deterministic procedural textures. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function canvasTex(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number, rng: () => number) => void,
  seed = 1,
  repeat = 4,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size, makeRng(seed));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** PCB solder mask + copper traces + vias. */
function drawPcb(ctx: CanvasRenderingContext2D, size: number, rng: () => number) {
  // Deep FR4 / solder mask green
  ctx.fillStyle = '#0a3d28';
  ctx.fillRect(0, 0, size, size);

  // Subtle weave / fiber noise
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 14;
    d[i] = Math.max(0, Math.min(255, (d[i] ?? 0) + n * 0.4));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] ?? 0) + n));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] ?? 0) + n * 0.5));
  }
  ctx.putImageData(img, 0, 0);

  // Copper traces
  ctx.strokeStyle = '#b87333';
  ctx.lineWidth = 2;
  ctx.lineCap = 'square';
  for (let i = 0; i < 48; i++) {
    let x = (rng() * size) | 0;
    let y = (rng() * size) | 0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 2 + ((rng() * 5) | 0);
    for (let s = 0; s < segs; s++) {
      if (rng() > 0.5) x = Math.max(0, Math.min(size, x + (rng() > 0.5 ? 1 : -1) * (8 + rng() * 40)));
      else y = Math.max(0, Math.min(size, y + (rng() > 0.5 ? 1 : -1) * (8 + rng() * 40)));
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Vias
  for (let i = 0; i < 90; i++) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.fillStyle = '#c9a05a';
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + rng() * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1208';
    ctx.beginPath();
    ctx.arc(x, y, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Silkscreen labels (abstract)
  ctx.fillStyle = 'rgba(230, 235, 240, 0.35)';
  ctx.font = '10px monospace';
  for (let i = 0; i < 12; i++) {
    ctx.fillText(
      ['U12', 'C88', 'R3', 'JTAG', 'GND', 'VCC', 'CLK', 'IO'][(rng() * 8) | 0]!,
      rng() * (size - 30),
      rng() * size,
    );
  }
}

function drawPcbRough(ctx: CanvasRenderingContext2D, size: number, rng: () => number) {
  const img = new ImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Mostly matte solder mask, smoother on copper-ish areas
      let r = 170 + rng() * 40;
      if (((x * 3 + y * 7) % 23) < 2) r = 90;
      d[i] = d[i + 1] = d[i + 2] = r;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Copper pour / pad islands */
function drawCopper(ctx: CanvasRenderingContext2D, size: number, rng: () => number) {
  ctx.fillStyle = '#8a4f1f';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 30; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const w = 10 + rng() * 40;
    const h = 8 + rng() * 30;
    ctx.fillStyle = rng() > 0.4 ? '#c47a3a' : '#6b3a12';
    ctx.fillRect(x, y, w, h);
  }
  // Pad grid
  ctx.fillStyle = '#d4a05a';
  for (let y = 8; y < size; y += 16) {
    for (let x = 8; x < size; x += 16) {
      if (rng() > 0.55) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** IC package top — epoxy black with pin1 mark + laser etch */
function drawIcTop(ctx: CanvasRenderingContext2D, size: number, rng: () => number) {
  ctx.fillStyle = '#12141a';
  ctx.fillRect(0, 0, size, size);
  // Micro texture
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = rng() * 18;
    d[i] = d[i + 1] = d[i + 2] = 12 + n;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Pin 1 circle
  ctx.fillStyle = '#e8ecef';
  ctx.beginPath();
  ctx.arc(size * 0.18, size * 0.18, size * 0.06, 0, Math.PI * 2);
  ctx.fill();
  // Text
  ctx.fillStyle = 'rgba(200,210,220,0.55)';
  ctx.font = `${Math.max(10, size / 10)}px monospace`;
  ctx.fillText('AEGIS', size * 0.25, size * 0.55);
  ctx.font = `${Math.max(8, size / 14)}px monospace`;
  ctx.fillText(`X${(rng() * 900 + 100) | 0}`, size * 0.28, size * 0.72);
}

/** Shared PBR materials — motherboard / circuit board aesthetic. */
export function createMaterials() {
  const pcbMap = canvasTex(512, drawPcb, 42, 8);
  const pcbRough = canvasTex(256, drawPcbRough, 43, 8);
  pcbRough.colorSpace = THREE.NoColorSpace;

  const copperMap = canvasTex(256, drawCopper, 77, 4);
  const copperRough = canvasTex(
    128,
    (ctx, size, rng) => {
      const img = new ImageData(size, size);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i + 1] = d[i + 2] = 40 + rng() * 50;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    },
    78,
    4,
  );
  copperRough.colorSpace = THREE.NoColorSpace;

  const icMap = canvasTex(128, drawIcTop, 9, 1);

  const ground = new THREE.MeshStandardMaterial({
    map: pcbMap,
    roughnessMap: pcbRough,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.22,
  });

  const groundWet = new THREE.MeshStandardMaterial({
    map: copperMap,
    roughnessMap: copperRough,
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.92,
  });

  // IC epoxy packages (structures)
  const concrete = new THREE.MeshStandardMaterial({
    map: icMap,
    color: 0x9aa0aa,
    roughness: 0.55,
    metalness: 0.15,
  });

  const concreteDark = new THREE.MeshStandardMaterial({
    map: icMap,
    color: 0x6a7080,
    roughness: 0.5,
    metalness: 0.2,
  });

  const metal = new THREE.MeshStandardMaterial({
    color: 0xc0c8d0,
    roughness: 0.28,
    metalness: 0.92,
  });

  const metalDark = new THREE.MeshStandardMaterial({
    color: 0x2a3038,
    roughness: 0.35,
    metalness: 0.85,
  });

  const metalEdge = new THREE.MeshStandardMaterial({
    color: 0xd4af6a,
    roughness: 0.32,
    metalness: 0.95,
  });

  // Ceramic capacitor (yellow/tan)
  const crate = new THREE.MeshStandardMaterial({
    color: 0xc4a35a,
    roughness: 0.45,
    metalness: 0.08,
  });

  // Heatsink / aluminum barrier
  const barrier = new THREE.MeshStandardMaterial({
    color: 0x8a949e,
    roughness: 0.35,
    metalness: 0.88,
  });

  // Resistor body (blue)
  const sandbag = new THREE.MeshStandardMaterial({
    color: 0x2a4a7a,
    roughness: 0.55,
    metalness: 0.12,
  });

  // Connector / black plastic housing
  const vehicle = new THREE.MeshStandardMaterial({
    color: 0x1a1c22,
    roughness: 0.4,
    metalness: 0.25,
  });

  const emissiveCyan = new THREE.MeshStandardMaterial({
    color: 0x041820,
    emissive: 0x00e5ff,
    emissiveIntensity: 1.3,
    roughness: 0.25,
    metalness: 0.4,
  });

  const emissiveOrange = new THREE.MeshStandardMaterial({
    color: 0x201004,
    emissive: 0xff6a00,
    emissiveIntensity: 1.35,
    roughness: 0.25,
    metalness: 0.3,
  });

  // LED dies as "windows"
  const windowLit = new THREE.MeshStandardMaterial({
    color: 0x041008,
    emissive: 0x00ff88,
    emissiveIntensity: 1.8,
    roughness: 0.2,
    metalness: 0.2,
  });

  const windowDim = new THREE.MeshStandardMaterial({
    color: 0x080c14,
    emissive: 0x2080ff,
    emissiveIntensity: 0.55,
    roughness: 0.25,
    metalness: 0.35,
  });

  const windowDark = new THREE.MeshStandardMaterial({
    color: 0x06080c,
    emissive: 0x102018,
    emissiveIntensity: 0.12,
    roughness: 0.3,
    metalness: 0.4,
  });

  const fogMat = new THREE.MeshBasicMaterial({
    color: 0x020805,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });

  const fogDim = new THREE.MeshBasicMaterial({
    color: 0x041510,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  });

  const blueMove = new THREE.MeshBasicMaterial({
    color: 0x00e8c8,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });

  const yellowMove = new THREE.MeshBasicMaterial({
    color: 0xffb020,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  });

  const selectRing = new THREE.MeshBasicMaterial({
    color: 0x00ffc8,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });

  const hoverTile = new THREE.MeshBasicMaterial({
    color: 0xb87333,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });

  const pathLine = new THREE.LineBasicMaterial({
    color: 0x00ffaa,
    transparent: true,
    opacity: 0.95,
  });

  // Gold contact / extract pad
  const extract = new THREE.MeshStandardMaterial({
    color: 0x3a2a08,
    emissive: 0xffcc44,
    emissiveIntensity: 0.65,
    roughness: 0.3,
    metalness: 0.85,
  });

  return {
    ground,
    groundWet,
    concrete,
    concreteDark,
    metal,
    metalDark,
    metalEdge,
    crate,
    barrier,
    sandbag,
    vehicle,
    emissiveCyan,
    emissiveOrange,
    windowLit,
    windowDim,
    windowDark,
    fogMat,
    fogDim,
    blueMove,
    yellowMove,
    selectRing,
    hoverTile,
    pathLine,
    extract,
  };
}

export type Materials = ReturnType<typeof createMaterials>;
