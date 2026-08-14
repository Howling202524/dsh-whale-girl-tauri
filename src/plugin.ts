import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { PetActivityTracker } from './activity.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'whale-girl-tauri'

/** Harness services whose event streams drive the pet. */
export const inject = ['agents', 'sessions']

/** Native pet window, reaction, transport, and shutdown settings. */
export interface Config {
  enabled: boolean
  harnessUrl: string
  showOnStart: boolean
  alwaysOnTop: boolean
  scale: number
  minScale: number
  maxScale: number
  scaleStep: number
  windowWidth: number
  windowHeight: number
  gazeRadiusBodies: number
  gazeHysteresisDegrees: number
  celebrationMs: number
  failureMs: number
  welcomeMs: number
  pollIntervalMs: number
  requestTimeoutMs: number
  maxConsecutiveFailures: number
  shutdownTimeoutMs: number
}

/** Schemastery validation and deployment defaults for {@link Config}. */
export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  harnessUrl: Schema.string().default('http://127.0.0.1:3080'),
  showOnStart: Schema.boolean().default(true),
  alwaysOnTop: Schema.boolean().default(true),
  scale: Schema.number().default(0.75),
  minScale: Schema.number().default(0.5),
  maxScale: Schema.number().default(1.2),
  scaleStep: Schema.number().default(0.05),
  windowWidth: Schema.number().default(230),
  windowHeight: Schema.number().default(249),
  gazeRadiusBodies: Schema.number().default(1.5),
  gazeHysteresisDegrees: Schema.number().default(4),
  celebrationMs: Schema.number().default(4_000),
  failureMs: Schema.number().default(4_000),
  welcomeMs: Schema.number().default(4_000),
  pollIntervalMs: Schema.number().default(500),
  requestTimeoutMs: Schema.number().default(1_500),
  maxConsecutiveFailures: Schema.number().default(10),
  shutdownTimeoutMs: Schema.number().default(2_000),
})

interface SidecarBootstrap {
  endpoint: string
  token: string
  harnessUrl: string
  showOnStart: boolean
  alwaysOnTop: boolean
  scale: number
  minScale: number
  maxScale: number
  scaleStep: number
  windowWidth: number
  windowHeight: number
  gazeRadiusBodies: number
  gazeHysteresisDegrees: number
  pollIntervalMs: number
  requestTimeoutMs: number
  maxConsecutiveFailures: number
}

function positiveFinite(pluginConfig: Config, key: keyof Config): void {
  const value = pluginConfig[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`whale-girl: ${String(key)} must be a positive finite number`)
  }
}

function validateConfig(pluginConfig: Config): void {
  for (const key of [
    'scale',
    'minScale',
    'maxScale',
    'scaleStep',
    'windowWidth',
    'windowHeight',
    'gazeRadiusBodies',
    'gazeHysteresisDegrees',
    'celebrationMs',
    'failureMs',
    'welcomeMs',
    'pollIntervalMs',
    'requestTimeoutMs',
    'maxConsecutiveFailures',
    'shutdownTimeoutMs',
  ] as const) positiveFinite(pluginConfig, key)
  if (pluginConfig.minScale >= pluginConfig.maxScale) {
    throw new TypeError('whale-girl: minScale must be less than maxScale')
  }
  if (pluginConfig.scale < pluginConfig.minScale || pluginConfig.scale > pluginConfig.maxScale) {
    throw new TypeError('whale-girl: scale must be between minScale and maxScale')
  }
  if (pluginConfig.scaleStep > pluginConfig.maxScale - pluginConfig.minScale) {
    throw new TypeError('whale-girl: scaleStep must not exceed the configured scale range')
  }
  if (pluginConfig.gazeRadiusBodies <= 0.5) {
    throw new TypeError('whale-girl: gazeRadiusBodies must be greater than 0.5')
  }
  if (pluginConfig.gazeHysteresisDegrees >= 11.25) {
    throw new TypeError('whale-girl: gazeHysteresisDegrees must be less than 11.25')
  }
  if (!Number.isSafeInteger(pluginConfig.maxConsecutiveFailures)) {
    throw new TypeError('whale-girl: maxConsecutiveFailures must be a positive safe integer')
  }
  let url: URL
  try {
    url = new URL(pluginConfig.harnessUrl)
  } catch (error: unknown) {
    throw new TypeError('whale-girl: harnessUrl must be an absolute HTTP(S) URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('whale-girl: harnessUrl must use http: or https:')
  }
}

function resolveSidecarExecutable(): string {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new TypeError('whale-girl-tauri: this release supports Windows x64 only')
  }
  const executable = fileURLToPath(new URL('../bin/win32-x64/dsh-whale-girl-tauri.exe', import.meta.url))
  if (!existsSync(executable)) {
    throw new TypeError(`whale-girl-tauri: sidecar executable is missing at ${executable}`)
  }
  return executable
}

function reasonKind(event: SessionEvent): string | undefined {
  if (event.type !== 'turn/end') return undefined
  const reason = (event.data as { reason?: unknown }).reason
  if (typeof reason !== 'object' || reason === null) return undefined
  const kind = (reason as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : undefined
}

function approvalId(event: SessionEvent, type: 'approval/asked' | 'approval/decided'): string | undefined {
  if ((event as { type: string }).type !== type) return undefined
  const id = ((event as unknown as { data?: { id?: unknown } }).data)?.id
  return typeof id === 'string' ? id : undefined
}

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address() as AddressInfo)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error) })
  })
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Launch the desktop sidecar and project Harness lifecycle events into it. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  validateConfig(config)
  if (!config.enabled) return

  const tracker = new PetActivityTracker({
    celebrationMs: config.celebrationMs,
    failureMs: config.failureMs,
    welcomeMs: config.welcomeMs,
  })
  const sidecarExecutable = resolveSidecarExecutable()
  const token = randomBytes(32).toString('base64url')
  let stopping = false
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { error: 'unauthorized' })
      return
    }
    if (request.method === 'GET' && request.url === '/state') {
      if (stopping) json(response, 410, { quit: true })
      else json(response, 200, tracker.snapshot())
      return
    }
    if (request.method === 'POST' && request.url === '/ready') {
      response.writeHead(204, { 'cache-control': 'no-store' })
      response.end()
      return
    }
    json(response, 404, { error: 'not-found' })
  })
  const address = await listen(server)
  const bootstrap: SidecarBootstrap = {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    harnessUrl: config.harnessUrl,
    showOnStart: config.showOnStart,
    alwaysOnTop: config.alwaysOnTop,
    scale: config.scale,
    minScale: config.minScale,
    maxScale: config.maxScale,
    scaleStep: config.scaleStep,
    windowWidth: config.windowWidth,
    windowHeight: config.windowHeight,
    gazeRadiusBodies: config.gazeRadiusBodies,
    gazeHysteresisDegrees: config.gazeHysteresisDegrees,
    pollIntervalMs: config.pollIntervalMs,
    requestTimeoutMs: config.requestTimeoutMs,
    maxConsecutiveFailures: config.maxConsecutiveFailures,
  }
  const child = spawn(sidecarExecutable, [], {
    env: {
      ...process.env,
      DSH_WHALE_GIRL_BOOTSTRAP: Buffer.from(JSON.stringify(bootstrap)).toString('base64url'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })

  if (child.stderr !== null) {
    createInterface({ input: child.stderr }).on('line', (line) => {
      if (line.trim().length > 0) ctx.logger.warn(`whale-girl sidecar: ${line}`)
    })
  }
  child.on('error', error => { ctx.logger.warn(`whale-girl sidecar failed to start: ${String(error)}`) })
  child.on('exit', (code, signal) => {
    if (!stopping) ctx.logger.warn(`whale-girl sidecar exited (code=${String(code)}, signal=${String(signal)})`)
  })

  ctx.on('agent/status', ({ agent, status }: { agent: { id: unknown }; status: AgentStatus }) => {
    tracker.setAgentStatus(String(agent.id), status)
  }, { global: true })
  ctx.on('agent/disposed', ({ agent }: { agent: { id: unknown } }) => {
    tracker.disposeAgent(String(agent.id))
  }, { global: true })
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    const asked = approvalId(event, 'approval/asked')
    if (asked !== undefined) tracker.askApproval(String(session.id), asked)
    const decided = approvalId(event, 'approval/decided')
    if (decided !== undefined) tracker.decideApproval(String(session.id), decided)
    const finished = reasonKind(event)
    if (finished !== undefined) tracker.finishTurn(finished)
  }, { global: true })

  ctx.effect(() => async () => {
    stopping = true
    await waitForExit(child, config.shutdownTimeoutMs)
    await closeServer(server)
  }, 'whale-girl-tauri: Tauri sidecar')
}
