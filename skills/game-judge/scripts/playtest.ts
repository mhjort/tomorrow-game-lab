#!/usr/bin/env node
// Headless Chrome playtest for web games that implement the window.__game contract.
//
// Scenario steps: {step:n} {input:{...}} {until:'expr',max} {assert:'expr'} {screenshot:name, compare?:'design/reference/x.png'}
//                 {key:'Space'|['ArrowUp','ArrowRight'],steps:n,release?} {keyUp:k} {drag:{from,to}} {eval:'js'}
//                 {script:'bots/x.ts',args}   (a .ts bot is type-stripped before it runs in the page)
//
// Usage: node playtest.ts [--project .] [--url http://...] [--scenarios tests/scenarios]
//                          [--backends webgpu,webgl2] [--size 1280x720] [--perf 3] [--headed]
//                          [--require-webgpu] [--parity-min 0.9] [--dev] [--out .lab/runs/<ts>]
//
// Without --url it serves the project with `vite preview` (if dist/ exists) or `vite` dev.
// Writes <out>/report.json, <out>/summary.md and screenshots; .lab/runs/latest -> <out>.
// Exit code: 0 all scenarios passed with no console errors, 1 otherwise, 2 setup failure.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import type { Browser, BrowserType, Page, Request } from 'playwright-core';

// ------------------------------------------------------------------ types
/** The window.__game contract (web-game-runtime testHooks.ts), as seen from the harness. */
interface GameHooks {
  ready: boolean;
  backend: string;
  step(n?: number): number;
  getState(): unknown;
  input(action: unknown): unknown;
  stats(): { frames: number; avgFrameMs: number; worstFrameMs: number };
}
// page.evaluate() callbacks run in the browser; this script is type-checked without the DOM lib.
declare const window: { __game: GameHooks };

interface Step {
  step?: number;
  input?: unknown;
  until?: string;
  max?: number;
  every?: number;
  assert?: string;
  screenshot?: string;
  compare?: string;
  key?: string | string[];
  steps?: number;
  release?: boolean;
  keyUp?: string | string[];
  drag?: { from: [number, number]; to: [number, number]; hold?: number; release?: boolean };
  pointerUp?: unknown;
  eval?: string;
  script?: string;
  args?: unknown;
}
interface Scenario {
  name: string;
  steps: Step[];
}
interface NetworkEntry {
  file: string;
  type: string;
  start: number;
  end: number;
  kb: number | null;
}
interface StepRecord extends Step {
  i: number;
  tick?: number;
  result?: unknown;
  ok?: boolean;
  failed?: string;
  state?: unknown;
  stateAfter?: unknown;
}
interface ScenarioResult {
  name: string;
  backend: string;
  reported: string | undefined;
  bootMs: number;
  pass: boolean;
  steps: StepRecord[];
  screenshots: string[];
  compare?: { shot: string; ref: string }[];
  errors: string[];
  warnings: string[];
  network?: NetworkEntry[];
}
type Perf = { seconds: number; frames: number; avgFrameMs: number; worstFrameMs: number; fps: number; note: string } | { error: string; errors: string[] };
interface BackendResult {
  scenarios: ScenarioResult[];
  network?: { requests: NetworkEntry[]; maxParallel: number; bootMs: number };
  reported?: string | undefined;
  perf?: Perf | null;
  fallback?: boolean;
  pass?: boolean;
}
interface Report {
  createdAt: string;
  project: string;
  outDir: string;
  size: { W: number; H: number };
  backends: Record<string, BackendResult>;
  pass: boolean;
  url?: string;
  setupError?: string;
  parity?: { shot: string; ssim: number }[];
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
function opt(n: string): string | undefined;
function opt(n: string, d: string): string;
function opt(n: string, d?: string): string | undefined {
  return argv.indexOf(n) >= 0 ? (argv[argv.indexOf(n) + 1] ?? d) : d;
}
const project = resolve(opt('--project', '.'));
const scenarioDir = resolve(project, opt('--scenarios', 'tests/scenarios'));
const backends = opt('--backends', 'webgpu,webgl2').split(',');
const [W = 1280, H = 720] = opt('--size', '1280x720').split('x').map(Number);
const perfSeconds = Number(opt('--perf', '3'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(project, opt('--out', join('.lab', 'runs', stamp)));
const readyTimeout = Number(opt('--ready-timeout', '30000'));

// playwright-core is resolved from the GAME project (skills install no deps of their own).
let chromium: BrowserType;
try {
  const req = createRequire(join(project, 'package.json'));
  const mod = (await import(req.resolve('playwright-core'))) as { chromium?: BrowserType; default?: { chromium: BrowserType } };
  const c = mod.chromium ?? mod.default?.chromium;
  if (!c) throw new Error('no chromium export');
  chromium = c;
} catch {
  console.error(`playwright-core not found from ${project}. Run: pnpm add -D playwright-core`);
  process.exit(2);
}

// ------------------------------------------------------------------ server
/** Newest modification time (ms) of any file under `dir` (0 if it doesn't exist). */
function newest(dir: string): number {
  if (!existsSync(dir)) return 0;
  const st = statSync(dir);
  if (!st.isDirectory()) return st.mtimeMs;
  return readdirSync(dir).reduce((m, f) => Math.max(m, newest(join(dir, f))), 0);
}

async function startServer(): Promise<{ url: string; stop(): void }> {
  const url = opt('--url');
  if (url) return { url, stop() {} };
  const built = join(project, 'dist', 'index.html');
  let mode = existsSync(built) && !flag('--dev') ? 'preview' : 'dev';
  // a dist/ older than the sources tests yesterday's game: every new assertion fails against the old build
  if (mode === 'preview') {
    const src = Math.max(...['src', 'public', 'index.html'].map((d) => newest(join(project, d))));
    if (src > statSync(built).mtimeMs) {
      console.warn('[playtest] dist/ is older than src/ or public/: testing the dev server instead (run `pnpm release` to test the release build)');
      mode = 'dev';
    }
  }
  const port = 4300 + Math.floor(Math.random() * 500);
  const args = mode === 'preview' ? ['exec', 'vite', 'preview', '--port', port, '--strictPort'] : ['exec', 'vite', '--port', port, '--strictPort'];
  const proc = spawn('pnpm', args.map(String), { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const serverUrl = await new Promise<string>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`vite ${mode} did not start:\n${log}`)), 30000);
    const onData = (d: Buffer) => {
      log += d;
      const m = String(log).replace(/\x1b\[[0-9;]*m/g, '').match(/http:\/\/(localhost|127\.0\.0\.1):\d+\//);
      if (m) {
        clearTimeout(t);
        res(m[0]);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (c) => rej(new Error(`vite exited ${c}:\n${log}`)));
  });
  console.log(`[playtest] serving ${relative(process.cwd(), project) || '.'} via vite ${mode} at ${serverUrl}`);
  return { url: serverUrl, stop: () => proc.kill() };
}

// ------------------------------------------------------------------ browser
const CHROME_ARGS = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'];

interface OpenedGame {
  page: Page;
  errors: string[];
  warnings: string[];
  ready: boolean;
  reported?: string;
  bootMs: number;
  network: NetworkEntry[];
}

async function openGame(browser: Browser, url: string, backend: string, extra = ''): Promise<OpenedGame> {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && errors.push(`http ${r.status()}: ${r.url()}`));
  // network timeline (ms since navigation) — shows whether assets load in parallel
  const started = new Map<Request, number>();
  const network: NetworkEntry[] = [];
  const tNav = Date.now();
  page.on('request', (r) => started.set(r, Date.now() - tNav));
  page.on('requestfinished', async (r) => {
    const sizes = await r.sizes().catch(() => null);
    network.push({
      file: decodeURIComponent(new URL(r.url()).pathname.split('/').pop() || '/'),
      type: r.resourceType(),
      start: started.get(r) ?? 0,
      end: Date.now() - tNav,
      kb: sizes ? Number((sizes.responseBodySize / 1024).toFixed(1)) : null,
    });
  });
  const q = new URLSearchParams({ test: '1', seed: '1' });
  if (backend === 'webgl2') q.set('renderer', 'webgl2');
  const full = `${url}${url.includes('?') ? '&' : '?'}${q}${extra}`;
  const t0 = Date.now();
  try {
    await page.goto(full, { waitUntil: 'domcontentloaded', timeout: readyTimeout });
    await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: readyTimeout });
  } catch (e) {
    errors.push(`boot failed: ${message(e).split('\n')[0]} (window.__game.ready not true after ${readyTimeout}ms)`);
    return { page, errors, warnings, ready: false, bootMs: Date.now() - t0, network };
  }
  const reported = await page.evaluate(() => window.__game.backend);
  return { page, errors, warnings, ready: true, reported, bootMs: Date.now() - t0, network: [...network] };
}

/** `state` is __game.getState(); `result` is what the last script/eval/input step returned (A/B checks in a bot). */
function evalAssert(expr: string, state: unknown, result?: unknown): { ok: boolean; error?: string } {
  try {
    return { ok: Boolean(new Function('state', 'result', `return (${expr});`)(state, result)) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** A bot file's source, ready to eval in the page: .ts bots are type-stripped (their `import type` lines vanish). */
function botSource(path: string): string {
  const code = readFileSync(path, 'utf8');
  if (!path.endsWith('.ts')) return code;
  // stripTypeScriptTypes is still flagged experimental: silence only that one warning
  const emit = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (!String(typeof w === 'string' ? w : w.message).includes('stripTypeScriptTypes')) (emit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    return stripTypeScriptTypes(code);
  } finally {
    process.emitWarning = emit;
  }
}

async function runScenario(browser: Browser, url: string, backend: string, scenario: Scenario, shotDir: string): Promise<ScenarioResult> {
  const g = await openGame(browser, url, backend);
  const res: ScenarioResult = { name: scenario.name, backend, reported: g.reported, bootMs: g.bootMs, pass: g.ready, steps: [], screenshots: [], errors: g.errors, warnings: g.warnings, network: g.network };
  if (!g.ready) {
    await g.page.screenshot({ path: join(shotDir, `${scenario.name}-boot-failure.png`) }).catch(() => {});
    await g.page.close();
    return res;
  }
  const page = g.page;
  let lastResult: unknown;
  for (const [i, s] of scenario.steps.entries()) {
    const rec: StepRecord = { i, ...s };
    try {
      if (s.step !== undefined) rec.tick = await page.evaluate((n) => window.__game.step(n), s.step);
      else if (s.input !== undefined) rec.result = await page.evaluate((a) => window.__game.input(a), s.input);
      else if (s.until !== undefined) {
        // { until: "expr", max: 1200, every: 10 } — step until expr(state) is true
        const every = s.every ?? 10;
        let steps = 0;
        let ok = false;
        while (steps < (s.max ?? 1200)) {
          await page.evaluate((n) => window.__game.step(n), every);
          steps += every;
          if (evalAssert(s.until, await page.evaluate(() => window.__game.getState())).ok) {
            ok = true;
            break;
          }
        }
        rec.steps = steps;
        rec.ok = ok;
        if (!ok) {
          rec.failed = `until "${s.until}" not reached in ${s.max ?? 1200} steps`;
          res.pass = false;
        }
      } else if (s.assert !== undefined) {
        const state = await page.evaluate(() => window.__game.getState());
        const r = evalAssert(s.assert, state, lastResult);
        rec.ok = r.ok;
        if (!r.ok) {
          rec.failed = r.error ?? `assertion false: ${s.assert}`;
          rec.state = state;
          res.pass = false;
        }
      } else if (s.screenshot !== undefined) {
        const p = join(shotDir, `${scenario.name}-${s.screenshot}.png`);
        await page.screenshot({ path: p });
        res.screenshots.push(relative(outDir, p));
        // "compare": the reference frame this shot is framed like (project-relative); visual-pack.ts pairs them
        if (s.compare) (res.compare ??= []).push({ shot: relative(outDir, p), ref: s.compare });
      } else if (s.key !== undefined) {
        // one key or a chord (['ArrowUp', 'ArrowRight']) held for `steps` ticks; release: false keeps it down
        const keys = ([] as string[]).concat(s.key);
        for (const k of keys) await page.keyboard.down(k);
        if (s.steps) await page.evaluate((n) => window.__game.step(n), s.steps);
        if (s.release !== false) for (const k of keys.reverse()) await page.keyboard.up(k);
      } else if (s.keyUp !== undefined) {
        for (const k of ([] as string[]).concat(s.keyUp)) await page.keyboard.up(k);
      } else if (s.drag !== undefined) {
        const drag = s.drag;
        const [[x0, y0], [x1, y1]] = [drag.from, drag.to];
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        await page.mouse.move(x1, y1, { steps: 8 });
        // hold: game ticks to run with the pointer still down (camera/aim feedback loops only show over time)
        if (drag.hold) await page.evaluate((n) => window.__game.step(n), drag.hold);
        if (drag.release !== false) await page.mouse.up();
      } else if (s.pointerUp !== undefined) {
        await page.mouse.up(); // ends a { drag: { release: false } }
      } else if (s.eval !== undefined) rec.result = await page.evaluate(s.eval);
      else if (s.script !== undefined) {
        // { script: "bots/x.ts", args: {...} } — file holds `async (game, args) => {...}`, path relative to scenario dir
        const code = botSource(resolve(scenarioDir, s.script));
        rec.result = await page.evaluate(
          ([c, a]) => ((0, eval)(c) as (game: GameHooks, args: unknown) => unknown)(window.__game, a),
          [code, s.args ?? {}] as const,
        );
      }
      else throw new Error(`unknown step ${JSON.stringify(s)}`);
    } catch (e) {
      rec.failed = message(e);
      res.pass = false;
    }
    if ((s.script !== undefined || s.eval !== undefined) && rec.result !== undefined) lastResult = rec.result;
    rec.stateAfter = await page.evaluate(() => window.__game.getState()).catch(() => null);
    res.steps.push(rec);
  }
  if (res.errors.length) res.pass = false;
  await page.close();
  return res;
}

async function measurePerf(browser: Browser, url: string, backend: string): Promise<Perf | null> {
  if (!perfSeconds) return null;
  const g = await openGame(browser, url, backend, '&realtime=1');
  if (!g.ready) return { error: 'not ready', errors: g.errors };
  await g.page.waitForTimeout(perfSeconds * 1000);
  const stats = await g.page.evaluate(() => window.__game.stats());
  await g.page.close();
  return { seconds: perfSeconds, ...stats, fps: stats.frames / perfSeconds, note: 'headless timings are indicative only' };
}

/** Max number of asset requests (scripts, fetches, wasm) in flight at once during boot. */
function parallelism(network: NetworkEntry[]): number {
  const ev = network
    .filter((n) => ['script', 'fetch', 'xhr', 'other'].includes(n.type))
    .flatMap((n): [number, number][] => [
      [n.start, 1],
      [n.end, -1],
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of ev) max = Math.max(max, (cur += d));
  return max;
}

// ------------------------------------------------------------------ main
const scenarios = existsSync(scenarioDir)
  ? readdirSync(scenarioDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(scenarioDir, f), 'utf8')) as Scenario)
  : [];
if (!scenarios.length) {
  console.error(`no scenarios in ${scenarioDir}`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
let server: { url: string; stop(): void } | undefined;
let browser: Browser | undefined;
const report: Report = { createdAt: new Date().toISOString(), project, outDir, size: { W, H }, backends: {}, pass: true };
try {
  server = await startServer();
  report.url = server.url;
  browser = await chromium.launch({ channel: process.env.PLAYTEST_CHANNEL ?? 'chrome', headless: !flag('--headed'), args: CHROME_ARGS });
  for (const backend of backends) {
    const shotDir = join(outDir, backend);
    mkdirSync(shotDir, { recursive: true });
    const b: BackendResult = { scenarios: [] };
    for (const sc of scenarios) {
      const r = await runScenario(browser, server.url, backend, sc, shotDir);
      // keep the boot network timeline once per backend (first scenario), drop it from the rest
      if (!b.network) b.network = { requests: r.network ?? [], maxParallel: parallelism(r.network ?? []), bootMs: r.bootMs };
      delete r.network;
      b.scenarios.push(r);
      b.reported ??= r.reported;
      console.log(`[playtest] ${backend.padEnd(6)} ${r.pass ? 'PASS' : 'FAIL'} ${sc.name}${r.reported && r.reported !== backend ? ` (got ${r.reported})` : ''}`);
      for (const s of r.steps.filter((s) => s.failed)) console.log(`           step ${s.i}: ${s.failed}`);
      for (const e of r.errors) console.log(`           error: ${e}`);
    }
    b.perf = await measurePerf(browser, server.url, backend);
    b.fallback = !!b.reported && b.reported !== backend;
    if (b.fallback && backend === 'webgpu') {
      console.log('[playtest] WARNING: WebGPU unavailable in this browser; WebGL2 fallback was used.');
      if (flag('--require-webgpu')) report.pass = false;
    }
    b.pass = b.scenarios.every((s) => s.pass);
    if (!b.pass) report.pass = false;
    report.backends[backend] = b;
  }
} catch (e) {
  report.pass = false;
  report.setupError = message(e);
  console.error(`[playtest] setup failed: ${report.setupError}`);
} finally {
  await browser?.close();
  server?.stop();
}

// Backend parity: SSIM between same-named WebGPU and WebGL2 screenshots (needs ffmpeg; skipped otherwise).
const parityMinArg = opt('--parity-min');
const parityMin = parityMinArg ? Number(parityMinArg) : null;
if (report.backends['webgpu'] && report.backends['webgl2'] && spawnSync('ffmpeg', ['-version']).status === 0) {
  const parity: { shot: string; ssim: number }[] = (report.parity = []);
  for (const shot of readdirSync(join(outDir, 'webgpu')).filter((f) => f.endsWith('.png'))) {
    const other = join(outDir, 'webgl2', shot);
    if (!existsSync(other)) continue;
    const r = spawnSync('ffmpeg', ['-i', join(outDir, 'webgpu', shot), '-i', other, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' });
    const ssim = Number(r.stderr.match(/All:([\d.]+)/)?.[1]);
    parity.push({ shot, ssim });
    if (parityMin !== null && !(ssim >= parityMin)) report.pass = false;
  }
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
const lines = [`# Playtest ${report.pass ? 'PASS' : 'FAIL'}`, '', `- url: ${report.url}`, `- created: ${report.createdAt}`, ''];
for (const [k, b] of Object.entries(report.backends)) {
  lines.push(`## ${k} (reported: ${b.reported ?? '?'})`, '');
  if (b.perf && 'fps' in b.perf) lines.push(`perf: ${b.perf.fps.toFixed(1)} fps, avg ${b.perf.avgFrameMs.toFixed(2)} ms, worst ${b.perf.worstFrameMs.toFixed(2)} ms`, '');
  else if (b.perf) lines.push('perf: ? fps, avg ? ms, worst ? ms', '');
  if (b.network) {
    const big = [...b.network.requests].sort((x, y) => (y.kb ?? 0) - (x.kb ?? 0)).slice(0, 6);
    lines.push(`loading: ${b.network.requests.length} requests, max ${b.network.maxParallel} in parallel, ready after ${b.network.bootMs} ms`);
    for (const n of big) lines.push(`  - ${n.file} (${n.type}) ${n.start}–${n.end} ms, ${n.kb ?? '?'} KB`);
    lines.push('');
  }
  for (const s of b.scenarios) {
    lines.push(`- ${s.pass ? '✅' : '❌'} **${s.name}** boot ${s.bootMs}ms${s.errors.length ? `, ${s.errors.length} errors` : ''}`);
    for (const st of s.steps.filter((x) => x.failed)) lines.push(`  - step ${st.i}: ${st.failed}`);
    for (const e of s.errors) lines.push(`  - error: ${e}`);
    for (const p of s.screenshots) lines.push(`  - screenshot: ${p}`);
  }
  lines.push('');
}
if (report.parity?.length) {
  lines.push('## Backend parity (SSIM webgpu vs webgl2, 1.0 = identical)', '');
  for (const p of report.parity) lines.push(`- ${p.ssim >= 0.9 ? '✅' : '⚠️'} ${p.shot}: ${p.ssim.toFixed(4)}`);
  lines.push('');
}
if (report.setupError) lines.push(`setup error: ${report.setupError}`);
writeFileSync(join(outDir, 'summary.md'), lines.join('\n'));
const latest = join(project, '.lab', 'runs', 'latest');
if (outDir.startsWith(join(project, '.lab', 'runs'))) {
  rmSync(latest, { force: true });
  try {
    symlinkSync(relative(join(project, '.lab', 'runs'), outDir), latest);
  } catch {}
}
console.log(`[playtest] ${report.pass ? 'PASS' : 'FAIL'} -> ${relative(process.cwd(), outDir)}/report.json`);
process.exit(report.pass ? 0 : report.setupError ? 2 : 1);
