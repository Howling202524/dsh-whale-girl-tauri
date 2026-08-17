import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { gazeCell, preferredAnimation } from './logic.ts'
import type { PetActivitySnapshot, PetAnimation, PetBootstrap, PetManifest } from './types.ts'

interface PetUiPreferences {
  alwaysOnTop: boolean
  scale: number
  minScale: number
  maxScale: number
  scaleStep: number
  defaultScale: number
}

interface DragResult {
  moved: boolean
}

const EMPTY_SNAPSHOT: PetActivitySnapshot = {
  activity: { name: 'idle', until: 0, sessionThink: false, sessionWait: false, turnCompleted: false },
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`desktop pet surface is missing ${selector}`)
  return element
}

function requiredCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: true })
  if (context === null) throw new Error('desktop pet canvas is unavailable')
  return context
}

const stage = requiredElement<HTMLElement>('#pet-stage')
const sprite = requiredElement<HTMLCanvasElement>('#pet-sprite')
const menu = requiredElement<HTMLElement>('#pet-menu')
const alwaysOnTop = requiredElement<HTMLInputElement>('#always-on-top')
const petScale = requiredElement<HTMLInputElement>('#pet-scale')
const petScaleValue = requiredElement<HTMLOutputElement>('#pet-scale-value')
const resetScale = requiredElement<HTMLButtonElement>('#reset-scale')
const spriteContext = requiredCanvasContext(sprite)

let bootstrap: PetBootstrap
let snapshot = EMPTY_SNAPSHOT
let gaze: number | null = null
let dragDirection: 'left' | 'right' | null = null
let transient: { animation: string; until: number } | null = null
let animationKey = ''
let animationEpoch = 0
let idleSince = Date.now()
let nextIdleActionAt = Date.now() + 35_000
let pointerDragActive = false
let gazePending = false
let scaleTimer: number | null = null
let defaultScale = 0.75
let focusIntroUntil = 0
let focused = false
const decodedImages = new Map<string, HTMLImageElement>()

function assetUrl(path: string): string {
  return new URL(path.replaceAll('\\', '/'), bootstrap.assetBaseUrl).href
}

function imageFor(path: string): HTMLImageElement {
  const image = decodedImages.get(path)
  if (image === undefined) throw new Error(`desktop pet asset was not preloaded: ${path}`)
  return image
}

function paintImage(image: HTMLImageElement, sourceX = 0, sourceY = 0, sourceWidth = image.naturalWidth, sourceHeight = image.naturalHeight): void {
  spriteContext.globalCompositeOperation = 'copy'
  spriteContext.imageSmoothingEnabled = true
  spriteContext.imageSmoothingQuality = 'high'
  spriteContext.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sprite.width, sprite.height)
}

function setAtlasCell(path: string, row: number, column: number): void {
  const { width, height } = bootstrap.manifest.cell
  paintImage(imageFor(path), column * width, row * height, width, height)
}

function setFrame(animation: PetAnimation, framePosition: number): void {
  const frame = animation.frames[framePosition] ?? animation.frames[0] ?? 0
  if (animation.source.kind === 'atlas') {
    setAtlasCell(animation.source.path, animation.source.row, frame)
    return
  }
  const path = animation.source.paths[frame]
  if (path === undefined) return
  paintImage(imageFor(path))
}

async function preloadAssets(): Promise<void> {
  const paths = new Set<string>()
  for (const animation of Object.values(bootstrap.manifest.animations)) {
    if (animation.source.kind === 'atlas') paths.add(animation.source.path)
    else for (const path of animation.source.paths) paths.add(path)
  }
  await Promise.all([...paths].map(async (path) => {
    const image = new Image()
    image.decoding = 'async'
    image.src = assetUrl(path)
    await image.decode()
    decodedImages.set(path, image)
  }))
}

function positionsFor(animation: PetAnimation): number[] {
  const forward = animation.frames.map((_frame, index) => index)
  if (animation.playback !== 'pingpong' || forward.length < 3) return forward
  return [...forward, ...forward.slice(1, -1).reverse()]
}

function animationDuration(animation: PetAnimation): number {
  return positionsFor(animation).reduce((total, position) => total + (animation.durationsMs[position] ?? animation.durationsMs.at(-1) ?? 140), 0)
}

function play(animationName: string): void {
  if (animationKey === animationName) return
  const animation = bootstrap.manifest.animations[animationName] ?? bootstrap.manifest.animations.idle
  if (animation === undefined) return
  animationKey = animationName
  const epoch = ++animationEpoch
  const positions = positionsFor(animation)
  let cursor = 0
  const advance = (): void => {
    if (epoch !== animationEpoch) return
    const position = positions[cursor] ?? 0
    setFrame(animation, position)
    const duration = animation.durationsMs[position] ?? animation.durationsMs.at(-1) ?? 140
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (cursor + 1 < positions.length) cursor += 1
    else if (animation.playback === 'once') return
    else cursor = 0
    window.setTimeout(advance, duration)
  }
  advance()
}

function render(): void {
  const now = Date.now()
  if (dragDirection !== null) {
    play(dragDirection === 'left' ? 'running-left' : 'running-right')
    return
  }
  if (transient !== null && transient.until > now && bootstrap.manifest.animations[transient.animation] !== undefined) {
    play(transient.animation)
    return
  }
  transient = null
  const preferred = preferredAnimation(snapshot, now)
  if (preferred === 'focus' && focusIntroUntil > now && bootstrap.manifest.animations['focus-intro'] !== undefined) {
    play('focus-intro')
    return
  }
  if (preferred !== 'idle') {
    idleSince = now
    nextIdleActionAt = now + 35_000
    play(preferred)
    return
  }
  if (now >= nextIdleActionAt && bootstrap.manifest.animations.sleepy !== undefined) {
    transient = { animation: 'sleepy', until: now + 5_500 }
    nextIdleActionAt = now + 30_000 + Math.random() * 35_000
    play('sleepy')
    window.setTimeout(render, 5_600)
    return
  }
  if (gaze !== null) {
    const cell = gazeCell(gaze)
    const key = `gaze:${gaze}`
    if (animationKey !== key) {
      animationKey = key
      animationEpoch += 1
      setAtlasCell('spritesheet.webp', cell.row, cell.column)
    }
    return
  }
  if (now - idleSince > 90_000 && bootstrap.manifest.animations.sleepy !== undefined) play('sleepy')
  else play('idle')
}

function showTransient(animation: string, durationMs: number): void {
  transient = { animation, until: Date.now() + durationMs }
  render()
  window.setTimeout(render, durationMs + 100)
}

function updateSnapshot(next: PetActivitySnapshot): void {
  const nextFocused = preferredAnimation(next, Date.now()) === 'focus'
  snapshot = next
  if (nextFocused && !focused) {
    const intro = bootstrap.manifest.animations['focus-intro']
    focusIntroUntil = intro === undefined ? 0 : Date.now() + animationDuration(intro)
    if (focusIntroUntil > 0) window.setTimeout(render, focusIntroUntil - Date.now() + 20)
  } else if (!nextFocused) {
    focusIntroUntil = 0
  }
  focused = nextFocused
}

function hideMenu(): void {
  menu.hidden = true
}

function showMenu(x: number, y: number): void {
  menu.hidden = false
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`
}

function finishDrag(result: DragResult): void {
  pointerDragActive = false
  dragDirection = null
  render()
  if (!result.moved) showTransient(bootstrap.manifest.animations.pat === undefined ? 'waving' : 'pat', 3_000)
}

function showScale(value: number): void {
  petScale.value = String(value)
  petScaleValue.value = `${Math.round(value * 100)}%`
}

function applyScale(value: number, delayMs = 0): void {
  showScale(value)
  if (scaleTimer !== null) window.clearTimeout(scaleTimer)
  scaleTimer = window.setTimeout(() => {
    scaleTimer = null
    void invoke<number>('set_scale', { value }).then(showScale)
  }, delayMs)
}

async function pollGaze(): Promise<void> {
  if (gazePending || pointerDragActive || !menu.hidden) return
  gazePending = true
  try {
    gaze = await invoke<number | null>('gaze_direction')
    render()
  } finally {
    gazePending = false
  }
}

async function loadBootstrap(): Promise<PetBootstrap> {
  const response = await fetch('./whale-girl/pet.json', { cache: 'no-store' })
  if (!response.ok) throw new Error(`pet manifest request failed with HTTP ${response.status}`)
  const manifest = await response.json() as PetManifest
  return { manifest, assetBaseUrl: new URL('./whale-girl/', window.location.href).href }
}

async function start(): Promise<void> {
  bootstrap = await loadBootstrap()
  sprite.width = bootstrap.manifest.cell.width
  sprite.height = bootstrap.manifest.cell.height
  await preloadAssets()
  const preferences = await invoke<PetUiPreferences>('ui_preferences')
  alwaysOnTop.checked = preferences.alwaysOnTop
  defaultScale = preferences.defaultScale
  petScale.min = String(preferences.minScale)
  petScale.max = String(preferences.maxScale)
  petScale.step = String(preferences.scaleStep)
  showScale(preferences.scale)

  await listen<PetActivitySnapshot>('pet-state', ({ payload }) => {
    updateSnapshot(payload)
    if (payload.activity.turnCompleted && bootstrap.manifest.animations.cheer !== undefined) showTransient('cheer', 4_000)
    else render()
  })
  await listen<'left' | 'right' | null>('pet-drag', ({ payload }) => {
    dragDirection = payload
    render()
  })
  await listen<DragResult>('pet-drag-end', ({ payload }) => { finishDrag(payload) })
  updateSnapshot(await invoke<PetActivitySnapshot>('current_state'))

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointerDragActive || !menu.hidden) return
    pointerDragActive = true
    void invoke('begin_drag').catch(() => { finishDrag({ moved: true }) })
  })
  stage.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    showMenu(event.clientX, event.clientY)
  })
  stage.addEventListener('dblclick', () => { void invoke('show_main') })

  menu.addEventListener('pointerdown', event => { event.stopPropagation() })
  menu.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')
    if (target === null) return
    const action = target.dataset.action
    hideMenu()
    if (action === 'pat') showTransient('pat', 3_200)
    else if (action === 'play') showTransient('shy', 3_200)
    else if (action === 'show-main') void invoke('show_main')
    else if (action === 'hide') void invoke('hide_pet')
  })
  alwaysOnTop.addEventListener('change', () => {
    void invoke('set_always_on_top', { value: alwaysOnTop.checked })
  })
  petScale.addEventListener('input', () => { applyScale(Number(petScale.value), 60) })
  petScale.addEventListener('change', () => { applyScale(Number(petScale.value)) })
  resetScale.addEventListener('click', () => { applyScale(defaultScale) })
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target as Node)) hideMenu()
  })
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideMenu() })

  window.setInterval(() => { void pollGaze() }, 50)
  render()
  await invoke('renderer_ready')
}

void start()
