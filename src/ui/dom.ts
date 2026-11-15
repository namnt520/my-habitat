/**
 * Tiện ích DOM nhỏ gọn (không dùng framework).
 */
type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** Tạo phần tử: h('button', { class: 'x', onclick: fn }, 'Nhãn'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else if (key.startsWith('on') && typeof value === 'function')
      element.addEventListener(key.slice(2), value as EventListener);
    else if (key in element) (element as unknown as Props)[key] = value;
    else element.setAttribute(key, String(value));
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Thay toàn bộ nội dung của một phần tử. */
export function setChildren(parent: HTMLElement, ...children: Child[]): void {
  parent.textContent = '';
  append(parent, children);
}

/** Tải một chuỗi văn bản về máy dưới dạng file. */
export function download(filename: string, text: string, mime = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = h('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SEASONS = ['Xuân', 'Hạ', 'Thu', 'Đông'];

/** "Năm 3 · Thu · ngày 2" từ số tick. */
export function formatDate(tick: number): string {
  const year = Math.floor(tick / 2400) + 1;
  const season = Math.floor((tick % 2400) / 600);
  const day = Math.floor((tick % 600) / 120) + 1;
  return `Năm ${year} · ${SEASONS[season]} · ngày ${day}`;
}

/** Nhãn trục thời gian ngắn: "N3.5" = năm thứ 3,5. */
export function formatYears(tick: number): string {
  return `năm ${(tick / 2400).toFixed(2)}`;
}
