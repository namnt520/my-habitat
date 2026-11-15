/**
 * Lớp `App`: ghép Worker mô phỏng, renderer (2D hoặc 3D) và các bảng giao diện.
 *
 * Luồng dữ liệu một chiều: Worker → ảnh chụp/thống kê → renderer và các bảng. Giao diện chỉ gửi lệnh
 * (tốc độ, tham số, thảm hoạ) ngược về Worker; nó không bao giờ chạm vào trạng thái mô phỏng.
 */
import type { SimEvent } from '../sim/disasters';
import { seedFromString } from '../sim/rng';
import type { InspectInfo, Scenario } from '../sim/simulation';
import type { RenderSnapshot } from '../sim/snapshot';
import { SPECIES_COLORS, type WorldRenderer } from '../render/common';
import { Renderer2D } from '../render2d/renderer2d';
import { SimClient } from '../worker/client';
import type { PerfInfo, WorldMeta } from '../worker/protocol';
import { download, formatDate, h, setChildren } from './dom';
import { ControlsPanel } from './panels/controls';
import { ExperimentPanel } from './panels/experiment';
import { FoodWebPanel } from './panels/foodweb';
import { GenesPanel } from './panels/genes';
import { InspectorPanel } from './panels/inspector';
import { PhylogenyPanel } from './panels/phylogeny';
import { PopulationPanel } from './panels/population';
import { History } from './store';

/** Một bảng ở thanh bên. `update` được gọi vài lần mỗi giây khi bảng đang hiện. */
export interface Panel {
  readonly id: string;
  readonly title: string;
  readonly element: HTMLElement;
  update(): void;
  /** Gọi khi mô phỏng được khởi tạo lại (thế giới mới). */
  reset?(): void;
}

/** Công cụ "bấm lên bản đồ" đang chọn (đặt thảm hoạ tại một điểm). */
export type MapTool = { kind: 'fire' } | { kind: 'invasive'; species: string; count: number } | null;

/** Tốc độ ×1 tính bằng tick/giây: một ngày mô phỏng (120 tick) dài 4 giây. */
export const BASE_TICKS_PER_SECOND = 30;
const SPEEDS: { label: string; factor: number }[] = [
  { label: '×1', factor: 1 },
  { label: '×10', factor: 10 },
  { label: '×100', factor: 100 },
  { label: 'Tối đa', factor: Infinity },
];

export class App {
  readonly client: SimClient;
  meta: WorldMeta | null = null;
  history: History | null = null;
  snapshot: RenderSnapshot | null = null;
  selectedId = 0;
  inspectInfo: InspectInfo | null = null;
  perf: PerfInfo = { tickMs: 0, ticksPerSecond: 0, targetTicksPerSecond: 0 };
  fps = 0;
  /** Thời gian vẽ một khung hình (ms), làm mượt — để đo hiệu năng renderer độc lập với vsync. */
  renderMs = 0;
  renderer: WorldRenderer;
  mode: '2d' | '3d' = '2d';
  seedText = '42';
  scenario: Scenario = 'default';

  private paused = false;
  private speedIndex = 0;
  private drawing = true;
  private follow = false;
  private tool: MapTool = null;
  private snapshotTime = 0;
  private tickFraction = 0;
  private lastFieldsRequest = 0;
  private frames = 0;
  private fpsWindowStart = performance.now();
  private readonly viewport: HTMLElement;
  private readonly hudDate: HTMLElement;
  private readonly hudPerf: HTMLElement;
  private readonly hudTool: HTMLElement;
  private readonly pausedNote: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly panelHost: HTMLElement;
  private readonly tabBar: HTMLElement;
  private panels: Panel[] = [];
  private activePanel = 0;
  private renderer3d: WorldRenderer | null = null;
  private readonly renderer2d: Renderer2D;

  constructor(root: HTMLElement) {
    this.renderer2d = new Renderer2D();
    this.renderer2d.onClick = (x, y) => this.handleMapClick(x, y);
    this.renderer = this.renderer2d;

    this.hudDate = h('div', { class: 'hud top-left' }, 'Đang khởi tạo…');
    this.hudPerf = h('div', { class: 'hud bottom-left' });
    this.hudTool = h('div', { class: 'hud top-center', hidden: true });
    this.pausedNote = h(
      'div',
      { class: 'paused-note', hidden: true },
      'Chế độ không vẽ: mô phỏng vẫn chạy trong Worker. Bật lại "Vẽ" để xem.',
    );
    this.viewport = h(
      'section',
      { class: 'viewport' },
      this.renderer.canvas,
      this.pausedNote,
      this.hudDate,
      this.hudPerf,
      this.hudTool,
    );
    this.toolbar = h('header', { class: 'toolbar' });
    this.tabBar = h('nav', { class: 'tabs' });
    this.panelHost = h('div', { class: 'panel' });
    root.append(
      this.toolbar,
      h(
        'div',
        { class: 'main' },
        this.viewport,
        h('aside', { class: 'sidebar' }, this.tabBar, this.panelHost),
      ),
    );

    this.client = new SimClient({
      onReady: (meta) => this.handleReady(meta),
      onFrame: (message) => {
        this.snapshot = message.snapshot;
        this.snapshotTime = performance.now();
        this.tickFraction = message.tickFraction;
        this.perf = message.perf;
      },
      onStats: (message) => this.history?.push(message),
      onInspect: (info) => {
        this.inspectInfo = info;
        if (info && !info.alive && this.follow) this.setFollow(false);
      },
    });

    this.panels = [
      new PopulationPanel(this),
      new GenesPanel(this),
      new FoodWebPanel(this),
      new PhylogenyPanel(this),
      new InspectorPanel(this),
      new ControlsPanel(this),
      new ExperimentPanel(this),
    ];
    this.buildToolbar();
    this.buildTabs();

    new ResizeObserver(() => this.resize()).observe(this.viewport);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.setTool(null);
      if (event.key === ' ' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        this.togglePause();
      }
    });
    setInterval(() => this.slowUpdate(), 250);
    requestAnimationFrame((now) => this.frame(now));

    // Tham số URL: ?seed=…&scenario=lotka-volterra&paused=1 (paused: khởi tạo xong thì đứng yên ở tick 0,
    // dùng để kiểm chứng tất định bằng `habitat.client.run(n)`).
    const query = new URLSearchParams(location.search);
    this.seedText = query.get('seed') ?? this.seedText;
    this.scenario = query.get('scenario') === 'lotka-volterra' ? 'lotka-volterra' : 'default';
    this.paused = query.has('paused');
    this.restart();
  }

  // ───────────────────────────── Vòng đời mô phỏng ─────────────────────────────

  /** Khởi tạo lại mô phỏng với seed và kịch bản hiện tại. */
  restart(): void {
    this.meta = null;
    this.history = null;
    this.snapshot = null;
    this.selectedId = 0;
    this.inspectInfo = null;
    this.client.init(seedFromString(this.seedText), this.scenario);
    this.applySpeed();
  }

  private handleReady(meta: WorldMeta): void {
    this.meta = meta;
    this.history = new History(meta);
    this.resize(); // renderer cần biết kích thước khung nhìn trước khi đặt camera
    this.renderer2d.setWorld(meta);
    this.renderer3d?.setWorld(meta);
    for (const panel of this.panels) panel.reset?.();
    this.resize();
    this.buildToolbar();
    this.client.requestFrame(true);
  }

  private applySpeed(): void {
    this.client.setSpeed(this.paused ? 0 : BASE_TICKS_PER_SECOND * SPEEDS[this.speedIndex].factor);
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.applySpeed();
    this.buildToolbar();
  }

  // ───────────────────────────── Thanh công cụ và tab ─────────────────────────────

  private buildToolbar(): void {
    const seed = h('input', {
      type: 'text',
      class: 'seed',
      value: this.seedText,
      title: 'Seed: số hoặc chữ bất kỳ. Cùng seed cho cùng thế giới và cùng diễn biến.',
      onchange: (event: Event) => (this.seedText = (event.target as HTMLInputElement).value || '1'),
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          this.seedText = (event.target as HTMLInputElement).value || '1';
          this.restart();
        }
      },
    });
    const scenario = h(
      'select',
      {
        title: 'Kịch bản',
        onchange: (event: Event) => {
          this.scenario = (event.target as HTMLSelectElement).value as Scenario;
          this.restart();
        },
      },
      h('option', { value: 'default', selected: this.scenario === 'default' }, 'Hệ sinh thái đầy đủ'),
      h(
        'option',
        { value: 'lotka-volterra', selected: this.scenario === 'lotka-volterra' },
        'Thí nghiệm Lotka–Volterra',
      ),
    );
    setChildren(
      this.toolbar,
      h('div', { class: 'brand' }, '🌿 My Habitat', h('small', {}, 'hệ sinh thái tiến hoá')),
      h(
        'button',
        { class: this.paused ? 'active' : '', onclick: () => this.togglePause(), title: 'Phím cách' },
        this.paused ? '▶ Chạy tiếp' : '⏸ Tạm dừng',
      ),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Tốc độ' },
        ...SPEEDS.map((speed, index) =>
          h(
            'button',
            {
              class: index === this.speedIndex ? 'active' : '',
              onclick: () => {
                this.speedIndex = index;
                this.paused = false;
                this.applySpeed();
                this.buildToolbar();
              },
            },
            speed.label,
          ),
        ),
      ),
      h(
        'button',
        {
          class: this.drawing ? '' : 'active',
          title: 'Tắt vẽ để mô phỏng chạy nhanh nhất; biểu đồ vẫn cập nhật',
          onclick: () => {
            this.drawing = !this.drawing;
            this.pausedNote.hidden = this.drawing;
            this.buildToolbar();
          },
        },
        this.drawing ? 'Không vẽ' : 'Đang tắt vẽ',
      ),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Chế độ hiển thị' },
        h(
          'button',
          { class: this.mode === '2d' ? 'active' : '', onclick: () => void this.setMode('2d') },
          '2D',
        ),
        h(
          'button',
          { class: this.mode === '3d' ? 'active' : '', onclick: () => void this.setMode('3d') },
          '3D',
        ),
      ),
      h('div', { class: 'spacer' }),
      h('label', { class: 'inline' }, 'Seed', seed),
      h(
        'button',
        { onclick: () => this.restart(), title: 'Khởi tạo lại thế giới từ seed' },
        '↻ Khởi tạo lại',
      ),
      scenario,
      h(
        'button',
        { onclick: () => this.exportCsv(), title: 'Tải chuỗi thời gian quần thể, gen và cây phân loài' },
        '⬇ Xuất CSV',
      ),
    );
  }

  private buildTabs(): void {
    setChildren(
      this.tabBar,
      ...this.panels.map((panel, index) =>
        h(
          'button',
          { class: index === this.activePanel ? 'active' : '', onclick: () => this.showPanel(index) },
          panel.title,
        ),
      ),
    );
    setChildren(this.panelHost, this.panels[this.activePanel].element);
    this.panels[this.activePanel].update();
  }

  showPanel(index: number): void {
    this.activePanel = index;
    this.buildTabs();
  }

  showPanelById(id: string): void {
    const index = this.panels.findIndex((panel) => panel.id === id);
    if (index >= 0) this.showPanel(index);
  }

  // ───────────────────────────── Hiển thị ─────────────────────────────

  /** Đổi giữa 2D và 3D khi đang chạy. Mô phỏng không biết gì về việc này. */
  async setMode(mode: '2d' | '3d'): Promise<void> {
    if (mode === this.mode) return;
    if (mode === '3d' && !this.renderer3d) {
      // Three.js chỉ được tải khi người dùng thật sự bật 3D.
      const module = await import('../render3d/renderer3d');
      this.renderer3d = new module.Renderer3D((x, y) => this.handleMapClick(x, y));
      if (this.meta) this.renderer3d.setWorld(this.meta);
    }
    const next = mode === '3d' ? this.renderer3d! : this.renderer2d;
    this.renderer.canvas.replaceWith(next.canvas);
    this.renderer = next;
    this.mode = mode;
    this.renderer.setFollow(this.follow);
    this.resize();
    this.lastFieldsRequest = 0;
    this.buildToolbar();
  }

  private resize(): void {
    const rect = this.viewport.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height, Math.min(2, window.devicePixelRatio || 1));
  }

  /**
   * Đo tốc độ khung hình thật (theo requestAnimationFrame) trong `seconds` giây.
   * Trả về FPS trung bình, khung hình chậm nhất, và thời gian CPU trung bình của lời gọi vẽ.
   */
  measureFps(
    seconds: number,
  ): Promise<{ fps: number; worstFrameMs: number; renderMs: number; animals: number }> {
    return new Promise((resolve) => {
      const stamps: number[] = [];
      let renderTotal = 0;
      this.frameProbe = (now, renderMs) => {
        stamps.push(now);
        renderTotal += renderMs;
        if (now - stamps[0] < seconds * 1000) return;
        this.frameProbe = null;
        let worst = 0;
        for (let k = 1; k < stamps.length; k++) worst = Math.max(worst, stamps[k] - stamps[k - 1]);
        resolve({
          fps: ((stamps.length - 1) * 1000) / (stamps[stamps.length - 1] - stamps[0]),
          worstFrameMs: worst,
          renderMs: renderTotal / stamps.length,
          animals: this.snapshot?.count ?? 0,
        });
      };
    });
  }

  private frameProbe: ((now: number, renderMs: number) => void) | null = null;

  private frame(now: number): void {
    requestAnimationFrame((time) => this.frame(time));
    this.frames++;
    if (now - this.fpsWindowStart >= 500) {
      this.fps = (this.frames * 1000) / (now - this.fpsWindowStart);
      this.frames = 0;
      this.fpsWindowStart = now;
    }
    if (!this.meta) return;
    if (this.drawing) {
      // Trường (cỏ, nước…) đổi chậm nên chỉ xin kèm ~2 lần/giây.
      const wantFields = now - this.lastFieldsRequest > 450;
      if (wantFields) this.lastFieldsRequest = now;
      this.client.requestFrame(wantFields);
      if (this.snapshot) {
        // Nội suy theo vận tốc giữa hai tick; khi mô phỏng chạy nhanh hơn khung hình thì không cần.
        const target = this.perf.targetTicksPerSecond;
        const alpha =
          this.paused || target > 90
            ? 0
            : Math.min(1.5, this.tickFraction + ((now - this.snapshotTime) / 1000) * target);
        const start = performance.now();
        this.renderer.render(this.snapshot, alpha, now / 1000, this.selectedId);
        const elapsed = performance.now() - start;
        this.renderMs = this.renderMs === 0 ? elapsed : this.renderMs * 0.9 + elapsed * 0.1;
        this.frameProbe?.(now, elapsed);
      }
    }
  }

  /** Cập nhật chậm (4 lần/giây): HUD, bảng đang mở, thông tin cá thể đang chọn. */
  private slowUpdate(): void {
    const latest = this.history?.latest;
    if (latest && this.meta) {
      const climate = latest.climate;
      const weather = climate.drought
        ? '🏜 hạn hán'
        : climate.rain > 0
          ? '🌧 mưa'
          : climate.daylight < 0.15
            ? '🌙 đêm'
            : '☀ nắng';
      let animals = 0;
      for (const count of latest.populations) animals += count;
      setChildren(
        this.hudDate,
        h('b', {}, formatDate(latest.tick)),
        h('span', { class: 'muted' }, ` · tick ${latest.tick.toLocaleString('vi-VN')}`),
        h('br'),
        `${weather} · ${climate.temperature.toFixed(1)} °C · ${animals.toLocaleString('vi-VN')} cá thể`,
      );
    }
    const actual = this.perf.ticksPerSecond;
    this.hudPerf.textContent =
      `${this.drawing ? `${this.fps.toFixed(0)} FPS · vẽ ${this.renderMs.toFixed(1)} ms · ` : ''}` +
      `tick ${this.perf.tickMs.toFixed(2)} ms · ${actual.toFixed(0)} tick/s` +
      (this.mode === '2d'
        ? ' · cuộn để zoom, kéo để di chuyển, bấm để chọn'
        : ' · kéo để xoay, cuộn để zoom, chuột phải để dời');
    if (!this.drawing) this.client.requestFrame(false); // vẫn cần perf và số liệu mới cho HUD
    if (this.selectedId !== 0) this.client.inspect(this.selectedId);
    this.panels[this.activePanel].update();
  }

  // ───────────────────────────── Tương tác ─────────────────────────────

  private handleMapClick(screenX: number, screenY: number): void {
    if (!this.snapshot) return;
    if (this.tool) {
      const point = this.renderer.screenToWorld(screenX, screenY);
      if (!point) return;
      if (this.tool.kind === 'fire') this.sendEvent({ type: 'fire', x: point.x, y: point.y });
      else {
        this.sendEvent({
          type: 'invasive',
          species: this.tool.species,
          count: this.tool.count,
          x: point.x,
          y: point.y,
        });
        this.setTool(null);
      }
      return;
    }
    const id = this.renderer.pick(this.snapshot, screenX, screenY);
    this.select(id);
    if (id !== 0) this.showPanelById('inspector');
  }

  /** Chọn một cá thể theo mã định danh (0 = bỏ chọn). */
  select(id: number): void {
    this.selectedId = id;
    this.inspectInfo = null;
    if (id === 0) this.setFollow(false);
    else this.client.inspect(id);
  }

  setFollow(follow: boolean): void {
    this.follow = follow;
    this.renderer.setFollow(follow);
  }

  get following(): boolean {
    return this.follow;
  }

  /** Đưa camera tới cá thể đang chọn. */
  focusSelected(): void {
    if (this.inspectInfo?.alive) this.renderer.lookAt(this.inspectInfo.x, this.inspectInfo.y);
  }

  setTool(tool: MapTool): void {
    this.tool = tool;
    this.viewport.classList.toggle('tool', tool !== null);
    this.hudTool.hidden = tool === null;
    if (tool) {
      this.hudTool.textContent =
        tool.kind === 'fire'
          ? '🔥 Bấm lên bản đồ để châm lửa (Esc để thôi)'
          : '🐗 Bấm lên bản đồ để thả loài xâm lấn (Esc để thôi)';
    }
  }

  get activeTool(): MapTool {
    return this.tool;
  }

  sendEvent(event: SimEvent): void {
    this.client.sendEvent(event);
  }

  /** Màu đại diện của một loài động vật theo chỉ số. */
  speciesColor(index: number): string {
    return SPECIES_COLORS[this.meta?.animals[index]?.key ?? ''] ?? '#ccc';
  }

  private exportCsv(): void {
    if (!this.history) return;
    const seed = this.meta?.seed ?? 0;
    download(`habitat-seed${seed}-timeseries.csv`, this.history.toCsv());
    download(`habitat-seed${seed}-lineages.csv`, this.history.lineagesCsv());
  }
}
