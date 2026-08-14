/** Real Tauri sidecar smoke: boot WebView2, poll Harness state, and stop on 410. */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const auditHome = await mkdtemp(join(tmpdir(), 'dsh-whale-girl-tauri-audit-'))
process.on('exit', () => { rmSync(auditHome, { recursive: true, force: true }) })

const token = 'audit-token'
let snapshot = { activity: { name: 'idle', until: 0, sessionThink: false, sessionWait: false, turnCompleted: false } }
let pollCount = 0
let readyCount = 0
let shouldQuit = false
const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end()
  } else if (request.method === 'GET' && request.url === '/state') {
    pollCount += 1
    if (shouldQuit) response.writeHead(410, { 'content-type': 'application/json' }).end('{"quit":true}')
    else response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(snapshot))
  } else if (request.method === 'POST' && request.url === '/ready') {
    readyCount += 1
    response.writeHead(204).end()
  } else {
    response.writeHead(404).end()
  }
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('audit server has no TCP address')

const bootstrap = {
  endpoint: `http://127.0.0.1:${address.port}`,
  token,
  harnessUrl: 'http://127.0.0.1:3080',
  showOnStart: true,
  alwaysOnTop: true,
  scale: 0.75,
  minScale: 0.5,
  maxScale: 1.2,
  scaleStep: 0.05,
  windowWidth: 230,
  windowHeight: 249,
  gazeRadiusBodies: 1.5,
  gazeHysteresisDegrees: 4,
  pollIntervalMs: 100,
  requestTimeoutMs: 1000,
  maxConsecutiveFailures: 10,
}
const sidecar = join(appDir, 'bin', 'win32-x64', 'dsh-whale-girl-tauri.exe')
const appData = join(auditHome, 'appdata')
const localAppData = join(auditHome, 'localappdata')
mkdirSync(appData, { recursive: true })
mkdirSync(localAppData, { recursive: true })
const child = spawn(sidecar, [], {
  env: {
    ...process.env,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    DSH_WHALE_GIRL_BOOTSTRAP: Buffer.from(JSON.stringify(bootstrap)).toString('base64url'),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
})
let stderr = ''
child.stderr?.setEncoding('utf8')
child.stderr?.on('data', chunk => { stderr += String(chunk) })

async function waitUntil(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (child.exitCode !== null) throw new Error(`sidecar exited before ${description} (code=${child.exitCode}): ${stderr}`)
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}: ${stderr}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

try {
  await waitUntil(() => pollCount >= 2 && readyCount >= 1, 15_000, 'renderer startup and initial state polling')
  snapshot = { activity: { name: 'working', until: 0, sessionThink: true, sessionWait: false, turnCompleted: false } }
  await waitUntil(() => pollCount >= 3, 5_000, 'updated Harness state polling')
  shouldQuit = true
  const exit = await Promise.race([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`sidecar did not exit after HTTP 410: ${stderr}`)), 5_000)),
  ])
  if (exit.code !== 0) throw new Error(`sidecar exited unsuccessfully: ${JSON.stringify(exit)} ${stderr}`)
  console.log('✓ Tauri sidecar: WebView2 process started')
  console.log('✓ renderer: embedded manifest, atlas, and Tauri IPC initialized')
  console.log('✓ Harness transport: authenticated state polling succeeded')
  console.log('✓ lifecycle: HTTP 410 stopped the sidecar cleanly')
} finally {
  if (child.exitCode === null) child.kill()
  await new Promise(resolve => server.close(resolve))
}
