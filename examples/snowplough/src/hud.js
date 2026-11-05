// DOM HUD: houses reached, the clock counting down to the festival, flash messages, intro and end cards.
import { style } from './engine/style.js';

const panel = 'background:#06183088;padding:10px 14px;border-radius:12px;backdrop-filter:blur(2px)';

export function createHud(root) {
  const gold = style.palette.window;
  root.innerHTML = `
    <div style="position:absolute;top:16px;left:16px;${panel};font-size:15px;line-height:1.35">
      <div style="font-weight:800;font-size:18px">Little Plough</div>
      <div id="h-houses"></div>
      <div id="h-square" style="opacity:.85"></div>
    </div>
    <div style="position:absolute;top:16px;right:16px;${panel};text-align:right">
      <div id="h-clock" style="font-size:30px;font-weight:800;font-variant-numeric:tabular-nums"></div>
      <div style="font-size:12px;opacity:.8">festival at 18:00</div>
    </div>
    <div id="h-flash" style="position:absolute;top:22%;width:100%;text-align:center;display:none"><span style="${panel};background:#061830cc;padding:8px 22px;font-size:34px;font-weight:800;color:${gold}"></span></div>
    <div id="h-card" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center"></div>
    <div style="position:absolute;bottom:18px;width:100%;text-align:center;font-size:13px;opacity:.85">
      ↑/W drive · ↓/S brake &amp; reverse · ←/→ steer · or drag anywhere like a joystick · C camera · R restart · M sound
    </div>`;
  const $ = (id) => root.querySelector(`#${id}`);
  const text = (id, v) => {
    const el = id === 'h-flash' ? $(id).firstElementChild : $(id);
    if (el.textContent !== v) el.textContent = v;
  };
  // end cards sit low, so the festival (or the empty square) stays visible above them
  const card = (html, low = false) => {
    $('h-card').style.display = 'flex';
    $('h-card').style.alignItems = low ? 'flex-end' : 'center';
    $('h-card').style.paddingBottom = low ? '56px' : '0';
    $('h-card').innerHTML = `<div style="${panel};background:#061830dd;padding:24px 32px;max-width:440px;text-align:center;font-size:16px;line-height:1.45">${html}</div>`;
  };
  return {
    update(s) {
      text('h-houses', `Paths cleared to ${s.reached} / ${s.total} houses`);
      text('h-square', `${s.arrived} at the lantern square`);
      const m = Math.floor(s.clock);
      text('h-clock', m >= 60 ? '18:00' : `17:${String(m).padStart(2, '0')}`);
      $('h-clock').style.color = s.timeLeft < 30 && s.phase === 'play' ? '#ff9a6a' : '#fff';
      // flash messages live in game ticks (deterministic screenshots), and never over the intro/end cards
      const show = s.flash && s.phase === 'play' ? 'block' : 'none';
      if ($('h-flash').style.display !== show) $('h-flash').style.display = show;
      if (s.flash) text('h-flash', s.flash);
    },
    intro() {
      card(`<div style="font-size:26px;font-weight:800;margin-bottom:8px">Little Plough</div>
        Snow buried the village. Plough a path from every door to the <b style="color:${gold}">lantern square</b>,
        so everyone gets to the festival by <b>18:00</b>.<br><br>
        A house's lamp lights when its path is clear.<br><br><b>Press ↑ or drag up to start</b>`);
    },
    end(s) {
      const won = s.phase === 'won';
      card(`<div style="font-size:26px;font-weight:800;margin-bottom:8px;color:${won ? gold : '#fff'}">${won ? 'The festival begins!' : '18:00'}</div>
        ${won ? `Everyone made it, with ${Math.ceil(s.timeLeft)} s to spare.` : `${s.arrived} of ${s.total} villagers made it to the square. ${s.total - s.arrived} stayed home.`}
        <div style="margin-top:12px;font-size:13px">Press R to play again</div>`, true);
    },
    hideCard() {
      $('h-card').style.display = 'none';
    },
  };
}
