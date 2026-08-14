import { copyFileSync, cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(projectDir, 'dist-tauri')
const petSource = join(projectDir, 'resources', 'whale-girl')
const petTarget = join(distDir, 'whale-girl')

mkdirSync(petTarget, { recursive: true })
copyFileSync(join(projectDir, 'resources', 'pet-overlay', 'index.html'), join(distDir, 'index.html'))
copyFileSync(join(petSource, 'pet.json'), join(petTarget, 'pet.json'))
copyFileSync(join(petSource, 'spritesheet.webp'), join(petTarget, 'spritesheet.webp'))
cpSync(join(petSource, 'actions'), join(petTarget, 'actions'), { recursive: true })
