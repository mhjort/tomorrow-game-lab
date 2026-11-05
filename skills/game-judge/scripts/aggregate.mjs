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
      if (it?.element !== undefined && typeof it.element !== 'string') errs.push(`issues[${i}].element must be a string`);
    });
  if (v.criteria !== undefined && (typeof v.criteria !== 'object' || Object.values(v.criteria).some((x) => typeof x !== 'number' || x < 0 || x > 10)))
    errs.push('criteria must map names to numbers 0-10');
  if (v.keyart_bullets !== undefined && (!Array.isArray(v.keyart_bullets) || v.keyart_bullets.some((b) => typeof b !== 'string')))
    errs.push('keyart_bullets must be an array of strings');
  if (v.issues?.some?.((i) => i.severity === 'blocker') && v.pass === true) errs.push('pass cannot be true with a blocker issue');
  return errs;
}

const STOP = new Set('a an the and or of to in on at is are as by for with not no from than into its it reads read looks look too very'.split(' '));
const words = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/s$/, '')));
/** Title similarity: shared content words over the shorter title's word count (0-1). Heuristic, for grouping only. */
export function similar(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
/** Element tag, normalised to its first word ("square centrepiece" -> "square", "snow and road" -> "snow"). */
const elementOf = (i) => i.element?.toLowerCase().trim().split(/[\s/_-]+/)[0] || null;
/**
 * Same complaint? Issues tagged with an element merge only within it, on a looser title match; `alone` (the judge
 * raised nothing else about that element) merges on the element alone, since judges word the same fault differently.
 */
export function sameIssue(a, b, alone = false) {
  const [ea, eb] = [elementOf(a), elementOf(b)];
  if (ea && eb) return ea === eb && (alone || similar(a.title, b.title) >= 0.3);
  return similar(a.title, b.title) >= 0.4;
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Several verdicts from the same judge (a panel, e.g. three visual-fidelity runs) become one: median score and
 * criteria, majority pass, and issues grouped by title with `raisedBy` = how many panel members raised them.
 * One judge's score is noisy (the same build scored 6.4-6.8); issues most of the panel agrees on are the signal.
 */
export function mergePanel(vs) {
  if (vs.length === 1) return { ...vs[0], panel: 1, issues: vs[0].issues.map((i) => ({ ...i, raisedBy: 1 })) };
  const groups = [];
  vs.forEach((v, m) => {
    for (const it of v.issues) {
      const alone = v.issues.filter((o) => elementOf(o) && elementOf(o) === elementOf(it)).length === 1;
      const g = groups.find((g) => !g.members.has(m) && sameIssue(g.issue, it, alone));
      if (g) {
        g.members.add(m);
        g.sev.push(it.severity);
      } else groups.push({ issue: it, members: new Set([m]), sev: [it.severity] });
    }
  });
  const criteria = {};
  for (const k of new Set(vs.flatMap((v) => Object.keys(v.criteria ?? {})))) {
    const xs = vs.map((v) => v.criteria?.[k]).filter((x) => typeof x === 'number');
    if (xs.length) criteria[k] = median(xs);
  }
  const score = Number(median(vs.map((v) => v.score)).toFixed(2));
  const passes = vs.filter((v) => v.pass).length;
  return {
    judge: vs[0].judge,
    score,
    scores: vs.map((v) => v.score),
    pass: passes * 2 > vs.length,
    summary: vs.map((v) => v.summary).join(' / '),
    panel: vs.length,
    ...(Object.keys(criteria).length ? { criteria } : {}),
    issues: groups.map((g) => ({
      ...g.issue,
      severity: g.sev.sort((a, b) => SEV[a] - SEV[b])[Math.floor((g.sev.length - 1) / 2)], // the median severity
      raisedBy: g.members.size,
    })),
  };
}

export function aggregate(runDir) {
  const dir = join(runDir, 'judges');
  if (!existsSync(dir)) throw new Error(`no judges/ directory in ${runDir}`);
  const raw = [];
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
    else raw.push(v);
  }
  // judges/<judge>.json, or a panel: judges/<judge>-1.json, -2.json, ... (same "judge" field)
  const byJudge = new Map();
  for (const v of raw) byJudge.set(v.judge, [...(byJudge.get(v.judge) ?? []), v]);
  const verdicts = [...byJudge.values()].map(mergePanel);
  const playtestPath = join(runDir, 'report.json');
  const playtest = existsSync(playtestPath) ? JSON.parse(readFileSync(playtestPath, 'utf8')) : null;
  const all = verdicts.flatMap((v) => v.issues.map((i) => ({ ...i, judge: v.judge, panel: v.panel })));
  // a panel's issue goes on the fix list only when most of the panel raised it (blockers always do)
  const agreed = (i) => i.panel === 1 || i.severity === 'blocker' || i.raisedBy * 2 > i.panel;
  const fixes = all.filter(agreed).sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.raisedBy - a.raisedBy);
  const unconfirmed = all.filter((i) => !agreed(i)).sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const pass = invalid.length === 0 && verdicts.length > 0 && verdicts.every((v) => v.pass) && (playtest?.pass ?? true);
  const mean = verdicts.length ? verdicts.reduce((s, v) => s + v.score, 0) / verdicts.length : 0;
  return { pass, meanScore: Number(mean.toFixed(2)), playtestPass: playtest?.pass ?? null, verdicts, fixes, unconfirmed, invalid };
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
    ...r.verdicts.map((v) => `| ${v.judge} | ${v.panel > 1 ? `${v.score} (median of ${v.scores.join(', ')})` : v.score} | ${v.pass ? '✅' : '❌'} | ${v.summary.replace(/\|/g, '/').replace(/\n/g, ' ')} |`),
    ...r.verdicts.filter((v) => v.criteria).flatMap((v) => ['', `${v.judge} criteria${v.panel > 1 ? ' (medians)' : ''}: ${Object.entries(v.criteria).map(([k, x]) => `${k} ${x}`).join(', ')}`]),
    '',
    '## Fix list (do these in order)',
    '',
    ...r.fixes.map((f, i) => `${i + 1}. **[${f.severity}] ${f.title}** _(${f.judge}${f.panel > 1 ? `, ${f.raisedBy}/${f.panel} judges` : ''})_\n   - evidence: ${f.evidence}\n   - fix: ${f.fix}`),
    ...(r.unconfirmed.length
      ? ['', '## Raised by a minority of a panel (verify against the reference before acting)', '', ...r.unconfirmed.map((f) => `- [${f.severity}] ${f.title} _(${f.judge}, ${f.raisedBy}/${f.panel})_`)]
      : []),
    ...(r.invalid.length ? ['', '## Invalid judge outputs (re-run these judges)', '', ...r.invalid.map((x) => `- ${x}`)] : []),
    '',
  ].join('\n');
  writeFileSync(join(runDir, 'verdict.md'), md);
  writeFileSync(join(runDir, 'verdict.json'), JSON.stringify(r, null, 2));
  console.log(md);
  process.exit(r.invalid.length && !r.verdicts.length ? 2 : r.pass ? 0 : 1);
}
