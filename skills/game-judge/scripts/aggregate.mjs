#!/usr/bin/env node
// Merge judge verdicts into one decision + prioritized fix list.
// Usage: node aggregate.mjs <run-dir>   (reads <run-dir>/judges/*.json, writes <run-dir>/verdict.md + verdict.json)
// Exit 0 if every judge passed and the playtest passed, 1 otherwise, 2 if inputs are invalid.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SEV = { blocker: 0, major: 1, minor: 2 };

export function validateVerdict(v) {
  const errs = [];
  if (typeof v !== 'object' || !v) return ['not an object'];
  if (typeof v.judge !== 'string') errs.push('judge must be a string');
  if (typeof v.score !== 'number' || v.score < 0 || v.score > 10) errs.push('score must be a number 0-10');
  if (typeof v.pass !== 'boolean') errs.push('pass must be boolean');
  if (typeof v.summary !== 'string') errs.push('summary must be a string');
  if (!Array.isArray(v.issues)) errs.push('issues must be an array');
  else
    v.issues.forEach((it, i) => {
      if (!(it?.severity in SEV)) errs.push(`issues[${i}].severity must be blocker|major|minor`);
      for (const k of ['title', 'evidence', 'fix']) if (typeof it?.[k] !== 'string') errs.push(`issues[${i}].${k} must be a string`);
    });
  if (v.issues?.some?.((i) => i.severity === 'blocker') && v.pass === true) errs.push('pass cannot be true with a blocker issue');
  return errs;
}

export function aggregate(runDir) {
  const dir = join(runDir, 'judges');
  if (!existsSync(dir)) throw new Error(`no judges/ directory in ${runDir}`);
  const verdicts = [];
  const invalid = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    let v;
    try {
      v = JSON.parse(readFileSync(join(dir, f), 'utf8').replace(/^```(json)?\s*|\s*```$/g, ''));
    } catch (e) {
      invalid.push(`${f}: invalid JSON (${e.message})`);
      continue;
    }
    const errs = validateVerdict(v);
    if (errs.length) invalid.push(`${f}: ${errs.join('; ')}`);
    else verdicts.push(v);
  }
  const playtestPath = join(runDir, 'report.json');
  const playtest = existsSync(playtestPath) ? JSON.parse(readFileSync(playtestPath, 'utf8')) : null;
  const fixes = verdicts
    .flatMap((v) => v.issues.map((i) => ({ ...i, judge: v.judge })))
    .sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const pass = invalid.length === 0 && verdicts.length > 0 && verdicts.every((v) => v.pass) && (playtest?.pass ?? true);
  const mean = verdicts.length ? verdicts.reduce((s, v) => s + v.score, 0) / verdicts.length : 0;
  return { pass, meanScore: Number(mean.toFixed(2)), playtestPass: playtest?.pass ?? null, verdicts, fixes, invalid };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error('usage: aggregate.mjs <run-dir>');
    process.exit(2);
  }
  const r = aggregate(runDir);
  const md = [
    `# Verdict: ${r.pass ? 'PASS ✅' : 'ITERATE ❌'}  (mean ${r.meanScore}/10, playtest ${r.playtestPass === null ? 'n/a' : r.playtestPass ? 'pass' : 'FAIL'})`,
    '',
    '| judge | score | pass | summary |',
    '|---|---|---|---|',
    ...r.verdicts.map((v) => `| ${v.judge} | ${v.score} | ${v.pass ? '✅' : '❌'} | ${v.summary.replace(/\|/g, '/').replace(/\n/g, ' ')} |`),
    '',
    '## Fix list (do these in order)',
    '',
    ...r.fixes.map((f, i) => `${i + 1}. **[${f.severity}] ${f.title}** _(${f.judge})_\n   - evidence: ${f.evidence}\n   - fix: ${f.fix}`),
    ...(r.invalid.length ? ['', '## Invalid judge outputs (re-run these judges)', '', ...r.invalid.map((x) => `- ${x}`)] : []),
    '',
  ].join('\n');
  writeFileSync(join(runDir, 'verdict.md'), md);
  writeFileSync(join(runDir, 'verdict.json'), JSON.stringify(r, null, 2));
  console.log(md);
  process.exit(r.invalid.length && !r.verdicts.length ? 2 : r.pass ? 0 : 1);
}
