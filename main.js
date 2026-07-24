// main.js — Three.js ocean + carousel of project cards + scroll-driven panel transitions
// vanilla ES module, loaded via <script type="module" src="main.js">

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ============================================================
   Palette — three time-of-day presets, lerped by scroll progress
   ============================================================ */
const PALETTE = [
  // morning
  { top: new THREE.Color('#7fb6e8'), horizon: new THREE.Color('#cfe5f6'), fog: new THREE.Color('#bcd8ef') },
  // afternoon
  { top: new THREE.Color('#4f7fb0'), horizon: new THREE.Color('#e9c895'), fog: new THREE.Color('#d8c8a8') },
  // night
  { top: new THREE.Color('#0b1a3a'), horizon: new THREE.Color('#1f3a6b'), fog: new THREE.Color('#0b1a3a') },
];

const lerp = (a, b, t) => a + (b - a) * t;
const lerpColor = (out, a, b, t) => { out.r = lerp(a.r, b.r, t); out.g = lerp(a.g, b.g, t); out.b = lerp(a.b, b.b, t); };

/* ============================================================
   Projects — single large card carousel on the right side of the screen
   ============================================================ */
const PROJECTS = [
  { id: 'minecraft', name: 'Mini Minecraft',      subtitle: 'Voxel terrain engine',   tags: ['C++', 'OpenGL'], url: 'minecraft.html',      thumb: 'images/minecraft_final.JPG' },
  { id: 'mpm',       name: 'MPM Material Sim',    subtitle: 'Snow, sand, jelly',       tags: ['C++', 'Houdini'], url: 'mpm.html',            thumb: 'images/mpm.jpg' },
  { id: 'woz',       name: 'Wrath of Zeus',       subtitle: '3v1 multiplayer arena',   tags: ['C++', 'OpenGL'],  url: 'wrath_of_zeus.html',  thumb: 'images/wrathofzeus.jpg' },
  { id: 'flock',     name: 'Flocking Simulation', subtitle: 'GPU boids + behaviors',   tags: ['CUDA', 'C++'],    url: 'flock_simulation.html', thumb: 'images/boid.jpg' },
  { id: 'solarwind', name: 'Solar Wind',          subtitle: 'UE5 space weather viz',   tags: ['UE5', 'VDB'],     url: 'solarwind.html',      thumb: 'images/cosmic.jpg' },
  { id: 'nirvana',   name: 'Nirvana',             subtitle: 'Roguelike platformer',    tags: ['Godot'],          url: 'nirvana.html',        thumb: 'images/nirvana.jpg' },
];

/* ============================================================
   Scene
   ============================================================ */
const canvas = document.getElementById('scene-canvas');
const orbFlash = document.getElementById('orb-flash');

let renderer, scene, camera, ocean, sky, envTexture;
let cards = [];          // 6 card groups, only one is "active" (front+center)
let activeCard = 0;      // index of currently centered card
let clock = new THREE.Clock();
let scrollProgress = 0;
let targetProgress = 0;
let activePanel = 0;
let expanding = null;
let lastScrollTime = 0;
let useTransmissiveMaterial = true;
const isMobile = window.matchMedia('(max-width: 768px)').matches;

/* ---------- init ---------- */
function init() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
  } catch (e) {
    console.warn('WebGL unavailable, falling back to no-WebGL layout', e);
    document.body.classList.add('no-webgl');
    document.body.classList.remove('scene-page');
    canvas.remove();
    initNoWebGLBehavior();
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // environment for transmissive orbs
  const pmrem = new THREE.PMREMGenerator(renderer);
  envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE[0].horizon, 18, 80);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 4, 12);

  buildSky();
  // buildSun();
  buildOcean();
  buildOrbs();

  // feature-detect glass material
  if (!('transmission' in THREE.MeshPhysicalMaterial.prototype) || isMobile) {
    useTransmissiveMaterial = false;
    rebuildOrbMaterials();
  }

  setupEvents();
  animate();
}

/* ---------- sky dome (gradient only — no sun) ---------- */
function buildSky() {
  const geom = new THREE.SphereGeometry(250, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop:     { value: PALETTE[0].top.clone() },
      uHorizon: { value: PALETTE[0].horizon.clone() },
      uTime:    { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vWorldDir;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform float uTime;

      // hash-based stars (visible at night)
      float hash(vec3 p) {
        p = fract(p * vec3(443.8975, 397.2973, 491.1871));
        p += dot(p, p.yxz + 19.27);
        return fract((p.x + p.y) * p.z);
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, -0.05, 1.0);
        // smooth gradient: horizon → top
        float t = pow(h, 0.55);
        vec3 col = mix(uHorizon, uTop, t);

        // stars: visible when looking up (h > 0.3); modulate by top-color brightness (only at night)
        float nightness = 1.0 - smoothstep(0.05, 0.45, length(uTop - vec3(0.498, 0.714, 0.910)) * 1.4);
        if (h > 0.3 && nightness > 0.2) {
          vec3 starPos = floor(dir * 220.0);
          float s = hash(starPos);
          float twinkle = 0.6 + 0.4 * sin(uTime * 1.5 + s * 30.0);
          float starMask = step(0.997, s) * twinkle;
          col += vec3(0.85, 0.92, 1.0) * starMask * nightness * 0.9;
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  sky = new THREE.Mesh(geom, mat);
  sky.frustumCulled = false;
  scene.add(sky);
}

// /* ---------- virtual sun (a glowing disc on the dome) ---------- */
// function buildSun() {
//   const geom = new THREE.CircleGeometry(2.0, 32);
//   const mat = new THREE.MeshBasicMaterial({
//     color: 0xfff4d8,
//     transparent: true,
//     opacity: 0.85,
//     fog: false,
//     depthWrite: false,
//   });
//   sun = new THREE.Mesh(geom, mat);
//   sun.position.set(40, 30, -160);
//   sun.lookAt(0, 0, 0);
//   scene.add(sun);
// }

/* ---------- ocean surface ---------- */
function buildOcean() {
  const seg = isMobile ? 96 : 192;
  const geom = new THREE.PlaneGeometry(220, 220, seg, seg);
  geom.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      uTime:       { value: 0 },
      uTop:        { value: PALETTE[0].top.clone() },
      uHorizon:    { value: PALETTE[0].horizon.clone() },
      fogColor:    { value: scene.fog.color },
      fogNear:     { value: scene.fog.near },
      fogFar:      { value: scene.fog.far },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vNormal;

      // cheap noise from sin/cos
      float wave(vec2 p, float t, vec2 dir, float amp, float freq, float speed) {
        return sin(dot(p, dir) * freq + t * speed) * amp;
      }

      vec3 surface(vec2 p, float t) {
        float h = 0.0;
        h += wave(p, t, normalize(vec2( 1.0, 0.4)), 0.35, 0.45, 1.2);
        h += wave(p, t, normalize(vec2(-0.7, 0.9)), 0.22, 0.85, 1.6);
        h += wave(p, t, normalize(vec2( 0.2,-1.0)), 0.18, 1.35, 1.1);
        h += wave(p, t, normalize(vec2(-0.4,-0.3)), 0.10, 2.10, 0.7);
        return vec3(p.x, h, p.y);
      }

      void main() {
        vec3 p = surface(position.xz, uTime);
        // estimate normal via partial derivatives (cheap)
        float e = 0.15;
        vec3 px = surface(position.xz + vec2(e, 0.0), uTime);
        vec3 pz = surface(position.xz + vec2(0.0, e), uTime);
        vNormal = normalize(cross(pz - p, px - p));
        vWorldPos = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      uniform float uTime;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);

        // base water color — interpolate toward horizon as we look further out
        vec3 base = mix(uTop, uHorizon, 0.6);

        // soft top-down highlight (no specific sun position — fresnel-driven glint)
        float glint = pow(fres, 2.0) * 0.4;

        // whitecap at wave crests (when N.y is near 1)
        float crest = smoothstep(0.94, 0.99, N.y);

        vec3 col = base;
        col = mix(col, uHorizon, fres * 0.7);
        col += vec3(1.0) * glint;
        col = mix(col, vec3(1.0), crest * 0.35);

        // distance fog
        float dist = length(cameraPosition - vWorldPos);
        float fogFactor = smoothstep(fogNear, fogFar, dist);
        col = mix(col, fogColor, fogFactor);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  ocean = new THREE.Mesh(geom, mat);
  ocean.position.y = 0;
  scene.add(ocean);
}

/* ---------- project cards (carousel — one active, others parked off to sides) ---------- */
async function buildOrbs() {
  const loader = new THREE.TextureLoader();

  for (let i = 0; i < PROJECTS.length; i++) {
    const p = PROJECTS[i];

    // load texture
    let texture = null;
    try {
      texture = await loader.loadAsync(p.thumb);
      texture.colorSpace = THREE.SRGBColorSpace;
    } catch (e) {
      console.warn('Failed to load thumb', p.thumb, e);
    }

    const group = new THREE.Group();

    // Card: a large rectangular card on the right side of the camera view.
    // Card size in world units (roughly 2.6 wide × 3.5 tall — large "body").
    const cardW = 2.6, cardH = 3.5;

    // glass card body (transmissive plane)
    const cardGeom = new THREE.PlaneGeometry(cardW, cardH, 1, 1);
    const cardMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.0,
      roughness: 0.12,
      transmission: useTransmissiveMaterial ? 0.92 : 0.0,
      thickness: 0.4,
      ior: 1.4,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      envMap: envTexture,
      envMapIntensity: 1.0,
      transparent: !useTransmissiveMaterial,
      opacity: useTransmissiveMaterial ? 1.0 : 0.85,
      side: THREE.DoubleSide,
    });
    const card = new THREE.Mesh(cardGeom, cardMat);
    group.add(card);

    // thumbnail as a sprite floating inside the card, anchored top
    if (texture) {
      const imgW = cardW * 0.88;
      const imgH = imgW * (9 / 16);
      const thumbGeom = new THREE.PlaneGeometry(imgW, imgH);
      const thumbMat = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.55,
        metalness: 0.0,
        envMap: envTexture,
        envMapIntensity: 0.5,
      });
      const thumb = new THREE.Mesh(thumbGeom, thumbMat);
      thumb.position.set(0, cardH * 0.18, 0.05);  // top portion of card
      group.add(thumb);
      group.userData.thumb = thumb;
    }

    // name + subtitle + tags as a canvas texture floating below the thumbnail
    const label = makeCardLabel(p);
    label.position.set(0, -cardH * 0.35, 0.05);
    label.scale.set(cardW * 0.95, cardH * 0.45, 1);
    group.add(label);
    group.userData.label = label;

    // invisible click hit-box covering the full card
    const hitGeom = new THREE.PlaneGeometry(cardW * 1.05, cardH * 1.05);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    const hit = new THREE.Mesh(hitGeom, hitMat);
    hit.position.z = 0.06;
    hit.userData.isHit = true;
    group.add(hit);

    group.userData = Object.assign(group.userData, {
      id: p.id, url: p.url, name: p.name, project: p,
      index: i, baseScale: 1.0, baseY: 0,
    });

    scene.add(group);
    cards.push({ group, card, hit, label, project: p, index: i });
  }
  // place each card along an arc on the right side; only index === activeCard is centered
  layoutCards(0);
}

function layoutCards(activeIdx) {
  // Cards live on the right side of the camera frame.
  // Active card: x ≈ 3.2 (right of center), facing camera.
  // Inactive cards: stacked behind / faded along z-axis.
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const offset = i - activeIdx;
    const absOffset = Math.abs(offset);

    // Position: active at front-right, others stack backward along z
    const targetX = 3.2 + absOffset * 0.6 * Math.sign(offset || 1);
    const targetY = 0.6 + Math.sin(absOffset * 0.6) * 0.4 - absOffset * 0.15;
    const targetZ = -2 - absOffset * 1.2;
    const targetRotY = -0.18 - absOffset * 0.15 * Math.sign(offset || 1);
    const targetScale = absOffset === 0 ? 1.0 : Math.max(0.6, 1.0 - absOffset * 0.12);

    c.group.userData.targetX = targetX;
    c.group.userData.targetY = targetY;
    c.group.userData.targetZ = targetZ;
    c.group.userData.targetRotY = targetRotY;
    c.group.userData.targetScale = targetScale;
  }
}

function rebuildOrbMaterials() {
  for (const o of cards) {
    o.card.material.dispose();
    o.card.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.1,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
      envMap: envTexture,
      envMapIntensity: 1.0,
    });
  }
}

/* ---------- canvas-rendered text overlay for each card ---------- */
function makeCardLabel(p) {
  const canvas = document.createElement('canvas');
  const W = 1024, H = 512;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // name
  ctx.font = '700 76px Poppins, system-ui, sans-serif';
  ctx.fillStyle = '#1e355a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(p.name, 32, 40);

  // subtitle
  ctx.font = '400 40px Poppins, system-ui, sans-serif';
  ctx.fillStyle = '#5a6d85';
  ctx.fillText(p.subtitle || '', 32, 138);

  // tags as small pills
  let tx = 32;
  const ty = 220;
  ctx.font = '500 30px Poppins, system-ui, sans-serif';
  for (const tag of (p.tags || [])) {
    const tw = ctx.measureText(tag).width;
    const padX = 24, padY = 12;
    const w = tw + padX * 2;
    const h = 56;
    // pill bg
    ctx.fillStyle = 'rgba(20, 55, 102, 0.10)';
    roundRect(ctx, tx, ty, w, h, h / 2);
    ctx.fill();
    // pill border
    ctx.strokeStyle = 'rgba(20, 55, 102, 0.35)';
    ctx.lineWidth = 2;
    roundRect(ctx, tx, ty, w, h, h / 2);
    ctx.stroke();
    // pill text
    ctx.fillStyle = '#1e355a';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, tx + padX, ty + h / 2 + 1);
    tx += w + 12;
    ctx.textBaseline = 'top';
  }

  // "click to view →" hint
  ctx.font = '400 28px Poppins, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(20, 55, 102, 0.55)';
  ctx.fillText('click to view project →', 32, 340);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ============================================================
   Camera presets
   ============================================================ */
const CAMERA_PRESETS = [
  // morning
  { pos: new THREE.Vector3(0, 4.2, 12),   look: new THREE.Vector3(0, 2.2, 0) },
  // afternoon
  { pos: new THREE.Vector3(0, 2.6, 7),    look: new THREE.Vector3(0, 1.6, -3) },
  // night
  { pos: new THREE.Vector3(0, 1.6, 6),    look: new THREE.Vector3(0, 4.5, -4) },
];

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
function updateCamera() {
  const t = scrollProgress;
  // split into two segments: 0..0.5 (morning→afternoon) and 0.5..1 (afternoon→night)
  let i0, i1, localT;
  if (t < 0.5) { i0 = 0; i1 = 1; localT = t / 0.5; }
  else         { i0 = 1; i1 = 2; localT = (t - 0.5) / 0.5; }
  localT = easeInOut(localT);
  tmpPos.lerpVectors(CAMERA_PRESETS[i0].pos, CAMERA_PRESETS[i1].pos, localT);
  tmpLook.lerpVectors(CAMERA_PRESETS[i0].look, CAMERA_PRESETS[i1].look, localT);
  camera.position.copy(tmpPos);
  camera.lookAt(tmpLook);
}

function easeInOut(x) { return x * x * (3 - 2 * x); }

/* ============================================================
   Palette update — lerp three presets
   ============================================================ */
const tmpC = new THREE.Color();
function updatePalette() {
  const t = scrollProgress;
  let i0, i1, localT;
  if (t < 0.5) { i0 = 0; i1 = 1; localT = t / 0.5; }
  else         { i0 = 1; i1 = 2; localT = (t - 0.5) / 0.5; }
  localT = easeInOut(localT);

  // sky
  lerpColor(sky.material.uniforms.uTop.value,     PALETTE[i0].top,     PALETTE[i1].top,     localT);
  lerpColor(sky.material.uniforms.uHorizon.value, PALETTE[i0].horizon, PALETTE[i1].horizon, localT);
  sky.material.uniforms.uTime.value = clock.elapsedTime;

  // ocean
  lerpColor(ocean.material.uniforms.uTop.value,     PALETTE[i0].top,     PALETTE[i1].top,     localT);
  lerpColor(ocean.material.uniforms.uHorizon.value, PALETTE[i0].horizon, PALETTE[i1].horizon, localT);
  ocean.material.uniforms.uTime.value = clock.elapsedTime;

  // fog + clear color
  lerpColor(tmpC, PALETTE[i0].fog, PALETTE[i1].fog, localT);
  scene.fog.color.copy(tmpC);
  ocean.material.uniforms.fogColor.value.copy(tmpC);
  renderer.setClearColor(tmpC);
}

/* ============================================================
   Panel activation — toggle .is-active on the visible panel
   ============================================================ */
const panels = Array.from(document.querySelectorAll('.panel'));
function updatePanels() {
  const t = scrollProgress;
  let idx = 0;
  if (t > 0.25 && t < 0.75) idx = 1;
  else if (t >= 0.75) idx = 2;
  if (idx !== activePanel) {
    activePanel = idx;
    panels.forEach((p, i) => p.classList.toggle('is-active', i === idx));
    // expose to CSS so carousel controls only show during Panel 1
    document.body.setAttribute('data-active-panel', String(idx));
  }
}

/* ============================================================
   Progress rail + anchor scrolling
   ============================================================ */
const progressFill = document.getElementById('progress-rail-fill');
function updateProgressRail() {
  if (progressFill) progressFill.style.height = (scrollProgress * 100).toFixed(2) + '%';
}

document.querySelectorAll('[data-scroll]').forEach(el => {
  el.addEventListener('click', e => {
    const target = parseFloat(el.getAttribute('data-scroll'));
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: target * max, behavior: 'smooth' });
    e.preventDefault();
  });
});

/* ============================================================
   Scroll → progress
   ============================================================ */
let scrollPending = false;
function onScroll() {
  lastScrollTime = performance.now();
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    targetProgress = Math.min(1, Math.max(0, window.scrollY / max));
    scrollPending = false;
  });
}

/* ============================================================
   Click on a card → expand + navigate
   ============================================================ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function getCardScreenRadius(card) {
  const v = new THREE.Vector3().setFromMatrixPosition(card.group.matrixWorld);
  v.project(camera);
  // use card half-width in world (1.3) projected to screen
  const halfW = 1.3;
  const edge = new THREE.Vector3(v.x + halfW / (camera.aspect * Math.tan(camera.fov * Math.PI / 360)), v.y, v.z);
  edge.project(camera);
  return Math.abs((edge.x - v.x) * window.innerWidth * 0.5);
}

function findCardAtPointer(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cards.map(c => c.hit), false);
  if (hits.length === 0) return null;
  const hit = hits[0].object;
  return cards.find(c => c.hit === hit) || null;
}

function startExpand(card) {
  if (expanding) return;
  // only expand if the clicked card is the currently-active one
  if (card.index !== activeCard) {
    // clicking a parked card: switch to it instead
    goToCard(card.index);
    return;
  }
  const screenHalfW = getCardScreenRadius(card);
  const targetScreenHalfW = Math.max(window.innerWidth, window.innerHeight) * 0.6;
  const targetScale = targetScreenHalfW / Math.max(1, screenHalfW);

  orbFlash.style.background = 'linear-gradient(135deg, #7fb6e8 0%, #cfe5f6 50%, #ffffff 100%)';
  orbFlash.classList.add('is-active');

  expanding = {
    card,
    t0: performance.now(),
    duration: 600,
    fromScale: card.group.scale.x,
    targetScale,
    url: card.project.url,
  };
  document.body.style.cursor = 'wait';
}

function updateExpand(now) {
  if (!expanding) return;
  const t = Math.min(1, (now - expanding.t0) / expanding.duration);
  const eased = easeInOut(t);
  const s = lerp(expanding.fromScale, expanding.targetScale, eased);
  expanding.card.group.scale.setScalar(s);

  if (t >= 1) {
    const url = expanding.url;
    expanding = null;
    window.location.href = url;
  }
}

canvas.addEventListener('pointerdown', e => {
  if (expanding) return;
  const card = findCardAtPointer(e.clientX, e.clientY);
  if (card) {
    e.preventDefault();
    startExpand(card);
  }
});

canvas.addEventListener('pointermove', e => {
  if (expanding) return;
  const card = findCardAtPointer(e.clientX, e.clientY);
  canvas.style.cursor = card ? 'pointer' : '';
});

/* ============================================================
   Carousel: arrow buttons + drag/swipe
   ============================================================ */
let cardT = 0;          // smoothly interpolates between cards
let cardTarget = 0;     // target index

function goToCard(idx) {
  cardTarget = ((idx % cards.length) + cards.length) % cards.length;
  document.querySelectorAll('#carousel-dots button').forEach((b, i) => {
    b.classList.toggle('is-active', i === cardTarget);
  });
}

document.querySelectorAll('[data-carousel]').forEach(btn => {
  btn.addEventListener('click', () => {
    const dir = btn.getAttribute('data-carousel');
    goToCard(activeCard + (dir === 'next' ? 1 : -1));
  });
});

document.querySelectorAll('#carousel-dots button').forEach((btn, i) => {
  btn.addEventListener('click', () => goToCard(i));
});

// swipe / drag detection on the canvas
let dragStartX = 0, dragLastX = 0, dragging = false, dragDist = 0;
canvas.addEventListener('pointerdown', e => {
  // begin drag tracking; if pointermove travels > 40px horizontally, treat as swipe
  dragStartX = e.clientX;
  dragLastX = e.clientX;
  dragging = true;
  dragDist = 0;
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  dragDist = Math.abs(e.clientX - dragStartX);
  dragLastX = e.clientX;
});
canvas.addEventListener('pointerup', e => {
  if (!dragging) return;
  dragging = false;
  if (dragDist < 40) return; // tap, not swipe — let click handler proceed
  const dx = e.clientX - dragStartX;
  if (dx < 0) goToCard(activeCard + 1);
  else goToCard(activeCard - 1);
});
canvas.addEventListener('pointercancel', () => { dragging = false; });

/* ============================================================
   Resize
   ============================================================ */
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', onResize);

/* ============================================================
   Events
   ============================================================ */
function setupEvents() {
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ============================================================
   Animate loop
   ============================================================ */
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const elapsed = clock.getElapsedTime();

  // smoothly approach target progress
  scrollProgress += (targetProgress - scrollProgress) * 0.12;
  cardTarget = ((cardTarget % cards.length) + cards.length) % cards.length;

  // smoothly interpolate active card index → layouts
  if (activeCard !== cardTarget) {
    const prev = activeCard;
    activeCard = cardTarget;
    layoutCards(activeCard);
    // tiny flag so we can detect the change once
    activeCardJustChanged = { prev, at: performance.now() };
  }

  // animate each card toward its layout target
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const ud = c.group.userData;
    const lerpAmount = expanding && expanding.card === c ? 1 : 0.12;
    c.group.position.x = lerp(c.group.position.x, ud.targetX, lerpAmount);
    c.group.position.y = lerp(c.group.position.y, ud.targetY, lerpAmount);
    c.group.position.z = lerp(c.group.position.z, ud.targetZ, lerpAmount);
    c.group.rotation.y = lerp(c.group.rotation.y, ud.targetRotY, lerpAmount);
    // gentle floating motion
    c.group.position.y += Math.sin(elapsed * 0.5 + i * 0.7) * 0.04;
    // scale — smoothly approach target, but the active expanding card drives its own scale
    if (!(expanding && expanding.card === c)) {
      const ts = lerp(c.group.scale.x, ud.targetScale, 0.12);
      c.group.scale.setScalar(ts);
    }
  }

  updateCamera();
  updatePalette();
  updatePanels();
  updateProgressRail();
  updateExpand(now);

  renderer.render(scene, camera);
}

/* ============================================================
   No-WebGL fallback: scroll-to-anchor for the panels via JS
   ============================================================ */
function initNoWebGLBehavior() {
  // panels are now flow content; nothing else to do — CSS handles styling
  // but ensure the rail click + scroll mapping still work
  document.querySelectorAll('[data-scroll]').forEach(el => {
    el.addEventListener('click', e => {
      const target = parseFloat(el.getAttribute('data-scroll'));
      const totalH = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: target * totalH, behavior: 'smooth' });
      e.preventDefault();
    });
  });
}

/* ============================================================
   Boot
   ============================================================ */
// Mark this page as the scene page so the 300vh CSS rule applies.
document.body.classList.add('scene-page');
init();