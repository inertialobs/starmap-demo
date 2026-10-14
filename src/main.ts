import { PlanetariumEngine, EngineEvent } from '@tracing-the-sky/engine';
import type {
  ClockUpdatePayload,
  ClickEventData,
  ConstellationSearchResult,
  ObserverLocation,
} from '@tracing-the-sky/engine';
import './style.css';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

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
// Time UI
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
const speedButtons = new Map<number, HTMLButtonElement>();

for (const { label, value } of SPEEDS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', () => engine.clock.setSpeed(value));
  speedsEl.appendChild(btn);
  speedButtons.set(value, btn);
}

function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function refreshTimeDisplay(date: Date, speed: number, isPlaying: boolean): void {
  simTimeEl.textContent = formatDateTime(date);
  playBtn.textContent = isPlaying ? '⏸ 暂停' : '▶ 播放';
  for (const [value, btn] of speedButtons) {
    btn.classList.toggle('active', value === speed);
  }
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
$<HTMLSelectElement>('observer-preset').addEventListener('change', (event) => {
  const preset = PRESETS[(event.target as HTMLSelectElement).value];
  if (preset) engine.observer.update(preset.location);
});

// ---------------------------------------------------------------------------
// Display settings
// ---------------------------------------------------------------------------
const toggles: Array<[string, () => void]> = [
  ['opt-milkyway', () => engine.scene.update({ showMilkyWay: $<HTMLInputElement>('opt-milkyway').checked })],
  ['opt-cardinal', () => engine.scene.update({ showCardinalLabels: $<HTMLInputElement>('opt-cardinal').checked })],
  ['opt-azimuth', () => engine.scene.update({ showAzimuthLines: $<HTMLInputElement>('opt-azimuth').checked })],
  ['opt-altitude', () => engine.scene.update({ showAltitudeLines: $<HTMLInputElement>('opt-altitude').checked })],
  ['opt-horizon', () => engine.scene.update({ showHorizonObjects: $<HTMLInputElement>('opt-horizon').checked })],
];
for (const [id, handler] of toggles) {
  $<HTMLInputElement>(id).addEventListener('change', handler);
}

// ---------------------------------------------------------------------------
// Constellation browser
// ---------------------------------------------------------------------------
const constellationSearch = $<HTMLInputElement>('constellation-search');
const constellationList = $<HTMLUListElement>('constellation-list');
const visibleConstellations = new Set<string>();

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
      li.classList.toggle('active', visibleConstellations.has(c.id));

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = c.nativeName ? `${c.name} · ${c.nativeName}` : c.name;

      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = c.id;

      li.append(name, tag);
      li.addEventListener('click', () => toggleConstellation(c.id));
      return li;
    }),
  );
}

function toggleConstellation(id: string): void {
  if (visibleConstellations.has(id)) {
    engine.solarSystem.constellations.hide({ id });
    visibleConstellations.delete(id);
  } else {
    engine.solarSystem.constellations.show({ id, showLabel: true, allowClose: true });
    visibleConstellations.add(id);
  }
  renderConstellations(constellationSearch.value);
}

constellationSearch.addEventListener('input', () => renderConstellations(constellationSearch.value));
$('btn-hide-constellations').addEventListener('click', () => {
  engine.solarSystem.constellations.hideAll();
  visibleConstellations.clear();
  renderConstellations(constellationSearch.value);
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
      li.style.cursor = 'default';

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;

      const alt = p.altitude ?? 0;
      const tag = document.createElement('span');
      tag.className = `tag ${alt > 0 ? 'up' : 'down'}`;
      tag.textContent = `${alt.toFixed(1)}°`;

      li.append(name, tag);
      return li;
    }),
  );
}

// ---------------------------------------------------------------------------
// Click readout (equatorial / horizontal coordinates)
// ---------------------------------------------------------------------------
function formatClickReadout(data: ClickEventData): string {
  const raHours = data.equatorial.ra / 15;
  const dec = data.equatorial.dec;
  const decLabel = `${Math.abs(dec).toFixed(1)}°${dec >= 0 ? 'N' : 'S'}`;
  const alt = data.horizontal.altitude;
  const az = data.horizontal.azimuth;
  const target = data.object?.name ? `目标 <b>${data.object.name}</b> · ` : '';
  return (
    target +
    `赤经 <b>${raHours.toFixed(2)}h</b> · 赤纬 <b>${decLabel}</b> · ` +
    `高度 <b>${alt.toFixed(1)}°</b> · 方位 <b>${az.toFixed(1)}°</b>`
  );
}

// ---------------------------------------------------------------------------
// Wire engine events
// ---------------------------------------------------------------------------

engine.on(EngineEvent.CLOCK_UPDATE, (payload: ClockUpdatePayload) => {
  refreshTimeDisplay(payload.dateTime, payload.speed, payload.isPlaying);
});

engine.on(EngineEvent.CLOCK_PLAY_UPDATE, (payload) => {
  playBtn.textContent = payload.isPlaying ? '⏸ 暂停' : '▶ 播放';
});

engine.on(EngineEvent.OBSERVER_CHANGED, () => refreshObserverDisplay());

engine.on(EngineEvent.SCENE_CLICKED, (data: ClickEventData) => {
  readoutEl.innerHTML = formatClickReadout(data);
  readoutEl.classList.remove('hidden');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot(): Promise<void> {
  await engine.initialize();
  engine.start();

  allConstellations = engine.solarSystem.constellations.find();
  renderConstellations();
  renderPlanets();
  refreshObserverDisplay();

  const now = engine.clock.getDateTime();
  refreshTimeDisplay(now, engine.clock.getSpeed(), engine.clock.isPlaying());

  window.setInterval(renderPlanets, 3000);

  $('loading').classList.add('hide');
  window.setTimeout(() => $('loading').remove(), 700);

  // 默认展示一个明显的星座，让示例开箱可见
  toggleConstellation('UMa');
}

void boot();
