# tomorrow-game-lab — notes for agents working on the lab itself

- The product is `skills/`. Each skill must be **self-contained**: `npx skills add` copies skill folders independently, so a skill must not import files from another skill or from `lab/`. Refer to sibling skills by name.
- Keep SKILL.md files short. The validator caps them at 200 lines; move detail into `references/`.
- `examples/minigolf/src/engine/*` and `assets/src/lab_bpy.py` are verbatim copies of the template/helper. Change the skill copy first, then `cp` it into the example. `npm run validate` checks for drift.
- Before finishing any change, run `npm test`. It needs Chrome, Blender and ffmpeg; set `SKIP_BROWSER=1` to skip the browser tests.
- Generated output (`.lab/`, `lab/.tmp/`, `dist/`) is gitignored. The key-art fixtures in `lab/fixtures/keyart/` are committed. Regenerate them with `npm run keyart`.
- When you learn a non-obvious engine/physics gotcha, add it to the relevant `references/*.md` or SKILL.md "Gotchas" section. That is how the lab improves.
- This is a bleeding-edge lab: prefer the **latest stable** release of every tool and library (Blender 5.2 LTS, current Node LTS, latest npm packages, latest GitHub Actions majors). Don't add compatibility shims for old versions; when bumping, check `npm view <pkg> version` / release notes and update skills, the template, the example and CI together.
