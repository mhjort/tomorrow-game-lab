// Loading screen with a progress bar. Every game boots through it: load assets → physics → prewarm, then reveal.
//
//   const loading = createLoadingScreen({ title: 'My Game' });
//   const [{ renderer }, physics, models] = await loading.parallel('Loading…', [
//     { weight: 0.1, run: () => createRenderer() },
//     { weight: 0.2, run: () => createPhysics() },
//     { weight: 0.4, run: (p) => loadModels(names, p) },
//   ]);
//   await loading.step('Compiling shaders', 0.4, (p) => prewarm(renderer, scene, camera, roots, p));
//   loading.done();
//
// step(label, weight, fn): fn receives a progress callback (0..1) for that step; weights are relative.
// image: optional background under public/ (e.g. 'images/splash.webp' from generate-media); keep it small (≤150 KB),
// it is the first thing on screen. The title/bar sit on a translucent panel so they stay readable over art.
import type * as THREE from 'three/webgpu';
import type { Progress } from './assets.ts';
import { style } from './style.ts';
import { TEST_MODE } from './renderer.ts';

export interface Task<T> {
  weight: number;
  run: (progress: Progress) => T | Promise<T>;
}

export interface LoadingScreen {
  step<T>(text: string, weight: number, fn: (progress: Progress) => T | Promise<T>): Promise<T>;
  /**
   * Run weighted tasks concurrently under one label: [{ weight, run: (progress) => Promise }].
   * Use it for the download phase (renderer init, physics WASM, every model) so nothing waits on anything else.
   */
  parallel<const T extends readonly unknown[]>(text: string, tasks: { [K in keyof T]: Task<T[K]> }): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }>;
  done(): void;
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

export function createLoadingScreen({ title = document.title, image }: { title?: string; image?: string } = {}): LoadingScreen {
  const accent = style.palette['accent'] ?? '#e4572e';
  const bg = style.background;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255) as [number, number, number];
  const ink = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#1d1f2b' : '#ffffff'; // readable on any background
  const el = document.createElement('div');
  el.id = 'loading';
  el.style.cssText = `position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:${image ? 'flex-end;padding-bottom:9vh;box-sizing:border-box' : 'center'};gap:14px;
    background:${bg} ${image ? `url("${import.meta.env.BASE_URL}${image}") center/cover no-repeat` : ''};color:${ink};font-family:system-ui,sans-serif;transition:opacity .35s`;
  const panel = image ? `background:${bg}cc;padding:18px 28px;border-radius:14px;` : '';
  el.innerHTML = `<div style="${panel}display:flex;flex-direction:column;align-items:center;gap:14px">
    <div style="font-size:32px;font-weight:800">${title}</div>
    <div style="width:min(60vw,360px);height:10px;border-radius:5px;background:${ink}22;overflow:hidden">
      <div id="loading-bar" style="height:100%;width:0;background:${accent};transition:width .15s"></div>
    </div>
    <div id="loading-label" style="font-size:13px;opacity:.85">Starting…</div></div>`;
  document.body.appendChild(el);
  const bar = el.querySelector<HTMLElement>('#loading-bar')!;
  const label = el.querySelector<HTMLElement>('#loading-label')!;

  const steps: { weight: number; progress: number }[] = [];
  const render = () => {
    const total = steps.reduce((s, x) => s + x.weight, 0) || 1;
    const done = steps.reduce((s, x) => s + x.weight * x.progress, 0);
    bar.style.width = `${Math.round((done / total) * 100)}%`;
  };
  return {
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
      await nextFrame(); // let the bar paint between steps
      return result;
    },
    async parallel(text, tasks) {
      const list = tasks as readonly Task<unknown>[];
      const entries = list.map((t) => ({ weight: t.weight, progress: 0 }));
      steps.push(...entries);
      label.textContent = text;
      render();
      const results = await Promise.all(
        list.map((t, i) => {
          const entry = entries[i]!;
          return Promise.resolve(
            t.run((p) => {
              entry.progress = Math.min(1, Math.max(0, p));
              render();
            }),
          ).then((r) => {
            entry.progress = 1;
            render();
            return r;
          });
        }),
      );
      await nextFrame();
      // Promise.all over a mapped tuple loses the per-position types; they are restored by the signature.
      return results as never;
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
}

/**
 * Prewarm: compile every material/pipeline the game will use, including shadow-depth passes, before play.
 * Adds each root to the scene in turn (frustum culling off so off-camera objects compile too), compiles it,
 * renders warm-up frames (runs the shadow pass), then removes it. Lights must already be in the scene.
 */
export async function prewarm(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  roots: readonly THREE.Object3D[],
  onProgress: Progress = () => {},
  { frames = 2 } = {},
): Promise<void> {
  for (const [i, root] of roots.entries()) {
    const culled: THREE.Object3D[] = [];
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

/**
 * Background prewarm for a level that is NOT on screen yet (levels.ts uses it while the player plays another level):
 * compiles `root`'s materials with `scene`'s lights and fog without adding it to the scene or drawing anything.
 * three's compileAsync time-slices the work and yields to the game loop between items. Shadow-depth pipelines
 * are not covered (they compile on the first shadow pass); levels that reuse material setups share them anyway.
 */
export async function compileInBackground(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  root: THREE.Object3D,
  onProgress: Progress = () => {},
): Promise<void> {
  const culled: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.frustumCulled) {
      culled.push(o);
      o.frustumCulled = false;
    }
  });
  try {
    await renderer.compileAsync(root, camera, scene, (e) => onProgress(e.total ? e.loaded / e.total : 1));
  } finally {
    for (const o of culled) o.frustumCulled = true;
  }
  onProgress(1);
}
