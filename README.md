# Whale Girl Tauri 桌宠

[中文](README.md) | [English](README_EN.md)

Whale Girl Tauri 是面向 Windows x64 的独立 DeepSeek Harness 桌宠 bundle。官方 Harness 加载 Cordis 插件，插件订阅 `agent/status` 与 `session/event`，再启动预编译的 Tauri 2 sidecar。sidecar 使用系统 WebView2 创建透明置顶窗口，不随插件分发 Chromium，也不修改官方 `deepseek-harness`。

## 安装

运行要求：

- Windows x64
- Node.js `^22.19.0 || >=24`
- 官方 `dsh` CLI
- Microsoft Edge WebView2 Runtime；Windows 11 默认包含，缺少时可从微软安装

从 [GitHub Releases](https://github.com/Howling202524/dsh-whale-girl-tauri/releases) 下载预编译包后安装：

```powershell
Invoke-WebRequest https://github.com/Howling202524/dsh-whale-girl-tauri/releases/download/v0.1.2/dsh-whale-girl-tauri-0.1.2.tgz -OutFile dsh-whale-girl-tauri-0.1.2.tgz
dsh plugin --profile web add .\dsh-whale-girl-tauri-0.1.2.tgz
dsh --profile web
```

安装本地构建：

```powershell
dsh plugin --profile web add D:\path\to\dsh-whale-girl-tauri
dsh --profile web
```

卸载：

```powershell
dsh plugin --profile web remove dsh-whale-girl-tauri
```

发布包只包含 Windows x64 sidecar。当前安装包约 6.4 MB，解包约 8.4 MB；WebView2 由系统共享。

## 配置

bundle 自动插入 id 为 `whale-girl-tauri` 的插件行。可在 `$DSH_HOME/profiles/web/cordis.patch.yml` 覆盖完整配置：

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

Harness profile patch 会替换整段 `config`，覆盖时应保留仍需使用的字段。

桌宠默认以 75% 显示。右键菜单可在 50%–120% 间调整大小或恢复默认值，设置会持久保存，缩放时脚底位置保持不变。鼠标位于桌宠窗口内时她保持原姿态；鼠标离开桌宠但仍在约一个身位的圆形范围内时才会转头注视，距离更远后恢复原姿态。拖动放下后会立即回到当前 Harness 状态对应的动画。双击桌宠或选择“打开 Harness”会由系统浏览器打开 Harness 地址。

## 从源码构建

额外要求：Rust stable、Visual Studio 2022 Build Tools 的“使用 C++ 的桌面开发”工作负载及 Windows SDK。

```powershell
pnpm install --ignore-scripts
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:pet
```

`pnpm build` 仅生成 `x86_64-pc-windows-msvc` sidecar，并将其放到 `bin/win32-x64/`。Git 依赖会运行 `prepare`，因此从 GitHub 源码直接安装也要求 Rust/MSVC；普通用户应优先安装 GitHub Release 中带预编译 EXE 的安装包。

`pnpm audit:pet` 启动真实 WebView2 sidecar，验证嵌入资源、Tauri IPC、鉴权状态轮询和退出握手。renderer 在显示原生窗口前预先解码全部帧，并通过单一 Canvas 原子替换画面，避免 WebView2 逐 PNG 切换纹理时的透明窗口闪烁。`qa/atlas-validation.json` 是使用 `hatch-pet-local` 的 `validate_atlas.py --require-v2` 生成的 v2 图集校验结果。

## 架构

- `src/plugin.ts`：官方 Harness Cordis 插件；管理状态投影、鉴权 HTTP 通道和 sidecar 生命周期。
- `src/activity.ts`：把 agent 运行、审批等待和 turn 结果映射为动画状态。
- `src/sidecar/renderer.ts`：WebView2 Canvas 渲染器；预解码 atlas 与扩展动作，负责菜单和交互。
- `src-tauri/`：Tauri 2 Rust sidecar；负责透明窗口、拖动、注视方向、偏好持久化和状态轮询。
- `resources/whale-girl/`：已验证的 v2 atlas、扩展动作帧与 manifest。
- `cordis.patch.yml`：让 `dsh plugin` 将本包识别为 profile bundle。

Harness 插件只在 `127.0.0.1` 的随机端口开放进程通道，并为每次启动生成随机 Bearer token。renderer 只获得明确注册的 Tauri commands；外部导航由 Rust 侧调用系统浏览器处理。

## 项目来源

本项目由 Howling202524 独立维护。它以 MIT 许可的 `dsh-whale-girl` 为初始框架，随后重构为 Tauri 2/WebView2 架构，并重新实现桌面宿主、窗口交互、偏好持久化、资源装载、构建和发布流程。沿用部分继续遵守原项目的 MIT 许可，Tauri 版本的后续实现与修改版权归 Howling202524 所有。

## 许可证

[MIT](LICENSE)
