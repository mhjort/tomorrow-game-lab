// Scoped permissions for the unattended eval agents (instead of --dangerously-skip-permissions).
// In `claude -p` nobody can answer prompts, so anything not allowed here is DENIED and shows up in
// the result's `permission_denials`. That is a useful signal: it means a skill asked for a command
// outside the expected toolchain.
//
// Rules are passed with `claude --settings <file>`, NOT via <workspace>/.claude/settings.json: Claude Code
// ignores project-level permissions.allow in a workspace that was never trusted interactively.
//
// This is containment against accidents, not a sandbox: `node`, `pnpm`, `python3` and `blender` run arbitrary
// code. For hard isolation, run the eval in a container/VM.

// The toolchain the skills legitimately need to build a game.
export const BUILD_ALLOW = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'Agent', 'TodoWrite',
  'Bash(pnpm *)', 'Bash(node *)',
  'Bash(blender *)', 'Bash(/Applications/Blender.app/Contents/MacOS/Blender *)',
  'Bash(python3 *)', 'Bash(ffmpeg *)', 'Bash(ffprobe *)',
  'Bash(bash .claude/skills/*)', 'Bash(bash ./.claude/skills/*)',
  'Bash(ls *)', 'Bash(cat *)', 'Bash(head *)', 'Bash(tail *)', 'Bash(wc *)', 'Bash(find *)', 'Bash(grep *)',
  'Bash(jq *)', 'Bash(which *)', 'Bash(command -v *)', 'Bash(echo *)', 'Bash(pwd)', 'Bash(test *)',
  // The user's global RTK hook rewrites read commands to `rtk <cmd>`; permissions are checked on the rewritten form.
  'Bash(rtk ls *)', 'Bash(rtk cat *)', 'Bash(rtk head *)', 'Bash(rtk tail *)', 'Bash(rtk grep *)', 'Bash(rtk find *)', 'Bash(rtk wc *)',
  'Bash(mkdir *)', 'Bash(cp *)', 'Bash(mv *)', 'Bash(chmod *)', 'Bash(touch *)', 'Bash(sed *)', 'Bash(diff *)',
];

// Never allowed, even if a broader rule would match.
export const BUILD_DENY = [
  'Bash(sudo *)', 'Bash(curl *)', 'Bash(wget *)', 'Bash(ssh *)', 'Bash(scp *)',
  'Bash(git push *)', 'Bash(pnpm publish *)', 'Bash(npm *)', 'Bash(npx *)', 'Bash(rm -rf / *)', 'Bash(rm -rf ~ *)',
  'WebFetch', 'WebSearch',
];

// Judges only read evidence and run the GLB inspector.
export const JUDGE_ALLOW = [
  'Read', 'Glob', 'Grep',
  'Bash(node *)', 'Bash(ls *)', 'Bash(cat *)', 'Bash(head *)', 'Bash(tail *)', 'Bash(jq *)', 'Bash(wc *)', 'Bash(find *)',
];
export const JUDGE_DENY = ['Edit', 'Write', 'WebFetch', 'WebSearch', 'Agent', 'Bash(pnpm *)', 'Bash(npm *)', 'Bash(rm *)', 'Bash(mv *)'];

export const settingsJson = (allow: readonly string[], deny: readonly string[]): string => JSON.stringify({ permissions: { allow, deny } }, null, 2);
