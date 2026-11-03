#!/usr/bin/env node
// End-to-end agent eval: can a fresh Claude Code agent, given ONLY the installed skills and the key-art
// fixture, build a passing 3D minigolf game? Expensive (one full agent run + 4 judge runs). Manual only.
//
// Usage: node lab/eval/run-eval.mjs [--input image|video|both] [--model opus] [--budget 25]
//                                   [--skip-build] [--dir $TMPDIR/tomorrow-game-lab-eval-<ts>] [--judge-only]
//
// Permissions: no --dangerously-skip-permissions. The build agent runs with --permission-mode acceptEdits and a
// scoped allowlist passed with --settings (see permissions.mjs); judges run from a separate dir with a read-only list.
// Denied tool calls are recorded in the result (see permissions.mjs).
//
// Steps: fresh workspace → `npx skills add <lab> -a claude-code --copy` → copy fixtures → `claude -p` build
//        → objective checks (build, playtest, assets, scenarios) → 4 independent judge runs (`claude -p`)
//        → lab/eval/results/<ts>.json + a row in lab/eval/history.md
import { spawnSync, spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BUILD_ALLOW, BUILD_DENY, JUDGE_ALLOW, JUDGE_DENY, settingsJson } from './permissions.mjs';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : d);
const flag = (n) => argv.includes(n);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const input = opt('--input', 'image');
const model = opt('--model');
const budget = opt('--budget', '25');
// Workspace lives OUTSIDE the repo: claude loads CLAUDE.md from parent dirs, which would leak lab notes into the eval.
const ws = resolve(opt('--dir', join(tmpdir(), `tomorrow-game-lab-eval-${stamp}`)));
const log = (...a) => console.log('[eval]', ...a);

const PROMPT = `Use the make-web-game skill to build a small 3D minigolf game in this directory (the current
working directory is the game project root).
${input !== 'video' ? '- Key art image: reference/minigolf.png\n' : ''}${input !== 'image' ? '- Key art video: reference/minigolf.mp4\n' : ''}
The game should look like the key art. Three holes are enough. Work fully autonomously: do not ask questions,
make reasonable choices and note them. Follow the skill's workflow through playtest and judging, and finish
when the verdict passes or after 3 judge rounds. End with a short summary of scores and remaining issues.`;

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

async function claude(prompt, { cwd, transcript, json = false, mode = 'default', extra = [] }) {
  const args = ['-p', prompt, '--permission-mode', mode, '--max-budget-usd', budget, ...extra];
  if (model) args.push('--model', model);
  args.push('--output-format', json ? 'json' : 'stream-json', ...(json ? [] : ['--verbose']));
  return new Promise((res) => {
    const p = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = transcript ? createWriteStream(transcript) : null;
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      out?.write(d);
    });
    p.stderr.on('data', (d) => out?.write(d));
    p.on('close', (code) => {
      out?.end();
      res({ code, out: buf });
    });
  });
}

// ------------------------------------------------------------------ 1. workspace + skills
const result = { stamp, input, model: model ?? 'default', workspace: ws, checks: {}, judges: {} };
if (!flag('--judge-only')) {
  mkdirSync(join(ws, 'reference'), { recursive: true });
  for (const f of ['minigolf.png', 'minigolf.mp4']) {
    if ((f.endsWith('.png') && input === 'video') || (f.endsWith('.mp4') && input === 'image')) continue;
    copyFileSync(join(ROOT, 'lab/fixtures/keyart', f), join(ws, 'reference', f));
  }
  log('installing skills into', ws);
  const inst = sh('npx', ['-y', 'skills', 'add', ROOT, '-a', 'claude-code', '-y', '--copy'], { cwd: ws });
  if (!inst.ok) throw new Error(`skills add failed:\n${inst.out}`);
  // Permissions go in a settings file OUTSIDE the workspace, passed with --settings (untrusted workspaces
  // ignore their own .claude/settings.json allow rules).
  mkdirSync(`${ws}-settings`, { recursive: true });
  writeFileSync(join(`${ws}-settings`, 'build.json'), settingsJson(BUILD_ALLOW, BUILD_DENY));
  writeFileSync(join(`${ws}-settings`, 'judge.json'), settingsJson(JUDGE_ALLOW, JUDGE_DENY));

  // ---------------------------------------------------------------- 2. agent build
  if (!flag('--skip-build')) {
    log('running build agent (this takes a while; transcript: transcript.jsonl)');
    const t0 = Date.now();
    const r = await claude(PROMPT, { cwd: ws, mode: 'acceptEdits', transcript: join(ws, 'transcript.jsonl'), extra: ['--settings', join(`${ws}-settings`, 'build.json')] });
    result.agent = { exitCode: r.code, minutes: Number(((Date.now() - t0) / 60000).toFixed(1)) };
    const lines = readFileSync(join(ws, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean);
    const msgs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const final = msgs.findLast((m) => m.type === 'result');
    result.agent.costUsd = final?.total_cost_usd;
    result.agent.turns = final?.num_turns;
    result.agent.summary = final?.result?.slice(0, 2000);
    const toolUses = msgs.flatMap((m) => m.message?.content ?? []).filter((c) => c?.type === 'tool_use');
    result.agent.skillsUsed = [...new Set(toolUses.filter((t) => t.name === 'Skill').map((t) => t.input?.skill))];
    result.agent.subagents = toolUses.filter((t) => t.name === 'Agent' || t.name === 'Task').length;
    // Denials = commands the skills led the agent to try outside the allowlist. Review these after every run.
    const denials = final?.permission_denials ?? [];
    result.agent.permissionDenials = denials.map((d) => ({ tool: d.tool_name, input: JSON.stringify(d.tool_input).slice(0, 200) }));
    if (denials.length) log(`${denials.length} permission denial(s):`, result.agent.permissionDenials.map((d) => `${d.tool} ${d.input}`).join('\n  '));
  }
}

// ------------------------------------------------------------------ 3. objective checks
const check = (name, ok, detail = '') => {
  result.checks[name] = { ok: !!ok, detail: String(detail).slice(0, 500) };
  log(`${ok ? '✓' : '✗'} ${name} ${detail ? `— ${String(detail).split('\n')[0].slice(0, 120)}` : ''}`);
};
check('package.json', existsSync(join(ws, 'package.json')));
check('art bible + style.json', existsSync(join(ws, 'design/art-bible.md')) && existsSync(join(ws, 'design/style.json')));
check('design brief', existsSync(join(ws, 'design/brief.md')));
const glbs = existsSync(join(ws, 'public/models')) ? readdirSync(join(ws, 'public/models')).filter((f) => f.endsWith('.glb')) : [];
const assetScripts = existsSync(join(ws, 'assets/src')) ? readdirSync(join(ws, 'assets/src')).filter((f) => f.endsWith('.py') && !/^(_|lab_)/.test(f)) : [];
check('blender assets', glbs.length > 0 && assetScripts.length > 0, `${assetScripts.length} scripts, ${glbs.length} GLBs`);
const scen = existsSync(join(ws, 'tests/scenarios')) ? readdirSync(join(ws, 'tests/scenarios')).filter((f) => f.endsWith('.json')) : [];
check('scenarios', scen.length >= 3, `${scen.length} scenarios`);
if (existsSync(join(ws, 'package.json'))) {
  const b = sh('npm', ['run', 'build'], { cwd: ws });
  check('npm run build', b.ok, b.ok ? '' : b.out.slice(-400));
  const pt = sh(process.execPath, [join(ROOT, 'skills/game-judge/scripts/playtest.mjs'), '--project', ws, '--out', join(ws, '.lab/runs/eval')], { cwd: ws });
  let rep = null;
  try { rep = JSON.parse(readFileSync(join(ws, '.lab/runs/eval/report.json'), 'utf8')); } catch {}
  check('playtest (both backends)', pt.ok, pt.out.split('\n').filter((l) => /PASS|FAIL|error/.test(l)).join('\n'));
  result.playtest = rep && Object.fromEntries(Object.entries(rep.backends).map(([k, v]) => [k, { reported: v.reported, pass: v.pass, fps: v.perf?.fps }]));
  result.parity = rep?.parity;
  const verdicts = sh('bash', ['-c', 'ls -1 .lab/runs/*/verdict.json 2>/dev/null | tail -1'], { cwd: ws }).out.trim();
  if (verdicts) {
    const v = JSON.parse(readFileSync(join(ws, verdicts), 'utf8'));
    check("agent's own verdict", v.pass, `mean ${v.meanScore}`);
    result.selfVerdict = { pass: v.pass, meanScore: v.meanScore, judges: Object.fromEntries(v.verdicts.map((x) => [x.judge, x.score])) };
  } else check("agent's own verdict", false, 'no verdict.json found');
}

// ------------------------------------------------------------------ 4. independent judges
if (existsSync(join(ws, '.lab/runs/eval/report.json'))) {
  const judgeDir = join(ROOT, 'skills/game-judge/judges');
  const runDir = join(ws, '.lab/runs/eval');
  mkdirSync(join(runDir, 'judges'), { recursive: true });
  const rubrics = readdirSync(judgeDir).filter((f) => f.endsWith('.md'));
  // Judges run from their own directory with a read-only allowlist (not the build workspace's settings).
  const judgeCwd = `${ws}-judges`;
  mkdirSync(judgeCwd, { recursive: true });
  mkdirSync(`${ws}-settings`, { recursive: true });
  writeFileSync(join(`${ws}-settings`, 'judge.json'), settingsJson(JUDGE_ALLOW, JUDGE_DENY));
  log(`running ${rubrics.length} independent judges`);
  const runs = await Promise.all(
    rubrics.map(async (f) => {
      const rubric = readFileSync(join(judgeDir, f), 'utf8');
      const prompt = `${rubric}\n\n---\nProject root: ${ws}\nRun directory (<run>): ${runDir}\nKey art: ${ws}/reference/ and ${ws}/design/reference/\nSkill scripts: ${join(ROOT, 'skills')}/<skill>/scripts/\nThe output schema is at ${join(judgeDir, '_output-schema.json')}.\nYou are an independent evaluator: you have no information about how this was built. Return ONLY the JSON object.`;
      const r = await claude(prompt, { cwd: judgeCwd, json: true, extra: ['--settings', join(`${ws}-settings`, 'judge.json'), '--add-dir', ws, '--add-dir', join(ROOT, 'skills')] });
      let text = '';
      try { text = JSON.parse(r.out).result ?? ''; } catch { text = r.out; }
      const m = text.match(/\{[\s\S]*\}/);
      writeFileSync(join(runDir, 'judges', f.replace('.md', '.json')), m ? m[0] : text);
      return f;
    }),
  );
  const agg = sh(process.execPath, [join(ROOT, 'skills/game-judge/scripts/aggregate.mjs'), runDir]);
  try {
    const v = JSON.parse(readFileSync(join(runDir, 'verdict.json'), 'utf8'));
    result.judges = { pass: v.pass, meanScore: v.meanScore, scores: Object.fromEntries(v.verdicts.map((x) => [x.judge, x.score])), invalid: v.invalid };
    log(`independent verdict: ${v.pass ? 'PASS' : 'FAIL'} mean ${v.meanScore}`, JSON.stringify(result.judges.scores));
  } catch {
    result.judges = { error: agg.out.slice(-500), ran: runs };
  }
}

// ------------------------------------------------------------------ 5. record
const checksPassed = Object.values(result.checks).filter((c) => c.ok).length;
result.score = { checks: `${checksPassed}/${Object.keys(result.checks).length}`, judgeMean: result.judges.meanScore ?? null };
mkdirSync(join(ROOT, 'lab/eval/results'), { recursive: true });
writeFileSync(join(ROOT, 'lab/eval/results', `${stamp}.json`), JSON.stringify(result, null, 2));
const hist = join(ROOT, 'lab/eval/history.md');
if (!existsSync(hist)) writeFileSync(hist, '| run | input | model | checks | judge mean | judges (vis/game/tech/asset) | cost $ | min |\n|---|---|---|---|---|---|---|---|\n');
const s = result.judges.scores ?? {};
appendFileSync(hist, `| ${stamp} | ${input} | ${result.model} | ${result.score.checks} | ${result.score.judgeMean ?? '-'} | ${['visual-fidelity', 'gameplay', 'technical', 'asset-quality'].map((k) => s[k] ?? '-').join('/')} | ${result.agent?.costUsd?.toFixed?.(2) ?? '-'} | ${result.agent?.minutes ?? '-'} |\n`);
log(`done → lab/eval/results/${stamp}.json (workspace: ${ws})`);
