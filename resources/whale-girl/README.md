# Whale Girl desktop pet

The runtime package is declarative: `pet.json` maps semantic animation names to either cells in the Codex-compatible v2 atlas or normalized standalone frame files. Adding an action does not require renderer changes when the action is selected by existing state logic.

## Preserved source

The user-provided WebP is preserved without modification at `original/spritesheet-source.webp`.

- SHA-256: `0C50DE31FA374E8EFBB27E39247FEAE3F6135C115404D1CBCDCAF49B55355626`
- Geometry: `1536x2288`, RGBA, 8 columns x 11 rows, `192x208` cells
- Runtime copy: `spritesheet.webp` initially has the same hash as the preserved source

## Animation sources

Rows 0-8 of `spritesheet.webp` provide idle, directional drag movement, waving, jumping, failure, waiting, active work, and review. Active Harness work plays row 7 once as the glasses-and-notes entrance, then loops the row 8 note-taking motion. Rows 9-10 provide the clockwise 16-direction gaze sequence where zero degrees points upward.

Additional generated actions live under `actions/<name>/00.png` through `05.png`:

- `cheer`: lively completion celebration
- `curtsy`: welcome greeting
- `pat`: click/head-pat response
- `shy`: playful interaction response
- `sleepy`: occasional long-idle variation

Every additional frame is a transparent `192x208` PNG. The source strips were grounded in the preserved atlas, cleaned with soft chroma removal and despill, checked for frame count, clipping, connected components, scale, and baseline consistency, and independently visually reviewed against the original character.

The Tauri renderer decodes the atlas and all standalone frames before showing the window. Both source kinds are then cropped or copied into one `192x208` Canvas, so changing actions does not replace a live CSS background texture.
