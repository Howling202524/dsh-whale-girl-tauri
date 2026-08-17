# Whale Girl Tauri desktop pet

[中文](README.md) | English

Whale Girl Tauri is a standalone Windows x64 desktop-pet bundle for DeepSeek Harness. The official Harness loads a Cordis plugin that observes `agent/status` and `session/event`, then launches a prebuilt Tauri 2 sidecar. The sidecar creates a transparent always-on-top window with the system WebView2 runtime, so the plugin does not ship Chromium or modify the official `deepseek-harness` repository.

## Install

Runtime requirements:

- Windows x64
- Node.js `^22.19.0 || >=24`
- the official `dsh` CLI
- Microsoft Edge WebView2 Runtime; Windows 11 includes it by default

Download and install the prebuilt package from [GitHub Releases](https://github.com/Howling202524/dsh-whale-girl-tauri/releases):

```powershell
Invoke-WebRequest https://github.com/Howling202524/dsh-whale-girl-tauri/releases/download/v0.1.2/dsh-whale-girl-tauri-0.1.2.tgz -OutFile dsh-whale-girl-tauri-0.1.2.tgz
dsh plugin --profile web add .\dsh-whale-girl-tauri-0.1.2.tgz
dsh --profile web
```

Install a local build:

```powershell
dsh plugin --profile web add D:\path\to\dsh-whale-girl-tauri
dsh --profile web
```

Remove it with:

```powershell
dsh plugin --profile web remove dsh-whale-girl-tauri
```

The release contains only the Windows x64 sidecar. The current archive is about 6.4 MB and unpacks to about 8.4 MB; WebView2 is shared by the operating system.

## Configure

The bundle inserts a plugin row with id `whale-girl-tauri`. Override its complete config in `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: whale-girl-tauri
  config:
    enabled: true
    harnessUrl: http://127.0.0.1:3080
    showOnStart: true
    alwaysOnTop: true
    scale: 0.75
    minScale: 0.5
    maxScale: 1.2
    scaleStep: 0.05
    windowWidth: 230
    windowHeight: 249
    gazeRadiusBodies: 1.5
    gazeHysteresisDegrees: 4
    celebrationMs: 4000
    failureMs: 4000
    welcomeMs: 4000
    pollIntervalMs: 500
    requestTimeoutMs: 1500
    maxConsecutiveFailures: 10
    shutdownTimeoutMs: 2000
```

A Harness profile patch replaces the complete `config` block, so keep every field the deployment still needs.

The pet is shown at 75% by default. Its context menu can resize it from 50% to 120% or restore the default; the selected size persists and resizing keeps the feet anchored. The pet stays neutral while the pointer overlaps its window, follows the pointer only within roughly one body length outside it, and returns to neutral at greater distances. Releasing a drag immediately restores the animation selected by the current Harness state. Double-clicking the pet or selecting “Open Harness” opens the Harness URL in the system browser.

## Build from source

Additional requirements: stable Rust and the Visual Studio 2022 Build Tools “Desktop development with C++” workload with a Windows SDK.

```powershell
pnpm install --ignore-scripts
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:pet
```

`pnpm build` targets only `x86_64-pc-windows-msvc` and stages the sidecar under `bin/win32-x64/`. Git dependencies run `prepare`, so a direct GitHub source install also requires Rust and MSVC. Regular users should prefer the GitHub Release archive that already contains the executable.

`pnpm audit:pet` starts the real WebView2 sidecar and verifies embedded resources, Tauri IPC, authenticated state polling, and the shutdown handshake. Before the native window is shown, the renderer decodes every frame and paints through one Canvas with atomic frame replacement; this avoids transparent-window flashes while WebView2 switches individual PNG textures. `qa/atlas-validation.json` records the v2 result from `hatch-pet-local`'s `validate_atlas.py --require-v2`.

## Architecture

- `src/plugin.ts`: official Harness Cordis plugin, authenticated HTTP channel, and sidecar lifecycle owner.
- `src/activity.ts`: projects agent work, approval waits, and turn results into visual states.
- `src/sidecar/renderer.ts`: WebView2 Canvas renderer that predecodes the atlas and additional actions, plus menu and interaction logic.
- `src-tauri/`: Tauri 2 Rust sidecar for the transparent window, dragging, gaze, preferences, and polling.
- `resources/whale-girl/`: validated v2 atlas, additional action frames, and manifest.
- `cordis.patch.yml`: declares the package as a Harness profile bundle.

The plugin exposes its process channel only on a random `127.0.0.1` port and generates a fresh Bearer token for every launch. The renderer receives only explicitly registered Tauri commands; Rust opens external navigation through the system browser.

## Project origin

This project is independently maintained by Howling202524. It began with the MIT-licensed `dsh-whale-girl` framework and was subsequently rebuilt around Tauri 2 and WebView2, including new desktop hosting, window interaction, preference persistence, resource staging, build, and release implementations. Retained portions remain under the original MIT license; copyright in the Tauri edition's subsequent implementation and modifications belongs to Howling202524.

## License

[MIT](LICENSE)
