// DOM HUD: hole info, power bar, flash messages, next-hole loading card, final scorecard.
import { style } from './engine/style.ts';

export interface HudState {
  hole: number;
  holes: number;
  name: string;
  par: number;
  strokes: number;
  total: number;
}

export interface ScoreRow {
  hole: number;
  par: number;
  strokes: number;
}

export interface Hud {
  update(s: HudState): void;
  power(p: number): void;
  flash(text: string): void;
  /** Next-hole loading card with progress 0..1 (only shown when the player outruns the background prefetch); null hides it. */
  loading(progress: number | null): void;
  scorecard(rows: readonly ScoreRow[]): void;
  hideScorecard(): void;
}

export function createHud(root: HTMLElement): Hud {
  const accent = style.palette['accent'] ?? '#e4572e';
  root.innerHTML = `
    <div style="position:absolute;top:16px;left:16px;background:#0006;padding:10px 14px;border-radius:10px;font-size:15px;line-height:1.4">
      <div id="h-title" style="font-weight:700;font-size:18px"></div>
      <div id="h-info"></div>
    </div>
    <div style="position:absolute;bottom:22px;left:50%;transform:translateX(-50%);width:240px;height:12px;background:#0005;border-radius:6px;overflow:hidden">
      <div id="h-power" style="height:100%;width:0;background:${accent}"></div>
    </div>
    <div id="h-flash" style="position:absolute;top:28%;width:100%;text-align:center;font-size:44px;font-weight:800;opacity:0;transition:opacity .4s"></div>
    <div id="h-loading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:none;background:#000a;padding:14px 22px;border-radius:12px;text-align:center;font-size:15px">
      <div>Loading next island…</div>
      <div style="margin-top:8px;width:200px;height:8px;border-radius:4px;background:#fff3;overflow:hidden"><div id="h-loading-bar" style="height:100%;width:0;background:${accent}"></div></div>
    </div>
    <div id="h-card" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#0007"></div>
    <div style="position:absolute;bottom:44px;width:100%;text-align:center;font-size:13px;opacity:.85">
      drag back to putt · ←/→ aim, hold Space for power · C camera · R restart hole · M sound
    </div>`;
  const $ = (id: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (!el) throw new Error(`hud: #${id} missing`);
    return el;
  };
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    update(s) {
      $('h-title').textContent = `Hole ${s.hole}/${s.holes} · ${s.name}`;
      $('h-info').textContent = `Par ${s.par} · Strokes ${s.strokes} · Total ${s.total}`;
    },
    power(p) {
      $('h-power').style.width = `${Math.round(p * 100)}%`;
    },
    flash(text) {
      const el = $('h-flash');
      el.textContent = text;
      el.style.opacity = '1';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => (el.style.opacity = '0'), 1400);
    },
    loading(progress) {
      $('h-loading').style.display = progress === null ? 'none' : 'block';
      if (progress !== null) $('h-loading-bar').style.width = `${Math.round(progress * 100)}%`;
    },
    scorecard(rows) {
      const total = rows.reduce((s, r) => s + r.strokes, 0);
      const par = rows.reduce((s, r) => s + r.par, 0);
      const diff = total - par;
      $('h-card').style.display = 'flex';
      $('h-card').innerHTML = `
        <div style="background:#fffaf0;color:#2b2d42;padding:24px 32px;border-radius:14px;min-width:260px;text-align:center">
          <div style="font-size:26px;font-weight:800;margin-bottom:12px">Round complete</div>
          <table style="width:100%;border-collapse:collapse;font-size:16px">
            <tr><th align="left">Hole</th><th>Par</th><th>Strokes</th></tr>
            ${rows.map((r) => `<tr><td align="left">${r.hole}</td><td>${r.par}</td><td>${r.strokes}</td></tr>`).join('')}
            <tr style="border-top:2px solid #2b2d42;font-weight:700"><td align="left">Total</td><td>${par}</td><td>${total}</td></tr>
          </table>
          <div style="margin-top:12px;font-size:20px;color:${accent};font-weight:700">${diff === 0 ? 'Even par' : diff < 0 ? `${diff} under par!` : `+${diff} over par`}</div>
          <div style="margin-top:8px;font-size:13px">Press R to play again</div>
        </div>`;
    },
    hideScorecard() {
      $('h-card').style.display = 'none';
    },
  };
}
