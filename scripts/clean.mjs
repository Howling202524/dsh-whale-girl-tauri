import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

for (const relative of ['../bin', '../dist-tauri', '../lib']) {
  rmSync(fileURLToPath(new URL(relative, import.meta.url)), { force: true, recursive: true })
}
