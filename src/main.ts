import { PlanetariumEngine, EngineEvent } from '@tracing-the-sky/engine';
import * as THREE from 'three';
import type {
  ClockUpdatePayload,
  ClickEventData,
  ConstellationSearchResult,
  ObserverLocation,
  SolarSystemObjectType,
} from '@tracing-the-sky/engine';
import './style.css';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const pad = (n: number) => String(n).padStart(2, '0');
const formatDateTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const formatHM = (d: Date | null) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—');
const toInputValue = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// ---------------------------------------------------------------------------
// Observer presets
// ---------------------------------------------------------------------------
interface ObserverPreset {
  label: string;
  location: ObserverLocation;
}

const PRESETS: Record<string, ObserverPreset> = Object.fromEntries(
  Array.from($('observer-preset').querySelectorAll('option')).map((opt) => {
    const [coords, label] = opt.value.split('|');
    const [longitude, latitude] = coords.split(',').map(Number);
    return [opt.value, { label, location: { longitude, latitude, elevation: 0 } }];
  }),
);

// ---------------------------------------------------------------------------
// Engine bootstrap
// ---------------------------------------------------------------------------
const canvas = $<HTMLCanvasElement>('starmap-canvas');
const initialPreset = PRESETS['121.4737,31.2304|上海'];

const engine = new PlanetariumEngine({
  canvas,
  observer: initialPreset.location,
  camera: { yaw: 0, pitch: 25, height: 1.8, fov: 65 },
  scene: {
    showCardinalLabels: true,
    showHorizonObjects: true,
    showMilkyWay: true,
  },
  clock: { initialTime: new Date() },
});

// ---------------------------------------------------------------------------
// Clock / time controls  (single render path => works while paused too)
// ---------------------------------------------------------------------------
const SPEEDS: Array<{ label: string; value: number }> = [
  { label: '1×', value: 1 },
  { label: '60×', value: 60 },
  { label: '1时/秒', value: 3600 },
  { label: '1天/秒', value: 86400 },
];

const playBtn = $<HTMLButtonElement>('btn-play');
const nowBtn = $<HTMLButtonElement>('btn-now');
const speedsEl = $('speeds');
const simTimeEl = $('sim-time');
const observerLabelEl = $('observer-label');
const observerCoordsEl = $('observer-coords');
const readoutEl = $('readout');
const timeInput = $<HTMLInputElement>('time-input');
const speedButtons = new Map<number, HTMLButtonElement>();

for (const { label, value } of SPEEDS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', () => engine.clock.setSpeed(value));
  speedsEl.appendChild(btn);
  speedButtons.set(value, btn);
}

let knownRiseSetDateKey = '';

function applyClockState(date: Date, speed: number, isPlaying: boolean): void {
  simTimeEl.textContent = formatDateTime(date);
  playBtn.textContent = isPlaying ? '⏸' : '▶';
  for (const [value, btn] of speedButtons) {
    btn.classList.toggle('active', value === speed);
  }
  if (document.activeElement !== timeInput) {
    timeInput.value = toInputValue(date);
  }
  maybeRefreshRiseSet();
}

function refreshObserverDisplay(): void {
  const obs = engine.observer.get();
  const preset = PRESETS[$<HTMLSelectElement>('observer-preset').value];
  observerLabelEl.textContent = preset ? preset.label : '自定义';
  const lat = `${Math.abs(obs.latitude).toFixed(2)}°${obs.latitude >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(obs.longitude).toFixed(2)}°${obs.longitude >= 0 ? 'E' : 'W'}`;
  observerCoordsEl.textContent = `${lat} ${lng}`;
}

playBtn.addEventListener('click', () => engine.clock.toggle());
nowBtn.addEventListener('click', () => engine.clock.set(new Date()));
timeInput.addEventListener('change', () => {
  const value = new Date(timeInput.value);
  if (!Number.isNaN(value.getTime())) engine.clock.set(value);
});

for (const btn of $('bottombar').querySelectorAll<HTMLButtonElement>('[data-step]')) {
  const step = Number(btn.dataset.step);
  btn.addEventListener('click', () => engine.clock.addMilliseconds(step));
}

$<HTMLSelectElement>('observer-preset').addEventListener('change', (event) => {
  const preset = PRESETS[(event.target as HTMLSelectElement).value];
  if (preset) engine.observer.update(preset.location);
});

// ---------------------------------------------------------------------------
// Display settings
// ---------------------------------------------------------------------------
const milkyWayCheck = $<HTMLInputElement>('opt-milkyway');
const cardinalCheck = $<HTMLInputElement>('opt-cardinal');
const azimuthCheck = $<HTMLInputElement>('opt-azimuth');
const altitudeCheck = $<HTMLInputElement>('opt-altitude');
const horizonCheck = $<HTMLInputElement>('opt-horizon');
const atmosphereCheck = $<HTMLInputElement>('opt-atmosphere');
const eclipticCheck = $<HTMLInputElement>('opt-ecliptic');

let skyDome: { visible: boolean } | null = null;
let altitudeBelowGroup: any | null = null;
let azimuthBelowGroup: any | null = null;
let eclipticGroup: any | null = null;

function applySceneToggles(): void {
  engine.scene.update({
    showMilkyWay: milkyWayCheck.checked,
    showCardinalLabels: cardinalCheck.checked,
    showAzimuthLines: azimuthCheck.checked,
    showAltitudeLines: altitudeCheck.checked,
    showHorizonObjects: horizonCheck.checked,
  });
  // The engine only draws the upper hemisphere; fill in the lower half when
  // the ground is hidden so the grid becomes a complete sphere.
  const showBelow = !horizonCheck.checked;
  if (altitudeBelowGroup) altitudeBelowGroup.visible = showBelow && altitudeCheck.checked;
  if (azimuthBelowGroup) azimuthBelowGroup.visible = showBelow && azimuthCheck.checked;
  if (eclipticGroup) eclipticGroup.visible = eclipticCheck.checked;
}

function applyAtmosphere(): void {
  if (skyDome) skyDome.visible = atmosphereCheck.checked;
}

for (const check of [milkyWayCheck, cardinalCheck, azimuthCheck, altitudeCheck, horizonCheck, eclipticCheck]) {
  check.addEventListener('change', applySceneToggles);
}
atmosphereCheck.addEventListener('change', applyAtmosphere);

// ---------------------------------------------------------------------------
// Sky reference grids: below-horizon extension + ecliptic coordinate grid
// ---------------------------------------------------------------------------
const SKY_RADIUS = 500;
const OBLIQUITY = (23.4393 * Math.PI) / 180;

function skyLine(points: any[], material: unknown, closed: boolean): any {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = closed
    ? new THREE.LineLoop(geometry, material)
    : new THREE.Line(geometry, material);
  line.renderOrder = 118;
  line.isPickable = false;
  return line;
}

function renderOrderSafe(group: any): any {
  group.renderOrder = 118;
  group.isPickable = false;
  return group;
}

function buildBelowHorizonGrid(): { altitude: any; azimuth: any } {
  const toXyz = (altDeg: number, azDeg: number) => {
    const a = (altDeg * Math.PI) / 180;
    const z = (azDeg * Math.PI) / 180;
    return new THREE.Vector3(
      SKY_RADIUS * Math.cos(a) * Math.sin(z),
      SKY_RADIUS * Math.sin(a),
      SKY_RADIUS * Math.cos(a) * Math.cos(z),
    );
  };

  const ringMat = new THREE.LineBasicMaterial({
    color: 0xc9c7ff,
    transparent: true,
    opacity: 0.3,
    depthTest: false,
    depthWrite: false,
  });
  const spokeMat = new THREE.LineBasicMaterial({
    color: 0xa8b6ff,
    transparent: true,
    opacity: 0.22,
    depthTest: false,
    depthWrite: false,
  });

  const altitude = renderOrderSafe(new THREE.Group());
  for (let alt = -80; alt <= -10; alt += 10) {
    const pts: any[] = [];
    for (let az = 0; az < 360; az += 5) pts.push(toXyz(alt, az));
    altitude.add(skyLine(pts, ringMat, true));
  }
  const nadir: any[] = [];
  for (let az = 0; az < 360; az += 6) nadir.push(toXyz(-89, az));
  altitude.add(skyLine(nadir, ringMat, true));

  const azimuth = renderOrderSafe(new THREE.Group());
  for (let az = 0; az < 360; az += 10) {
    const pts: any[] = [];
    for (let alt = 0; alt >= -90; alt -= 3) pts.push(toXyz(alt, az));
    azimuth.add(skyLine(pts, spokeMat, false));
  }

  return { altitude, azimuth };
}

function eclipticToLocal(lambdaDeg: number, betaDeg: number): any {
  const l = (lambdaDeg * Math.PI) / 180;
  const b = (betaDeg * Math.PI) / 180;
  const ex = Math.cos(b) * Math.cos(l);
  const ey = Math.cos(b) * Math.sin(l);
  const ez = Math.sin(b);
  const ce = Math.cos(OBLIQUITY);
  const se = Math.sin(OBLIQUITY);
  const qx = ex;
  const qy = ey * ce - ez * se;
  const qz = ey * se + ez * ce;
  // Map to the engine's celestial-sphere convention: x = cosδ·sinα, y = sinδ, z = cosδ·cosα
  return new THREE.Vector3(qy, qz, qx).multiplyScalar(SKY_RADIUS);
}

function buildEclipticGrid(): any {
  const group = renderOrderSafe(new THREE.Group());
  const equatorMat = new THREE.LineBasicMaterial({
    color: 0xffb454,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
    depthWrite: false,
  });
  const faintMat = new THREE.LineBasicMaterial({
    color: 0xb98bff,
    transparent: true,
    opacity: 0.28,
    depthTest: false,
    depthWrite: false,
  });

  const equator: any[] = [];
  for (let l = 0; l < 360; l += 3) equator.push(eclipticToLocal(l, 0));
  group.add(skyLine(equator, equatorMat, true));

  for (const beta of [-60, -30, 30, 60]) {
    const pts: any[] = [];
    for (let l = 0; l <= 360; l += 4) pts.push(eclipticToLocal(l, beta));
    group.add(skyLine(pts, faintMat, true));
  }
  for (let l = 0; l < 360; l += 30) {
    const pts: any[] = [];
    for (let b = -80; b <= 80; b += 4) pts.push(eclipticToLocal(l, b));
    group.add(skyLine(pts, faintMat, false));
  }
  return group;
}

function buildSkyGrids(): void {
  const scene = engine.getContext()?.scene;
  const sphere = scene?.getObjectByName('celestialSphere');
  if (!scene) return;

  const below = buildBelowHorizonGrid();
  scene.add(below.altitude);
  scene.add(below.azimuth);
  altitudeBelowGroup = below.altitude;
  azimuthBelowGroup = below.azimuth;

  if (sphere) {
    eclipticGroup = buildEclipticGrid();
    sphere.add(eclipticGroup);
  }
}

// ---------------------------------------------------------------------------
// Constellation browser + auto focus (whichever constellation is centred)
// ---------------------------------------------------------------------------
const constellationSearch = $<HTMLInputElement>('constellation-search');
const constellationList = $<HTMLUListElement>('constellation-list');
const autoConstellationCheckbox = $<HTMLInputElement>('opt-autoconstellation');

const manualConstellations = new Set<string>();
let focusedConstellation: string | null = null;
let appliedConstellations = new Set<string>();
let autoConstellation = true;
let allConstellations: ConstellationSearchResult[] = [];

function renderConstellations(query = ''): void {
  const q = query.trim().toLowerCase();
  const items = q
    ? allConstellations.filter((c) =>
        `${c.id} ${c.iau} ${c.name} ${c.nativeName ?? ''}`.toLowerCase().includes(q),
      )
    : allConstellations;

  constellationList.replaceChildren(
    ...items.map((c) => {
      const li = document.createElement('li');
      li.classList.toggle('active', appliedConstellations.has(c.id));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = c.nativeName ? `${c.name} · ${c.nativeName}` : c.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      const isFocused = c.id === focusedConstellation;
      tag.textContent = isFocused ? '聚焦' : c.id;
      if (isFocused) tag.classList.add('up');
      li.append(name, tag);
      li.addEventListener('click', () => toggleConstellation(c.id));
      return li;
    }),
  );
}

function reconcileConstellations(): void {
  const desired = new Set(manualConstellations);
  if (focusedConstellation) desired.add(focusedConstellation);

  for (const id of appliedConstellations) {
    if (!desired.has(id)) engine.solarSystem.constellations.hide({ id });
  }
  for (const id of desired) {
    if (!appliedConstellations.has(id)) {
      engine.solarSystem.constellations.show({ id, showLabel: true, allowClose: true });
    }
  }
  appliedConstellations = desired;
  renderConstellations(constellationSearch.value);
}

function toggleConstellation(id: string): void {
  if (manualConstellations.has(id)) manualConstellations.delete(id);
  else manualConstellations.add(id);
  reconcileConstellations();
}

constellationSearch.addEventListener('input', () => renderConstellations(constellationSearch.value));
$('btn-hide-constellations').addEventListener('click', () => {
  manualConstellations.clear();
  focusedConstellation = null;
  reconcileConstellations();
});

// --- Auto focus detection ------------------------------------------------
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function rotateByQuat(v: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

const FOCUS_ENTER_DEG = 22;
const FOCUS_EXIT_DEG = 28;

let focusTargets: Array<{ id: string; dir: Vec3 }> = [];
let celestialSphere: { quaternion: { x: number; y: number; z: number; w: number } } | null = null;

function buildFocusTargets(): void {
  focusTargets = allConstellations.flatMap((c) => {
    const eq = engine.solarSystem.getObjectById(c.id)?.equatorial;
    if (!eq) return [];
    const ra = (eq.ra * Math.PI) / 180;
    const dec = (eq.dec * Math.PI) / 180;
    return [{
      id: c.id,
      dir: { x: Math.cos(dec) * Math.sin(ra), y: Math.sin(dec), z: Math.cos(dec) * Math.cos(ra) },
    }];
  });
}

function updateFocus(): void {
  if (!autoConstellation || !celestialSphere || focusTargets.length === 0) return;
  const camera = engine.getCamera();
  if (!camera) return;

  const forward = rotateByQuat({ x: 0, y: 0, z: -1 }, camera.quaternion);
  const q = celestialSphere.quaternion;

  let bestId: string | null = null;
  let bestAngle = Infinity;
  let focusedAngle = Infinity;

  for (const target of focusTargets) {
    const dir = rotateByQuat(target.dir, q);
    const dot = Math.min(1, Math.max(-1, forward.x * dir.x + forward.y * dir.y + forward.z * dir.z));
    const angle = (Math.acos(dot) * 180) / Math.PI;
    if (angle < bestAngle) {
      bestAngle = angle;
      bestId = target.id;
    }
    if (target.id === focusedConstellation) focusedAngle = angle;
  }

  let next: string | null = focusedConstellation;
  if (focusedConstellation && focusedAngle <= FOCUS_EXIT_DEG) {
    if (bestId && bestId !== focusedConstellation && bestAngle < focusedAngle - 5) next = bestId;
  } else {
    next = bestId && bestAngle <= FOCUS_ENTER_DEG ? bestId : null;
  }

  if (next !== focusedConstellation) {
    focusedConstellation = next;
    reconcileConstellations();
  }
}

autoConstellationCheckbox.addEventListener('change', () => {
  autoConstellation = autoConstellationCheckbox.checked;
  if (!autoConstellation && focusedConstellation) {
    focusedConstellation = null;
    reconcileConstellations();
  }
});

// ---------------------------------------------------------------------------
// Planet visibility panel
// ---------------------------------------------------------------------------
const planetList = $<HTMLUListElement>('planet-list');

function renderPlanets(): void {
  const planets = engine.solarSystem.planets.find();
  planetList.replaceChildren(
    ...planets.map((p) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const alt = p.altitude ?? 0;
      const tag = document.createElement('span');
      tag.className = `tag ${alt > 0 ? 'up' : 'down'}`;
      tag.textContent = `${alt.toFixed(1)}°`;
      li.append(name, tag);
      li.addEventListener('click', () => selectAndCenter('planet', p.name));
      return li;
    }),
  );
}

// ---------------------------------------------------------------------------
// Rise / transit / set computation
// ---------------------------------------------------------------------------
interface RiseSetRow {
  name: string;
  rise: Date | null;
  transit: Date | null;
  set: Date | null;
  currentAlt: number | null;
  maxAlt: number;
}

const REF = (objectType: SolarSystemObjectType, objectId: string | number) =>
  ({ objectType, objectId });

function altitudeAt(objectType: SolarSystemObjectType, objectId: string | number, t: number): number | null {
  const { altitude } = engine.solarSystem.aboveHorizon({ ...REF(objectType, objectId), time: new Date(t) });
  return altitude ?? null;
}

function refineCrossing(objectType: SolarSystemObjectType, objectId: string | number, from: number, to: number): Date {
  let last = altitudeAt(objectType, objectId, from);
  for (let t = from + 60_000; t <= to; t += 60_000) {
    const cur = altitudeAt(objectType, objectId, t);
    if (last !== null && cur !== null && (last <= 0) !== (cur <= 0)) return new Date(t);
    last = cur;
  }
  return new Date(to);
}

function computeRiseSet(objectType: SolarSystemObjectType, objectId: string | number, name: string): RiseSetRow {
  const ref = engine.clock.getDateTime();
  const start = new Date(ref);
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const endMs = startMs + 24 * 3600_000;
  const coarse = 15 * 60_000;

  let prevAlt: number | null = null;
  let prevT = startMs;
  let rise: Date | null = null;
  let set: Date | null = null;
  let maxAlt = -90;
  let transitT = startMs;

  for (let t = startMs; t <= endMs; t += coarse) {
    const alt = altitudeAt(objectType, objectId, t);
    if (alt === null) {
      prevAlt = null;
      continue;
    }
    if (alt > maxAlt) {
      maxAlt = alt;
      transitT = t;
    }
    if (prevAlt !== null) {
      if (prevAlt <= 0 && alt > 0 && rise === null) rise = refineCrossing(objectType, objectId, prevT, t);
      if (prevAlt > 0 && alt <= 0 && set === null) set = refineCrossing(objectType, objectId, prevT, t);
    }
    prevAlt = alt;
    prevT = t;
  }

  let transit: Date | null = null;
  if (maxAlt > 0) {
    let best = -90;
    for (let t = transitT - coarse; t <= transitT + coarse; t += 60_000) {
      const alt = altitudeAt(objectType, objectId, t);
      if (alt !== null && alt > best) {
        best = alt;
        transit = new Date(t);
      }
    }
  }

  const currentAlt = altitudeAt(objectType, objectId, ref.getTime());
  return { name, rise, transit, set, currentAlt, maxAlt };
}

const risesetBody = $('riseset-body');
let riseSetToken = 0;
let riseSetBusy = false;
let riseSetLastAt = 0;

function renderRiseSet(rows: RiseSetRow[]): void {
  risesetBody.replaceChildren(
    ...rows.map((r) => {
      const tr = document.createElement('tr');
      if ((r.currentAlt ?? -1) > 0) tr.classList.add('up');
      const name = document.createElement('td');
      name.className = 'name';
      name.textContent = r.name;
      const cells = [r.rise, r.transit, r.set].map((d) => {
        const td = document.createElement('td');
        td.textContent = formatHM(d);
        return td;
      });
      tr.append(name, ...cells);
      return tr;
    }),
  );
}

function refreshRiseSet(force = false): void {
  if ($('panel-info').classList.contains('hidden')) return;

  const date = engine.clock.getDateTime();
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (!force && key === knownRiseSetDateKey) return;
  if (riseSetBusy) return;

  knownRiseSetDateKey = key;
  riseSetBusy = true;
  riseSetLastAt = Date.now();
  const token = ++riseSetToken;
  risesetBody.innerHTML = '<tr><td colspan="4" class="muted">计算中…</td></tr>';

  const targets: Array<{ type: SolarSystemObjectType; id: string; name: string }> = [
    { type: 'sun', id: 'sun', name: '太阳' },
    { type: 'moon', id: 'moon', name: '月亮' },
    ...engine.solarSystem.planets.find().map((p) => ({ type: 'planet' as const, id: p.id, name: p.name })),
  ];

  window.setTimeout(() => {
    const rows = targets.map((t) => computeRiseSet(t.type, t.id, t.name));
    riseSetBusy = false;
    if (token !== riseSetToken) return;
    renderRiseSet(rows);
  }, 0);
}

function maybeRefreshRiseSet(): void {
  if (Date.now() - riseSetLastAt < 1500) return;
  const date = engine.clock.getDateTime();
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (key !== knownRiseSetDateKey) refreshRiseSet();
}

// ---------------------------------------------------------------------------
// Object info (click / search)
// ---------------------------------------------------------------------------
const objectInfo = $('object-info');
const objectTitle = $('object-title');
const objectBody = $('object-body');
const followBtn = $<HTMLButtonElement>('btn-follow');
const unfollowBtn = $<HTMLButtonElement>('btn-unfollow');
let tracked: { objectType: SolarSystemObjectType; objectId: string | number } | null = null;

function kv(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kv';
  const l = document.createElement('span');
  l.textContent = label;
  const v = document.createElement('strong');
  v.textContent = value;
  row.append(l, v);
  return row;
}

const OBJECT_TYPE_CN: Record<SolarSystemObjectType, string> = {
  sun: '太阳',
  moon: '月亮',
  planet: '行星',
  star: '恒星',
  constellation: '星座',
};

let objectInfoMagnitudeHint: number | undefined;
let cachedRiseSet: RiseSetRow | null = null;
let cachedRiseSetKey = '';

function riseSetCacheKey(objectType: SolarSystemObjectType, objectId: string | number): string {
  const d = engine.clock.getDateTime();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${objectType}|${objectId}`;
}

function ensureObjectRiseSet(objectType: SolarSystemObjectType, objectId: string | number): RiseSetRow {
  const key = riseSetCacheKey(objectType, objectId);
  if (!cachedRiseSet || cachedRiseSetKey !== key) {
    cachedRiseSet = computeRiseSet(objectType, objectId, '');
    cachedRiseSetKey = key;
  }
  return cachedRiseSet;
}

function renderObjectInfo(): void {
  if (!tracked || objectInfo.classList.contains('hidden')) return;
  const info = engine.solarSystem.getObjectById(tracked.objectId);
  if (!info) return;

  const { objectType, objectId } = tracked;
  objectTitle.textContent = info.name ?? String(objectId);

  const rows: HTMLElement[] = [];
  rows.push(kv('类型', OBJECT_TYPE_CN[objectType] ?? objectType));
  const alt = info.altitude ?? info.horizontal.altitude;
  rows.push(kv('高度角', `${alt.toFixed(1)}°`));
  rows.push(kv('方位角', `${info.horizontal.azimuth.toFixed(1)}°`));
  const magnitude = typeof info.magnitude === 'number' ? info.magnitude : objectInfoMagnitudeHint;
  if (typeof magnitude === 'number') rows.push(kv('星等', magnitude.toFixed(2)));
  rows.push(kv('赤经', `${(info.equatorial.ra / 15).toFixed(2)}h`));
  rows.push(kv('赤纬', `${info.equatorial.dec.toFixed(1)}°`));

  const rs = ensureObjectRiseSet(objectType, objectId);
  rows.push(kv('升', formatHM(rs.rise)));
  rows.push(kv('中天', formatHM(rs.transit)));
  rows.push(kv('落', formatHM(rs.set)));

  objectBody.replaceChildren(...rows);
}

function showObjectInfo(
  objectType: SolarSystemObjectType,
  objectId: string | number,
  magnitudeHint?: number,
): void {
  if (!engine.solarSystem.getObjectById(objectId)) return;
  tracked = { objectType, objectId };
  objectInfoMagnitudeHint = magnitudeHint;
  cachedRiseSet = null;
  cachedRiseSetKey = '';
  objectInfo.classList.remove('hidden');
  syncFollowButtons();
  renderObjectInfo();
}

function syncFollowButtons(): void {
  const following = Boolean(engine.camera.getFollowTarget());
  followBtn.classList.toggle('hidden', following);
  unfollowBtn.classList.toggle('hidden', !following);
}

/** Select (crosshair) + centre + start tracking an object. */
function focusObject(
  objectType: SolarSystemObjectType,
  objectId: string | number,
  magnitudeHint?: number,
): void {
  const ok = engine.camera.followObject({ objectType, objectId, animate: true, select: true });
  if (!ok) {
    engine.clearSelection();
    engine.camera.stopFollowingObject();
  }
  showObjectInfo(objectType, objectId, magnitudeHint);
}

function clearFocus(): void {
  engine.clearSelection();
  engine.camera.stopFollowingObject();
  objectInfo.classList.add('hidden');
  tracked = null;
}

function selectAndCenter(objectType: SolarSystemObjectType, objectId: string | number): void {
  if (objectType === 'constellation') {
    manualConstellations.add(String(objectId));
    reconcileConstellations();
  }
  focusObject(objectType, objectId);
}

followBtn.addEventListener('click', () => {
  if (!tracked) return;
  focusObject(tracked.objectType, tracked.objectId);
});
unfollowBtn.addEventListener('click', () => {
  engine.camera.stopFollowingObject();
  syncFollowButtons();
});

engine.on(EngineEvent.FOLLOW_TARGET_CHANGED, () => syncFollowButtons());

// ---------------------------------------------------------------------------
// Search (stars / constellations / planets)
// ---------------------------------------------------------------------------
interface SearchItem {
  kind: string;
  label: string;
  sub: string;
  objectType: SolarSystemObjectType;
  objectId: string | number;
}

const searchInput = $<HTMLInputElement>('search-input');
const searchResults = $<HTMLUListElement>('search-results');
let searchItems: SearchItem[] = [];
let activeSearchIndex = 0;

function setActiveSearchIndex(index: number): void {
  if (searchItems.length === 0) return;
  activeSearchIndex = (index + searchItems.length) % searchItems.length;
  Array.from(searchResults.children).forEach((child, i) => {
    child.classList.toggle('active', i === activeSearchIndex);
  });
  searchResults.children[activeSearchIndex]?.scrollIntoView({ block: 'nearest' });
}

function commitSearch(item: SearchItem): void {
  selectAndCenter(item.objectType, item.objectId);
  searchResults.classList.add('hidden');
  searchInput.value = item.label;
  searchItems = [];
}

function runSearch(query: string): void {
  const q = query.trim();
  if (!q) {
    searchResults.classList.add('hidden');
    searchItems = [];
    return;
  }

  searchItems = [
    ...engine.solarSystem.stars.find({ query: q, limit: 6 }).map((s) => ({
      kind: '恒星',
      label: s.name,
      sub: `${s.magnitude.toFixed(1)} 等`,
      objectType: 'star' as const,
      objectId: s.id,
    })),
    ...engine.solarSystem.constellations.find({ query: q, limit: 5 }).map((c) => ({
      kind: '星座',
      label: c.name,
      sub: c.nativeName ?? c.id,
      objectType: 'constellation' as const,
      objectId: c.id,
    })),
    ...engine.solarSystem.planets.find({ query: q, limit: 5 }).map((p) => ({
      kind: '行星',
      label: p.name,
      sub: '太阳系',
      objectType: 'planet' as const,
      objectId: p.name,
    })),
  ];

  searchResults.replaceChildren(
    ...searchItems.map((item) => {
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = item.label;
      const tag = document.createElement('span');
      tag.className = 'kind';
      tag.textContent = `${item.kind} · ${item.sub}`;
      li.append(left, tag);
      li.addEventListener('click', () => commitSearch(item));
      return li;
    }),
  );
  searchResults.classList.toggle('hidden', searchItems.length === 0);
  setActiveSearchIndex(0);
}

let searchTimer = 0;
searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  const value = searchInput.value;
  searchTimer = window.setTimeout(() => runSearch(value), 150);
});
searchInput.addEventListener('keydown', (event) => {
  if (searchItems.length === 0) {
    if (event.key === 'Escape') searchResults.classList.add('hidden');
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setActiveSearchIndex(activeSearchIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setActiveSearchIndex(activeSearchIndex - 1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    commitSearch(searchItems[activeSearchIndex] ?? searchItems[0]);
  } else if (event.key === 'Escape') {
    searchResults.classList.add('hidden');
  }
});
document.addEventListener('click', (event) => {
  if (!searchResults.contains(event.target as Node) && event.target !== searchInput) {
    searchResults.classList.add('hidden');
  }
});

// ---------------------------------------------------------------------------
// Click readout
// ---------------------------------------------------------------------------
function formatClickReadout(data: ClickEventData): string {
  const raHours = data.equatorial.ra / 15;
  const dec = data.equatorial.dec;
  const target = data.object?.name ? `目标 <b>${data.object.name}</b> · ` : '';
  const mag =
    typeof data.object?.magnitude === 'number'
      ? `星等 <b>${data.object.magnitude.toFixed(2)}</b> · `
      : '';
  return (
    target +
    mag +
    `赤经 <b>${raHours.toFixed(2)}h</b> · 赤纬 <b>${dec.toFixed(1)}°</b> · ` +
    `高度 <b>${data.horizontal.altitude.toFixed(1)}°</b> · 方位 <b>${data.horizontal.azimuth.toFixed(1)}°</b>`
  );
}

// ---------------------------------------------------------------------------
// Panel toggles
// ---------------------------------------------------------------------------
const panelInfo = $('panel-info');
const panelView = $('panel-view');
const toggleInfoBtn = $<HTMLButtonElement>('toggle-info');
const toggleViewBtn = $<HTMLButtonElement>('toggle-view');

function setPanel(panel: HTMLElement, btn: HTMLButtonElement, open: boolean): void {
  panel.classList.toggle('hidden', !open);
  btn.classList.toggle('active', open);
  if (panel === panelInfo && open) refreshRiseSet(true);
}

toggleInfoBtn.addEventListener('click', () =>
  setPanel(panelInfo, toggleInfoBtn, panelInfo.classList.contains('hidden')));
toggleViewBtn.addEventListener('click', () =>
  setPanel(panelView, toggleViewBtn, panelView.classList.contains('hidden')));

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-close]')) {
  btn.addEventListener('click', () => {
    const panel = document.getElementById(btn.dataset.close ?? '');
    if (!panel) return;
    if (panel === panelInfo) setPanel(panelInfo, toggleInfoBtn, false);
    else if (panel === panelView) setPanel(panelView, toggleViewBtn, false);
    else panel.classList.add('hidden');
  });
}

// ---------------------------------------------------------------------------
// Touch gestures: two-finger pinch => FOV zoom (desktop uses wheel)
// ---------------------------------------------------------------------------
function touchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function setupTouchZoom(): void {
  let startDistance = 0;
  let startFov = 65;

  canvas.addEventListener('touchstart', (event) => {
    if (event.touches.length === 2) {
      startDistance = touchDistance(event.touches);
      startFov = engine.getCamera()?.fov ?? 65;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 2 || startDistance <= 0) return;
    event.preventDefault();
    const camera = engine.getCamera();
    if (!camera) return;
    const scale = touchDistance(event.touches) / startDistance;
    camera.fov = Math.min(100, Math.max(20, startFov / scale));
    camera.updateProjectionMatrix();
  }, { passive: false });

  const reset = (event: TouchEvent) => {
    if (event.touches.length < 2) startDistance = 0;
  };
  canvas.addEventListener('touchend', reset, { passive: true });
  canvas.addEventListener('touchcancel', reset, { passive: true });
}

/**
 * OrbitControls keeps its single-finger ROTATE state when a second finger
 * lands (two-finger dolly/pan is disabled), and rotates around the average of
 * both pointers — which makes the view drift while pinching. Block its pointer
 * events for the whole gesture once two touch pointers are active.
 */
function setupPinchIsolation(): void {
  const activeTouches = new Set<number>();
  const isCanvasTouch = (event: PointerEvent) =>
    event.pointerType === 'touch' && event.target === canvas;

  window.addEventListener(
    'pointerdown',
    (event) => {
      if (!isCanvasTouch(event)) return;
      activeTouches.add(event.pointerId);
      if (activeTouches.size >= 2) event.stopImmediatePropagation();
    },
    true,
  );

  window.addEventListener(
    'pointermove',
    (event) => {
      if (!isCanvasTouch(event)) return;
      if (activeTouches.size >= 2) event.stopImmediatePropagation();
    },
    true,
  );

  const release = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    activeTouches.delete(event.pointerId);
  };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
}

// ---------------------------------------------------------------------------
// Object name tags (Sun / Moon / planets) overlaid on the sky
// ---------------------------------------------------------------------------
const PLANET_CN: Record<string, string> = {
  Mercury: '水星',
  Venus: '金星',
  Earth: '地球',
  Mars: '火星',
  Jupiter: '木星',
  Saturn: '土星',
  Uranus: '天王星',
  Neptune: '海王星',
};

interface ObjectTag {
  objectId: string;
  el: HTMLDivElement;
}

const objectTags: ObjectTag[] = [];

function buildObjectTags(): void {
  const container = $('labels');
  container.replaceChildren();
  objectTags.length = 0;

  const add = (objectType: SolarSystemObjectType, objectId: string, label: string, cls: string) => {
    const el = document.createElement('div');
    el.className = `object-tag ${cls}`;
    el.textContent = label;
    el.addEventListener('click', () => focusObject(objectType, objectId));
    container.appendChild(el);
    objectTags.push({ objectId, el });
  };

  add('sun', 'sun', '☉ 太阳', 'sun');
  add('moon', 'moon', '☾ 月亮', 'moon');
  for (const planet of engine.solarSystem.planets.find()) {
    add('planet', planet.name, PLANET_CN[planet.name] ?? planet.name, 'planet');
  }
}

function updateObjectTags(): void {
  const camera = engine.getCamera();
  if (!camera) return;

  const cam = camera.position;
  const forward = camera.getWorldDirection(cam.clone());
  const width = window.innerWidth;
  const height = window.innerHeight;

  for (const tag of objectTags) {
    const info = engine.solarSystem.getObjectById(tag.objectId);
    if (!info) {
      tag.el.style.display = 'none';
      continue;
    }
    const p = info.position;
    const front = (p.x - cam.x) * forward.x + (p.y - cam.y) * forward.y + (p.z - cam.z) * forward.z;
    if (front <= 0) {
      tag.el.style.display = 'none';
      continue;
    }
    const projected = cam.clone().set(p.x, p.y, p.z).project(camera);
    const sx = (projected.x * 0.5 + 0.5) * width;
    const sy = (-projected.y * 0.5 + 0.5) * height;
    if (projected.z < -1 || projected.z > 1 || sx < -60 || sx > width + 60 || sy < -30 || sy > height + 30) {
      tag.el.style.display = 'none';
      continue;
    }
    tag.el.style.display = '';
    tag.el.classList.toggle('below', (info.altitude ?? info.horizontal.altitude) <= 0);
    tag.el.style.transform = `translate(${sx + 12}px, ${sy}px) translateY(-50%)`;
  }
}

// Make the planet markers themselves stand out a bit more than stars.
function enlargePlanets(): void {
  const scene = engine.getContext()?.scene;
  if (!scene) return;
  scene.traverse((object: { name?: string; scale?: { setScalar: (v: number) => void } }) => {
    if (typeof object.name === 'string' && object.name.startsWith('planet_') && object.scale) {
      object.scale.setScalar(2.5);
    }
  });
}

// Give bright stars noticeably more intensity than faint ones (the engine
// renders every star with the same brightness by default).
function enhanceStarContrast(): void {
  const bright: Array<string | number> = [];
  const medium: Array<string | number> = [];
  const faint: Array<string | number> = [];
  for (const star of engine.solarSystem.stars.find()) {
    if (star.magnitude <= 1.5) bright.push(star.id);
    else if (star.magnitude <= 3) medium.push(star.id);
    else faint.push(star.id);
  }
  if (bright.length) engine.solarSystem.star.update({ ids: bright, brightnessFactor: 4.5, sizeFactor: 1.35 });
  if (medium.length) engine.solarSystem.star.update({ ids: medium, brightnessFactor: 2.1, sizeFactor: 1.1 });
  if (faint.length) engine.solarSystem.star.update({ ids: faint, brightnessFactor: 1, sizeFactor: 0.85 });
}

// ---------------------------------------------------------------------------
// Engine events
// ---------------------------------------------------------------------------
engine.on(EngineEvent.CLOCK_UPDATE, (p: ClockUpdatePayload) =>
  applyClockState(p.dateTime, p.speed, p.isPlaying));
engine.on(EngineEvent.CLOCK_PLAY_UPDATE, (p) =>
  applyClockState(p.dateTime, p.speed, p.isPlaying));
engine.on(EngineEvent.OBSERVER_CHANGED, () => {
  refreshObserverDisplay();
  refreshRiseSet(true);
  cachedRiseSet = null;
  cachedRiseSetKey = '';
  renderObjectInfo();
});
engine.on(EngineEvent.SCENE_CLICKED, (data: ClickEventData) => {
  readoutEl.innerHTML = formatClickReadout(data);
  readoutEl.classList.remove('hidden');
  if (data.object?.type) {
    focusObject(data.object.type, data.object.id, data.object.magnitude);
  } else {
    clearFocus();
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot(): Promise<void> {
  await engine.initialize();
  engine.start();

  allConstellations = engine.solarSystem.constellations.find();
  celestialSphere = engine.getContext()?.scene?.getObjectByName('celestialSphere') ?? null;
  buildFocusTargets();
  renderConstellations();
  renderPlanets();
  refreshObserverDisplay();
  setupTouchZoom();
  setupPinchIsolation();

  skyDome = engine.getContext()?.scene?.getObjectByName('skyDome') ?? null;
  buildSkyGrids();
  applySceneToggles();
  applyAtmosphere();

  enlargePlanets();
  enhanceStarContrast();
  buildObjectTags();

  const now = engine.clock.getDateTime();
  applyClockState(now, engine.clock.getSpeed(), engine.clock.isPlaying());

  const desktop = window.innerWidth > 760;
  setPanel(panelInfo, toggleInfoBtn, desktop);
  setPanel(panelView, toggleViewBtn, desktop);
  if (desktop) refreshRiseSet(true);

  window.setInterval(renderPlanets, 3000);
  window.setInterval(updateFocus, 250);
  window.setInterval(updateObjectTags, 100);
  window.setInterval(renderObjectInfo, 500);
  updateFocus();
  updateObjectTags();

  $('loading').classList.add('hide');
  window.setTimeout(() => $('loading').remove(), 700);
}

void boot();
