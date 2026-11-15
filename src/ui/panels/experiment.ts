import { fitLotkaVolterra, integrateLotkaVolterra } from '../../analysis/lotka';
import type { App, Panel } from '../app';
import { drawLineChart } from '../charts';
import { formatYears, h, setChildren } from '../dom';

/**
 * Chế độ thí nghiệm: một cặp con mồi–kẻ săn trên đồng cỏ phẳng, không mùa, không thời tiết, không biến dị
 * di truyền. Dao động quần thể đo được được vẽ chồng lên nghiệm của hệ Lotka–Volterra đã khớp tham số.
 */
export class ExperimentPanel implements Panel {
  readonly id = 'experiment';
  readonly title = 'Thí nghiệm';
  readonly element = h('div');
  private readonly chart = h('canvas', { class: 'chart' });
  private readonly phase = h('canvas', { class: 'chart short' });
  private readonly result = h('div');
  private mode = '';

  constructor(private readonly app: App) {}

  reset(): void {
    this.mode = '';
  }

  update(): void {
    const { history, meta } = this.app;
    if (!history || !meta) return;
    if (meta.scenario !== 'lotka-volterra') {
      if (this.mode !== 'off') {
        this.mode = 'off';
        setChildren(
          this.element,
          h('h3', {}, 'So sánh với Lotka–Volterra'),
          h(
            'p',
            {},
            'Chế độ thí nghiệm tắt địa hình, mùa, thời tiết, cơn khát và biến dị di truyền; chỉ giữ cỏ, thỏ và cáo trên một đồng cỏ phẳng.',
          ),
          h(
            'p',
            {},
            'Dao động quần thể của mô phỏng sẽ được vẽ chồng lên nghiệm phương trình Lotka–Volterra có tham số khớp từ chính dữ liệu đó.',
          ),
          h(
            'button',
            {
              class: 'active',
              onclick: () => {
                this.app.scenario = 'lotka-volterra';
                this.app.restart();
              },
            },
            'Chuyển sang chế độ thí nghiệm',
          ),
        );
      }
      return;
    }
    if (this.mode !== 'on') {
      this.mode = 'on';
      setChildren(
        this.element,
        h('h3', {}, 'Mô phỏng (nét liền) và Lotka–Volterra (nét đứt)'),
        this.chart,
        h('h3', {}, 'Mặt phẳng pha: thỏ (ngang) – cáo (dọc)'),
        this.phase,
        this.result,
        h(
          'button',
          {
            onclick: () => {
              this.app.scenario = 'default';
              this.app.restart();
            },
          },
          'Quay lại hệ sinh thái đầy đủ',
        ),
      );
    }
    const prey = meta.animals.find((species) => species.key === 'rabbit')!;
    const predator = meta.animals.find((species) => species.key === 'fox')!;
    const time = history.ticks;
    const preySeries = history.populations[prey.index];
    const predatorSeries = history.populations[predator.index];
    const fit = time.length > 40 ? fitLotkaVolterra(time, preySeries, predatorSeries) : null;
    const series = [
      { label: 'Thỏ', color: this.app.speciesColor(prey.index), values: preySeries, width: 2 },
      { label: 'Cáo', color: this.app.speciesColor(predator.index), values: predatorSeries, width: 2 },
    ];
    if (fit && fit.alpha > 0 && fit.beta > 0 && fit.delta > 0 && fit.gamma > 0) {
      const model = integrateLotkaVolterra(fit, preySeries[0], predatorSeries[0], time);
      series.push(
        {
          label: 'Thỏ (L–V)',
          color: this.app.speciesColor(prey.index),
          values: model.prey,
          width: 1.2,
          dashed: true,
        } as never,
        {
          label: 'Cáo (L–V)',
          color: this.app.speciesColor(predator.index),
          values: model.predator,
          width: 1.2,
          dashed: true,
        } as never,
      );
    }
    drawLineChart(this.chart, { x: time, series, logScale: true, formatX: formatYears });
    // Mặt phẳng pha: vẽ quỹ đạo (thỏ, cáo) như một "chuỗi" có x là số thỏ.
    this.drawPhase(preySeries, predatorSeries);

    if (!fit) {
      setChildren(
        this.result,
        h(
          'p',
          { class: 'note' },
          'Cần thêm dữ liệu (ít nhất ~40 mẫu) để khớp tham số. Hãy để mô phỏng chạy ở ×10 hoặc ×100.',
        ),
      );
      return;
    }
    const valid = fit.alpha > 0 && fit.beta > 0 && fit.delta > 0 && fit.gamma > 0;
    setChildren(
      this.result,
      h('h3', {}, 'Tham số khớp được'),
      h(
        'table',
        { class: 'data' },
        h('tr', {}, h('th', {}, 'Tham số'), h('th', { class: 'num' }, 'Giá trị'), h('th', {}, 'Ý nghĩa')),
        h(
          'tr',
          {},
          h('td', {}, 'α'),
          h('td', { class: 'num' }, fit.alpha.toExponential(2)),
          h('td', {}, 'tăng trưởng của thỏ khi không có cáo (1/tick)'),
        ),
        h(
          'tr',
          {},
          h('td', {}, 'β'),
          h('td', { class: 'num' }, fit.beta.toExponential(2)),
          h('td', {}, 'tỉ lệ thỏ bị mỗi con cáo bắt'),
        ),
        h(
          'tr',
          {},
          h('td', {}, 'δ'),
          h('td', { class: 'num' }, fit.delta.toExponential(2)),
          h('td', {}, 'thỏ ăn được chuyển thành cáo con'),
        ),
        h(
          'tr',
          {},
          h('td', {}, 'γ'),
          h('td', { class: 'num' }, fit.gamma.toExponential(2)),
          h('td', {}, 'tử vong của cáo khi không có thỏ (1/tick)'),
        ),
        h(
          'tr',
          {},
          h('td', {}, 'R²'),
          h('td', { class: 'num' }, `${fit.r2Prey.toFixed(2)} / ${fit.r2Predator.toFixed(2)}`),
          h('td', {}, 'độ khớp của hồi quy (thỏ / cáo)'),
        ),
        valid
          ? h(
              'tr',
              {},
              h('td', {}, 'Chu kỳ'),
              h('td', { class: 'num' }, `${fit.period.toFixed(0)} tick`),
              h('td', {}, `≈ ${(fit.period / 2400).toFixed(2)} năm (dao động nhỏ)`),
            )
          : null,
        valid
          ? h(
              'tr',
              {},
              h('td', {}, 'N*, P*'),
              h(
                'td',
                { class: 'num' },
                `${fit.preyEquilibrium.toFixed(0)}, ${fit.predatorEquilibrium.toFixed(0)}`,
              ),
              h('td', {}, 'điểm cân bằng lý thuyết'),
            )
          : null,
      ),
      valid
        ? null
        : h(
            'p',
            { class: 'note' },
            'Hồi quy cho tham số trái dấu: dữ liệu hiện tại chưa có dạng dao động Lotka–Volterra (thường vì mới chạy được ít, hoặc một quần thể đang bị giới hạn bởi yếu tố khác).',
          ),
      h('h3', {}, 'Vì sao mô phỏng lệch khỏi Lotka–Volterra'),
      h(
        'p',
        { class: 'note' },
        'Lotka–Volterra giả định: thỏ tăng theo cấp số nhân không giới hạn, cáo bắt thỏ tỉ lệ thuận với số lần gặp (không bao giờ no), mọi cá thể trộn đều, không có tuổi, không có ngẫu nhiên. Mô phỏng vi phạm cả năm: ',
        '(1) thỏ bị cỏ giới hạn nên có sức chứa — biên độ dao động bị nén; ',
        '(2) cáo no thì ngừng săn và mỗi lần săn tốn thời gian (đáp ứng chức năng Holling II); ',
        '(3) cá thể có vị trí: thỏ bị ăn cạn theo từng vùng, cáo phải đi tìm — tạo độ trễ và sóng lan trong không gian; ',
        '(4) sinh sản có độ trễ (mang thai, lớn lên, dự trữ năng lượng) nên pha của cáo trễ hơn ¼ chu kỳ lý thuyết; ',
        '(5) quần thể hữu hạn nên có nhiễu ngẫu nhiên, và lãnh thổ của cáo chặn mật độ cáo. ',
        'Vì thế quỹ đạo trong mặt phẳng pha không phải vòng kín như Lotka–Volterra mà xoáy dần về một vùng cân bằng có nhiễu.',
      ),
    );
  }

  private drawPhase(prey: number[], predator: number[]): void {
    // Dùng biểu đồ đường với trục x là chỉ số, sau đó vẽ tay quỹ đạo để giữ code gọn.
    const canvas = this.phase;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const n = prey.length;
    if (n < 3) return;
    const maxPrey = Math.max(...prey) * 1.05;
    const maxPredator = Math.max(...predator) * 1.05;
    const pad = 10;
    ctx.lineWidth = 1.2;
    for (let k = 1; k < n; k++) {
      // Đoạn càng mới càng sáng.
      ctx.strokeStyle = `rgba(111, 207, 151, ${(0.15 + 0.85 * (k / n)).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(
        pad + (prey[k - 1] / maxPrey) * (width - 2 * pad),
        height - pad - (predator[k - 1] / maxPredator) * (height - 2 * pad),
      );
      ctx.lineTo(
        pad + (prey[k] / maxPrey) * (width - 2 * pad),
        height - pad - (predator[k] / maxPredator) * (height - 2 * pad),
      );
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(
      pad + (prey[n - 1] / maxPrey) * (width - 2 * pad),
      height - pad - (predator[n - 1] / maxPredator) * (height - 2 * pad),
      3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}
