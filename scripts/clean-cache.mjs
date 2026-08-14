import { rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)))
for (const segments of [['.build'], ['dist-tauri'], ['src-tauri', 'gen'], ['src-tauri', 'target']]) {
  const target = resolve(join(projectDir, ...segments))
  const projectRelative = relative(projectDir, target)
  if (projectRelative.startsWith('..') || projectRelative === '') {
    throw new Error(`refusing to remove path outside project: ${target}`)
  }
  rmSync(target, { force: true, recursive: true })
}
