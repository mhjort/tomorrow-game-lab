# Human review: the taste check

Judges and bots catch bugs and check the game against the brief. They can't tell you whether it is *fun*, whether the controls feel right, or whether a sound is annoying. Only a person can. Ask **once**, when you believe the game is ready: playtest green, judges passed. Don't ask after every change; the user's time is the scarcest resource in the loop.

## 1. Make it one click to play
- Start the dev server in the background and **check that it answers** before you send the link:
  ```bash
  pnpm dev --port 5173 --strictPort        # background; then: curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
  ```
  If the port is taken, use the next free one. Never send a URL you haven't checked.
- Phone or tablet testing: `pnpm dev --host` prints a LAN URL. Offer it when the game has touch controls.
- **Deep links:** if the game has levels, support `?level=N` (minigolf: `?hole=N`), so the user can jump straight to the part you want an opinion on. Never send a `?test` link: in test mode the game doesn't run on its own.
- Leave the server running and say so. Stop it when the user is done.

## 2. Send one short message
````
**Ready to play: http://localhost:5173/**  (phone: http://192.168.x.x:5173/)

Controls: drag back to putt · ←/→ aim, hold Space · M sound

Try:
- the full round (3 holes, ~2 min)
- jump to the ramp hole: http://localhost:5173/?hole=3

I'd like your take on:
1. Putt feel: is the power range too strong or too weak?
2. Sounds: is anything too loud, too quiet or annoying? (sound starts after your first click)
3. Does it look like the key art?

Judges: visual 8.1 · gameplay 7.6 · technical 8.4 · assets 7.9. Known minor issues: …
````
- Ask 2–4 **specific** questions about things only a person can judge: feel, tuning, sound, look, difficulty. Don't ask "is it OK?".
- Start with the link. Keep the scores and known issues short and put them last.
- Mention the traps: audio starts only after a click, and the first load compiles shaders.

## 3. Act on the answer
- Turn the feedback into concrete changes, such as a tuning constant, a `gain` in `design/media.json`, or a camera angle. Make them, then re-run the playtest, plus any judges whose inputs changed.
- Reply with what changed and the same link, so the user only has to reload.
- If taste changes the design (a new mechanic, a cut feature), update `design/brief.md` first.
- When you learn a lasting preference ("I like slower, heavier physics"), write it into the art bible or the brief so later rounds respect it.

## Unattended runs
With no user to answer (CI, `claude -p` evals), skip the wait. Put the questions in the final report instead, so a person can answer them later.
