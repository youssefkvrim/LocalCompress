import { STAGES, getScratchFile, reduction } from '@localcompress/core';
import { h, icon, replace } from './dom';
import type { Job } from './store';
import { cancel, discard, save } from './runner';
import { bytes, checkLabel, getLang, percent, reasonText, t } from './i18n';

/** One line per file: name · sizes · saving · action. Details on demand. */
export class JobCard {
  el: HTMLElement;
  private name = h('button', { class: 'row-name', type: 'button' });
  private sizes = h('span', { class: 'row-sizes' });
  private gain = h('span', { class: 'row-gain' });
  private action = h('div', { class: 'row-action' });
  private note = h('p', { class: 'row-note' });
  private bar = h('div', { class: 'row-bar' });
  private more = h('div', { class: 'row-more', hidden: true });
  private open = false;
  private key = '';
  private urls: string[] = [];
  private job: Job;

  constructor(job: Job) {
    this.job = job;
    this.name.textContent = job.file.name;
    this.name.title = job.file.name;
    this.name.addEventListener('click', () => this.toggle());
    this.el = h('li', { class: 'row' }, h('div', { class: 'row-main' }, this.name, this.sizes, this.gain, this.action), this.bar, this.note, this.more);
    this.update();
  }

  update() {
    const j = this.job;
    const r = j.result;
    this.el.dataset.state = j.state;
    this.el.dataset.result = r?.status ?? '';

    const idx = Math.max(0, STAGES.findIndex((s) => s.id === j.stage));
    const p = j.state === 'done' ? 1 : j.state === 'running' ? Math.min(0.98, (idx + j.progress) / STAGES.length) : 0;
    this.bar.style.setProperty('--p', String(p));
    if (j.state === 'running' || j.state === 'queued') {
      this.sizes.textContent = bytes(j.file.size);
      this.gain.textContent = j.state === 'queued' ? t('waiting') : `${Math.round(p * 100)}${getLang() === 'fr' ? ' %' : '%'}`;
    }

    const key = `${j.state}|${r?.status}|${this.open}`;
    if (key === this.key) return;
    this.key = key;

    if (r?.status === 'optimized') {
      this.sizes.textContent = `${bytes(r.inputSize)} → ${bytes(r.outputSize)}`;
      this.gain.textContent = percent(reduction(r.inputSize, r.outputSize));
      this.note.textContent = `${r.lossless ? `${t('lossless')} · ` : ''}${t('verified')} ✓`;
    } else if (r) {
      this.sizes.textContent = bytes(r.inputSize);
      this.gain.textContent = '—';
      this.note.textContent = reasonText(r.reason ?? (r.status === 'not-worth-it' ? 'already-optimal' : 'unsupported'));
    } else if (j.state === 'error') {
      this.gain.textContent = '—';
      this.note.textContent = j.errorReason ? reasonText(j.errorReason) : t('failed');
    } else if (j.state === 'cancelled') {
      this.gain.textContent = '—';
      this.note.textContent = t('cancelled');
    } else this.note.textContent = '';

    const btns: Node[] = [];
    if (r?.status === 'optimized') btns.push(h('button', { class: 'btn', type: 'button', onclick: () => void save(j) }, icon.down(), t('save')));
    if (j.state === 'running') btns.push(h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('cancel'), title: t('cancel'), onclick: () => cancel(j) }, icon.close()));
    else btns.push(h('button', { class: 'icon-btn subtle', type: 'button', 'aria-label': t('remove'), title: t('remove'), onclick: () => void this.remove() }, icon.close()));
    replace(this.action, ...btns);
    if (this.open) void this.renderMore();
  }

  private toggle() {
    if (!this.job.result && !this.job.error) return;
    this.open = !this.open;
    this.more.hidden = !this.open;
    this.el.classList.toggle('open', this.open);
    if (!this.open) this.revoke();
    this.update();
  }

  private async renderMore() {
    const r = this.job.result;
    const parts: Node[] = [];
    if (r?.preview && r.outputPath && !r.lossless) parts.push(await this.compare(r.outputPath));
    if (r) {
      parts.push(
        h(
          'dl',
          { class: 'facts' },
          h('dt', null, t('engine')),
          h('dd', null, r.engine),
          r.checks.length ? h('dt', null, t('checks')) : null,
          r.checks.length
            ? h('dd', null, h('ul', { class: 'checks' }, ...r.checks.map((c) => h('li', { class: c.ok ? 'ok' : 'bad' }, c.ok ? icon.check() : icon.close(), checkLabel(c.label)))))
            : null,
          r.sha256In ? h('dt', null, `SHA-256 · ${t('original')}`) : null,
          r.sha256In ? h('dd', { class: 'mono hash' }, r.sha256In) : null,
          r.sha256Out ? h('dt', null, `SHA-256 · ${t('result')}`) : null,
          r.sha256Out ? h('dd', { class: 'mono hash' }, r.sha256Out) : null,
        ),
      );
    } else if (this.job.error) parts.push(h('p', { class: 'mono hash' }, this.job.error));
    replace(this.more, ...parts);
  }

  /** Before / after slider (local blob: URLs only). */
  private async compare(path: string[]): Promise<Node> {
    this.revoke();
    const a = URL.createObjectURL(this.job.file);
    const b = URL.createObjectURL(await getScratchFile(path));
    this.urls.push(a, b);
    const wrap = h('div', { class: 'compare' });
    const range = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': `${t('before')} / ${t('after')}` }) as HTMLInputElement;
    const set = () => wrap.style.setProperty('--x', `${range.value}%`);
    range.addEventListener('input', set);
    set();
    wrap.append(
      h('img', { src: b, alt: t('after'), class: 'cmp-after', draggable: 'false' }),
      h('img', { src: a, alt: t('before'), class: 'cmp-before', draggable: 'false' }),
      h('div', { class: 'cmp-handle' }),
      range,
      h('span', { class: 'cmp-tag l' }, t('before')),
      h('span', { class: 'cmp-tag r' }, t('after')),
    );
    return wrap;
  }

  private revoke() {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
  }

  private async remove() {
    this.revoke();
    this.el.classList.add('leaving');
    await new Promise((r) => setTimeout(r, 200));
    await discard(this.job);
  }

  destroy() {
    this.revoke();
    this.el.remove();
  }
}
