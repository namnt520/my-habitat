import { PARAM_RANGES, type SimParams } from '../../sim/params';
import type { App, Panel } from '../app';
import { h, setChildren } from '../dom';

type NumericParam = keyof typeof PARAM_RANGES;

/** Thanh trượt tham số khi đang chạy và các nút thảm hoạ. */
export class ControlsPanel implements Panel {
  readonly id = 'controls';
  readonly title = 'Điều khiển';
  readonly element = h('div');
  private built = false;
  private diseaseSpecies = 'rabbit';
  private diseaseFraction = 0.3;
  private invasiveSpecies = 'boar';
  private invasiveCount = 20;
  private droughtYears = 0.5;
  private toolButtons: HTMLElement[] = [];

  constructor(private readonly app: App) {}

  reset(): void {
    this.built = false;
  }

  private slider(key: NumericParam, params: SimParams): HTMLElement {
    const range = PARAM_RANGES[key];
    const output = h('output', {}, String(params[key]));
    return h(
      'div',
      { class: 'slider-row' },
      h('label', {}, range.label),
      h('input', {
        type: 'range',
        min: String(range.min),
        max: String(range.max),
        step: String(range.step),
        value: String(params[key]),
        oninput: (event: Event) => {
          const value = Number((event.target as HTMLInputElement).value);
          output.textContent = String(value);
          this.app.client.setParam(key, value);
        },
      }),
      output,
    );
  }

  update(): void {
    const meta = this.app.meta;
    if (!meta) return;
    if (this.built) {
      // Chỉ cần cập nhật trạng thái nút công cụ.
      const tool = this.app.activeTool;
      this.toolButtons[0]?.classList.toggle('active', tool?.kind === 'fire');
      this.toolButtons[1]?.classList.toggle('active', tool?.kind === 'invasive');
      return;
    }
    this.built = true;
    const starting = meta.animals.filter((species) => species.starting);
    const invasive = meta.animals.filter((species) => !species.starting);
    const fireButton = h(
      'button',
      {
        class: 'danger',
        onclick: () => this.app.setTool(this.app.activeTool?.kind === 'fire' ? null : { kind: 'fire' }),
      },
      '🔥 Châm lửa (bấm lên bản đồ)',
    );
    const invasiveButton = h(
      'button',
      {
        class: 'danger',
        onclick: () =>
          this.app.setTool(
            this.app.activeTool?.kind === 'invasive'
              ? null
              : { kind: 'invasive', species: this.invasiveSpecies, count: this.invasiveCount },
          ),
      },
      '🐗 Thả (bấm lên bản đồ)',
    );
    this.toolButtons = [fireButton, invasiveButton];

    setChildren(
      this.element,
      h('h3', {}, 'Tham số (đổi được khi đang chạy)'),
      ...(Object.keys(PARAM_RANGES) as NumericParam[]).map((key) => this.slider(key, meta.params)),
      h(
        'p',
        { class: 'note' },
        'Mọi thay đổi có hiệu lực ngay ở tick kế tiếp. Ví dụ: hạ nhiệt độ để xem gen chịu lạnh và kích thước cơ thể dịch chuyển qua vài chục thế hệ.',
      ),

      h('h3', {}, 'Thảm hoạ'),
      h(
        'div',
        { class: 'card' },
        h('h4', {}, '🏜 Hạn hán'),
        h(
          'p',
          { class: 'note' },
          'Không mưa, hồ ao cạn dần, cỏ khô. Sông lộ ra các chỗ cạn — hai bờ có thể trao đổi gen.',
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'select',
            {
              onchange: (event: Event) =>
                (this.droughtYears = Number((event.target as HTMLSelectElement).value)),
            },
            h('option', { value: '0.25' }, '1 mùa'),
            h('option', { value: '0.5', selected: true }, 'nửa năm'),
            h('option', { value: '1' }, '1 năm'),
          ),
          h(
            'button',
            {
              class: 'danger',
              onclick: () =>
                this.app.sendEvent({ type: 'drought', duration: Math.round(this.droughtYears * 2400) }),
            },
            'Gây hạn',
          ),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h4', {}, '🌊 Lũ lụt'),
        h(
          'p',
          { class: 'note' },
          'Mưa lớn liên tục, mực nước dâng; thú không biết bơi kẹt trong nước sẽ chết đuối.',
        ),
        h(
          'button',
          { class: 'danger', onclick: () => this.app.sendEvent({ type: 'flood', duration: 500 }) },
          'Gây lũ',
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h4', {}, '🔥 Cháy rừng'),
        h(
          'p',
          { class: 'note' },
          'Lửa lan theo nhiên liệu (cỏ, bụi, mùn, tán rừng) và độ khô; tro trả dinh dưỡng về đất.',
        ),
        fireButton,
      ),
      h(
        'div',
        { class: 'card' },
        h('h4', {}, '🦠 Dịch bệnh'),
        h(
          'p',
          { class: 'note' },
          'Lây qua tiếp xúc gần trong cùng loài; con khỏi bệnh được miễn dịch. Quần thể càng dày dịch càng lan nhanh.',
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'select',
            { onchange: (event: Event) => (this.diseaseSpecies = (event.target as HTMLSelectElement).value) },
            ...starting.map((species) =>
              h(
                'option',
                { value: species.key, selected: species.key === this.diseaseSpecies },
                species.name,
              ),
            ),
          ),
          h(
            'select',
            {
              onchange: (event: Event) =>
                (this.diseaseFraction = Number((event.target as HTMLSelectElement).value)),
            },
            h('option', { value: '0.05' }, 'nhiễm 5%'),
            h('option', { value: '0.3', selected: true }, 'nhiễm 30%'),
            h('option', { value: '0.8' }, 'nhiễm 80%'),
          ),
          h(
            'button',
            {
              class: 'danger',
              onclick: () =>
                this.app.sendEvent({
                  type: 'disease',
                  species: this.diseaseSpecies,
                  fraction: this.diseaseFraction,
                }),
            },
            'Phát dịch',
          ),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h4', {}, '🐗 Loài xâm lấn'),
        h(
          'p',
          { class: 'note' },
          'Thả một loài không có trong quần xã ban đầu. Loài này được định nghĩa hoàn toàn bằng dữ liệu (file JSON), dùng lại các module hành vi có sẵn.',
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'select',
            {
              onchange: (event: Event) => (this.invasiveSpecies = (event.target as HTMLSelectElement).value),
            },
            ...invasive.map((species) => h('option', { value: species.key }, species.name)),
          ),
          h(
            'select',
            {
              onchange: (event: Event) =>
                (this.invasiveCount = Number((event.target as HTMLSelectElement).value)),
            },
            h('option', { value: '8' }, '8 con'),
            h('option', { value: '20', selected: true }, '20 con'),
            h('option', { value: '60' }, '60 con'),
          ),
          invasiveButton,
        ),
      ),
    );
  }
}
