# Video-first: build the game from a gameplay video

The video is the spec. **The game must look like the video and keep its mechanic.** Use this when:
- the user gave only words and `RUNWARE_API_KEY` is set: generate the video (default for new games), or
- the user gave a gameplay video: skip step 1.

With no key and no video, use the normal art-direction path (art bible written from the prompt).

## 1. Generate the video (`generate-media`)
- Turn the request into one pitch sentence: player, verb, what the verb changes. Keep it original: no existing game, character or IP.
- Choose a look the lab can build. Blender scripts make clean low-poly, toy-like and stylised worlds well; photoreal, painterly or hairy characters don't come out well.
- Write the `gameplay` entry with the four-part prompt from `generate-media` ("Gameplay video"): 1344×768, 6 s, `candidates: 2`. Run `pnpm media --dry-run`, tell the user the cost (about $0.70), then generate.
- Pick from the contact sheets. If neither clip shows the verb and its result, fix the prompt (make the verb more visible, simplify the scene) and regenerate once. Don't pick a clip that only looks pretty.

## 2. Read the video (`key-art-direction`)
Run it on `design/reference/gameplay.mp4`. On top of the art bible and `style.json`, write a **Gameplay read** in `design/brief.md` (see the template's "Source video" section): one line per item, each citing the frame it comes from:
- **Avatar:** what the player controls, its silhouette and size against the world.
- **Verb:** the core action, and how the world changes when it happens.
- **Camera rig:** follow/fixed/side-on, height, pitch, distance, lag. Measure it against the avatar.
- **Goal and feedback:** what success looks like on screen (lights, particles, characters reacting).
- **World pattern:** how the space is built (lanes, islands, platforms, open field) and how big it is in avatar lengths.
- **Speeds:** how far the avatar moves per second, in avatar lengths, and how long one action takes.
Copy the frame that best shows the game in play to `design/reference/keyart.png`. It is the hero shot for the art bible, the overview screenshot and the visual judge.

Then write the **inventory** (`key-art-direction` step 3): one full-resolution crop per kind of thing in the clip (avatar, characters, centrepiece, recurring props) and `design/reference/inventory.md`, which describes only what each crop shows. Write the Gameplay read's nouns from the inventory, not from the contact sheet. In the snowplough proof, a 20 px green blob in the square went into the brief as "a decorated tree". The win was then built around lighting that tree, and none of it was in the video.

**The video is the only source of truth for what things look like.** Your words are not. Every description in the brief, the art bible and a generation prompt must trace to a crop or a frame.

## 3. Brief from the read
- **Core loop** = the verb from the video plus a goal and a fail state the video implies. Invent the minimum rules needed to make it a game; the video shows a moment, not the rules.
- **Controls:** map the avatar's motion in the video to input ("the plough steers like a car: ← → turn, ↑ drive").
- **Camera:** copy the video's rig. Players expect the game to feel like the clip, and the judge compares the two.
- **Cut list:** everything in the clip that isn't the core loop (crowds, weather, extra vehicles) is v2.
- **Additions:** anything the game shows that the video doesn't (a goal object, a win effect, a character variant), each with its reason. Prefer to build gameplay needs out of things in the inventory: if the win needs a centrepiece that reacts, use the one the video has (light its fire pit and lamps) instead of inventing a new one. An addition the brief doesn't list is a bug, and the visual judge flags it.
- **Feel targets:** take the numbers from the Speeds line.

## 4. Build and judge
Same workflow as always (scaffold, media, assets, implement, playtest, judge). Also:
- The avatar, vehicles, creatures and other recognisable props in the video: generate them (`generate-media` "3D models"). Make an isolated reference image of each from **its inventory crop** (not the whole hero frame, where it may be 20 px tall), with a prompt that only repeats what the crop shows, turn it into a GLB, then import it with `L.import_glb`. If the inventory shows variety (coat colours, hair), build the variants (a recoloured texture per variant is cheaper than another model). Characters get a T-pose reference image, then `lab_rig` rigs and animates them in Blender (idle, walk, run, jump). The terrain, buildings-as-blocks and gameplay surfaces stay Blender scripts, coloured from `style.json`. Look at each preview render next to the frames.
- Generated 2D art (splash, sky, textures) uses the hero frame as `reference`.
- Music: the clip's soundtrack is stripped, so write the music from the art bible's mood and the Speeds line (a fast verb wants a faster BPM). One loop for play is enough for v1.
- The boot scenario's overview screenshot copies the hero frame's camera. Add a play screenshot mid-action that matches another keyframe.
- The final hand-off names the source video, so the user can compare: "built from `design/reference/gameplay.mp4`".

## Lessons from the snowplough proof (`examples/snowplough`)
- **Invented details come from words, not the video.** The first build had a big-headed villager in a scarf and pompom hat, and a decorated festival tree. The video has blocky cube-headed figures in plain coats, and a fire pit with a sapling. Both came from text: the villager prompt asked for "a winter coat, scarf and knit hat", and the image model drew the text because the villager was 15 px in the reference frame. The tree came from a misread contact sheet. The judges compared mood and palette, so neither was caught. The fix is the inventory crops, prompts that trace to them, an Additions list in the brief, and the visual judge's inventory check.
- **Dusk and night clips:** don't brighten until everything reads. Keep the darks of the video and light it with warm pools (lamps baked into ground vertex colours) and amber emissives with bloom. The first fix that raised exposure and ambient read as washed-out lavender (visual judge 5.3), and the dusk version scored better.
- **Measure the palette, don't eyeball it:** run `key-art-direction/scripts/palette.py` on `keyart.png` and on the play and overview screenshots, then compare the dominant colours and their shares. In the snowplough proof, the key art was 31% deep blue (`#0e4a7f`) and the game had no deep blue at all: every frame was pale lilac. Warm pools had been added per house until they merged, so there was no blue left between them. Tuning the snow base colour and pool sizes against the measured shares lifted the judge's palette sub-score from 6 to 7.5 in one round, where four rounds of eyeballed tweaks had not.
- **Warm pools must stay pools:** about 10-15% of the frame should be warm. If every house and lamp gets a large pool, the streets turn uniformly peach and the two-temperature look is gone.
- **Make progress visible in the world:** a pool or lamp that lights when the player achieves something (a house reached) shows progress across the whole map, not only in the HUD.
- **Connect-to-goal rules need slack:** "a cleared path from each door to the square" failed with exact geometry: the lane ended 1 m short of the square. Pre-clear an apron around goals and doorsteps so any sensible pass connects.
- **A turning-radius vehicle in grid streets:** the bot needs pure pursuit with lookahead plus three-point turns into side streets out of dead ends. Write the bot early; it found the connectivity bug before any human did.
- **Generated models rarely match the gameplay numbers:** the Tripo plough's blade was only as wide as its body. Fix the mesh in the import script (stretch the blade vertices) so what the player sees matches what the rules clear.
