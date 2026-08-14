import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)))
const executableName = 'dsh-whale-girl-tauri.exe'
const source = join(projectDir, 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release', executableName)
const targetDir = join(projectDir, 'bin', 'win32-x64')

if (!existsSync(source)) throw new Error(`Tauri sidecar is missing at ${source}`)
mkdirSync(targetDir, { recursive: true })
copyFileSync(source, join(targetDir, executableName))
