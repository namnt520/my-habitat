import { STATE_LABELS } from '../../sim/entities';
import { BODY_LENGTH } from '../../render/common';
import { type CreatureLook, drawCreature } from '../../render2d/creatures';
import type { App, Panel } from '../app';
import { prepareCanvas } from '../charts';
import { formatDate, h, setChildren } from '../dom';

function bar(fraction: number, color: string, mark?: number): HTMLElement {
  return h(
    'div',
    { class: 'bar' },
    h('span', { style: { width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: color } }),
    mark !== undefined ? h('em', { style: { left: `${Math.max(0, Math.min(1, mark)) * 100}%` } }) : null,
  );
}

/** Thông tin của cá thể đang được chọn: chân dung vẽ từ gen, trạng thái, bộ gen (hai alen), phả hệ. */
export class InspectorPanel implements Panel {
  readonly id = 'inspector';
  readonly title = 'Cá thể';
  readonly element = h('div');
  private readonly portrait = h('canvas', { class: 'portrait' });
  private readonly body = h('div');
  private built = false;

  constructor(private readonly app: App) {}

  update(): void {
    const info = this.app.inspectInfo;
    const meta = this.app.meta;
    if (!meta || this.app.selectedId === 0 || !info) {
      this.built = false;
      setChildren(
        this.element,
        h('h3', {}, 'Cá thể'),
        h(
          'p',
          {},
          this.app.selectedId === 0
            ? 'Bấm vào một con vật trên bản đồ để xem gen, trạng thái và phả hệ của nó.'
            : 'Đang tải…',
        ),
        h(
          'p',
          { class: 'note' },
          'Mẹo: zoom gần (cuộn chuột) để thấy ngoại hình từng con — chân dài theo gen tốc độ, mắt to theo gen tầm nhìn, lông xù theo gen chịu lạnh, màu lông theo gen sắc độ và độ sáng.',
        ),
      );
      return;
    }
    if (!this.built) {
      setChildren(
        this.element,
        h(
          'div',
          { class: 'row', style: { alignItems: 'flex-start' } },
          this.portrait,
          h('div', { style: { flex: '1' } }, this.body),
        ),
      );
      this.element.append(h('div', { id: 'inspector-rest' }));
      this.built = true;
    }
    const species = meta.animals[info.speciesIndex];
    setChildren(
      this.body,
      h('h4', { style: { margin: '0 0 4px', fontSize: '15px' } }, `${info.lineageName} #${info.id}`),
      h(
        'div',
        { class: 'muted' },
        `${info.sex} · ${info.alive ? STATE_LABELS[info.state] : 'đã chết'}${info.pregnant ? ' · đang mang thai' : ''}${info.sick ? ' · đang bệnh' : ''}`,
      ),
      h('div', { class: 'muted' }, `Thế hệ ${info.generation} · ${species.role}`),
      info.alive
        ? h(
            'div',
            { class: 'row' },
            h('button', { onclick: () => this.app.focusSelected() }, 'Tới chỗ nó'),
            h(
              'button',
              {
                class: this.app.following ? 'active' : '',
                onclick: () => this.app.setFollow(!this.app.following),
              },
              this.app.following ? 'Đang bám theo' : 'Bám theo',
            ),
            h('button', { onclick: () => this.app.select(0) }, 'Bỏ chọn'),
          )
        : h('button', { onclick: () => this.app.select(0) }, 'Bỏ chọn'),
    );

    const rest = this.element.querySelector('#inspector-rest') as HTMLElement;
    const ancestorCell = (ancestor: { id: number; born: number; died: number }): HTMLElement =>
      ancestor.id === 0
        ? h('span', { class: 'muted' }, 'không rõ')
        : h(
            'span',
            {
              class: 'link',
              title: `Sinh ${formatDate(ancestor.born)}${ancestor.died >= 0 ? `, chết ${formatDate(ancestor.died)}` : ', còn sống'}`,
              onclick: () => this.app.select(ancestor.id),
            },
            `#${ancestor.id}${ancestor.died >= 0 ? ' †' : ''}`,
          );
    const parents = info.ancestors[0];
    const grandparents = info.ancestors[1];
    setChildren(
      rest,
      info.alive
        ? h(
            'div',
            {},
            h('h3', {}, 'Trạng thái'),
            h(
              'div',
              { class: 'kv' },
              ...[
                [
                  'Năng lượng',
                  bar(info.energy / info.capacity, '#f2c94c'),
                  `${info.energy.toFixed(1)} / ${info.capacity.toFixed(1)} E`,
                ],
                ['Nước', bar(info.water, '#56ccf2'), `${(info.water * 100).toFixed(0)}%`],
                ['Sức khoẻ', bar(info.health, '#6fcf97'), `${(info.health * 100).toFixed(0)}%`],
                [
                  'Tuổi',
                  bar(info.age / info.lifespan, '#bb6bd9'),
                  `${info.age.toFixed(0)} / ~${info.lifespan} tick`,
                ],
                [
                  'Khối lượng',
                  bar(info.structure / (species.mass * 1.7), '#bdbdbd'),
                  `${info.structure.toFixed(1)} E`,
                ],
              ].flatMap(([label, cell, text]) => [
                h('span', {}, label as string),
                cell as HTMLElement,
                h('span', { class: 'muted' }, text as string),
              ]),
            ),
          )
        : h(
            'p',
            { class: 'note' },
            `Cá thể này đã chết (sống được ${info.age.toFixed(0)} tick). Phả hệ vẫn được lưu.`,
          ),
      info.genes.length > 0 ? h('h3', {}, 'Bộ gen (thanh: kiểu hình; hai vạch trắng: hai alen)') : null,
      info.genes.length > 0
        ? h(
            'div',
            { class: 'kv' },
            ...info.genes.flatMap((gene) => {
              const span = gene.max - gene.min;
              const cell = bar(
                (gene.value - gene.min) / span,
                this.app.speciesColor(info.speciesIndex),
                (gene.alleles[0] - gene.min) / span,
              );
              cell.append(
                h('em', {
                  style: { left: `${Math.max(0, Math.min(1, (gene.alleles[1] - gene.min) / span)) * 100}%` },
                }),
              );
              return [h('span', {}, gene.label), cell, h('span', { class: 'muted' }, gene.value.toFixed(3))];
            }),
          )
        : null,
      h('h3', {}, 'Phả hệ'),
      parents
        ? h(
            'table',
            { class: 'data' },
            h('tr', {}, h('th', {}, ''), h('th', {}, 'Mẹ'), h('th', {}, 'Bố')),
            h(
              'tr',
              {},
              h('td', {}, 'Bố mẹ'),
              h('td', {}, ancestorCell(parents[0])),
              h('td', {}, ancestorCell(parents[1])),
            ),
            grandparents
              ? h(
                  'tr',
                  {},
                  h('td', {}, 'Ông bà ngoại'),
                  h('td', {}, ancestorCell(grandparents[0])),
                  h('td', {}, ancestorCell(grandparents[1])),
                )
              : null,
            grandparents
              ? h(
                  'tr',
                  {},
                  h('td', {}, 'Ông bà nội'),
                  h('td', {}, ancestorCell(grandparents[2])),
                  h('td', {}, ancestorCell(grandparents[3])),
                )
              : null,
          )
        : h('p', { class: 'note' }, 'Thuộc quần thể khởi tạo (không có bố mẹ trong mô phỏng).'),
      info.alive ? h('p', { class: 'note' }, `Con cháu trực tiếp còn sống: ${info.offspringAlive}.`) : null,
    );

    // Chân dung: vẽ bằng đúng hàm vẽ của renderer 2D, phóng to cho vừa khung.
    if (info.genes.length >= 7) {
      const { ctx, width, height } = prepareCanvas(this.portrait);
      const value = (name: string, fallback: number): number =>
        info.genes.find((gene) => gene.name === name)?.value ?? fallback;
      const special = info.genes[7];
      const adultMass = species.mass * value('size', 1);
      const look: CreatureLook = {
        shape: species.shape,
        length: 1,
        hue: value('hue', 0.1),
        saturation: species.saturation,
        lightness: value('lightness', 0.5),
        speed: value('speed', 1),
        vision: value('vision', 1),
        cold: value('coldTolerance', 0.5),
        special: special ? (special.value - special.min) / (special.max - special.min) : 0.5,
        male: info.sex === 'đực',
        juvenile: info.structure < 0.75 * adultMass,
        pregnant: info.pregnant,
        sick: info.sick,
        state: 1,
        motion: 1,
        phase: performance.now() / 160,
      };
      const base = BODY_LENGTH[species.shape] ?? 5;
      const bird = species.shape === 'eagle' || species.shape === 'vulture';
      // Kích thước chân dung tỉ lệ với kích thước thật tương đối trong loài (con non nhỏ hơn).
      look.length =
        (bird ? 34 : 58) *
        Math.min(1.25, Math.max(0.45, Math.cbrt(info.structure / species.mass))) *
        (base > 12 ? 0.92 : 1);
      ctx.translate(width / 2 - look.length * 0.1, height / 2);
      ctx.rotate(-0.25);
      drawCreature(ctx, look);
    }
  }
}
