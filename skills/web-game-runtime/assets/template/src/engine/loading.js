// Loading screen with a progress bar. Every game boots through it: load assets → physics → prewarm, then reveal.
//
//   const loading = createLoadingScreen({ title: 'My Game' });
//   const models = await loading.step('Loading models', 0.5, (p) => loadModels(names, p));
//   await loading.step('Compiling shaders', 0.4, (p) => prewarm(renderer, scene, camera, roots, p));
//   loading.done();
//
// step(label, weight, fn): fn receives a progress callback (0..1) for that step; weights are relative.
import { style } from './style.js';
import { TEST_MODE } from './renderer.js';

export function createLoadingScreen({ title = document.title } = {}) {
  const accent = style.palette?.accent ?? '#e4572e';
  const bg = style.background ?? '#222222';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255);
  const ink = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#1d1f2b' : '#ffffff'; // readable on any background
  const el = document.createElement('div');
  el.id = 'loading';
  el.style.cssText = `position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
    background:${bg};color:${ink};font-family:system-ui,sans-serif;transition:opacity .35s`;
  el.innerHTML = `
    <div style="font-size:32px;font-weight:800">${title}</div>
    <div style="width:min(60vw,360px);height:10px;border-radius:5px;background:${ink}22;overflow:hidden">
      <div id="loading-bar" style="height:100%;width:0;background:${accent};transition:width .15s"></div>
    </div>
    <div id="loading-label" style="font-size:13px;opacity:.85">Starting…</div>`;
  document.body.appendChild(el);
  const bar = el.querySelector('#loading-bar');
  const label = el.querySelector('#loading-label');

  const steps = []; // { weight, progress }
  const render = () => {
    const total = steps.reduce((s, x) => s + x.weight, 0) || 1;
    const done = steps.reduce((s, x) => s + x.weight * x.progress, 0);
    bar.style.width = `${Math.round((done / total) * 100)}%`;
  };
  const api = {
    progress: 0,
    async step(text, weight, fn) {
      const entry = { weight, progress: 0 };
      steps.push(entry);
      label.textContent = text;
      render();
      const result = await fn((p) => {
        entry.progress = Math.min(1, Math.max(0, p));
        render();
      });
      entry.progress = 1;
      render();
      await new Promise((r) => requestAnimationFrame(r)); // let the bar paint between steps
      return result;
    },
    done() {
      // in test mode remove instantly so screenshots never contain the overlay
      if (TEST_MODE) el.remove();
      else {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 400);
      }
    },
  };
  return api;
}

/**
 * Prewarm: compile every material/pipeline the game will use, including shadow-depth passes, before play.
 * Adds each root to the scene in turn (frustum culling off so off-camera objects compile too), compiles it,
 * renders warm-up frames (runs the shadow pass), then removes it. Lights must already be in the scene.
 */
export async function prewarm(renderer, scene, camera, roots, onProgress = () => {}, { frames = 2 } = {}) {
  for (const [i, root] of roots.entries()) {
    const culled = [];
    root.traverse((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
    });
    const wasInScene = root === scene || root.parent === scene;
    if (!wasInScene) scene.add(root);
    await renderer.compileAsync(scene, camera);
    for (let f = 0; f < frames; f++) {
      renderer.render(scene, camera);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (!wasInScene) scene.remove(root);
    for (const o of culled) o.frustumCulled = true;
    onProgress((i + 1) / roots.length);
  }
}
