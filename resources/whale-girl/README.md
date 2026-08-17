# Whale Girl desktop pet

The runtime package is declarative: `pet.json` maps semantic animation names to either cells in the Codex-compatible v2 atlas or normalized standalone frame files. Adding an action does not require renderer changes when the action is selected by existing state logic.

## Animation sources

The runtime atlas is `spritesheet.webp`, with `1536x2288` RGBA geometry, 8 columns x 11 rows, and `192x208` cells. The manifest selects idle, directional drag movement, failure, waiting, active work, and the clockwise 16-direction gaze sequence. Active Harness work plays row 7 once as the glasses-and-notes entrance, then loops the row 8 note-taking motion.

Additional generated actions live under `actions/<name>/00.png` through `05.png`:

- `cheer`: lively completion celebration
- `curtsy`: welcome greeting
- `pat`: click/head-pat response
- `shy`: playful interaction response
- `sleepy`: occasional long-idle variation

Every additional frame is a transparent `192x208` PNG. The action strips were cleaned with soft chroma removal and despill, checked for frame count, clipping, connected components, scale, and baseline consistency, and visually reviewed with the runtime atlas.

The Tauri renderer decodes the atlas and all standalone frames before showing the window. Both source kinds are then cropped or copied into one `192x208` Canvas, so changing actions does not replace a live CSS background texture.
