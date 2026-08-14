/** Declarative sprite source backed by one cell row in an atlas. */
export interface AtlasAnimationSource {
  kind: 'atlas'
  path: string
  row: number
}

/** Declarative sprite source backed by separate normalized frame files. */
export interface FrameAnimationSource {
  kind: 'frames'
  paths: string[]
}

/** One animation in a desktop pet package. */
export interface PetAnimation {
  source: AtlasAnimationSource | FrameAnimationSource
  frames: number[]
  durationsMs: number[]
  playback: 'loop' | 'once' | 'pingpong'
}

/** Runtime-neutral description of one installable desktop pet. */
export interface PetManifest {
  id: string
  displayName: string
  description: string
  spriteVersionNumber: 2
  cell: { width: number; height: number; columns: number; rows: number }
  animations: Record<string, PetAnimation>
  gaze: { rows: [number, number]; directions: number; stepDegrees: number; zero: 'up' }
}

export type { PetActivitySnapshot } from '../protocol.ts'

/** Renderer bootstrap data, with a resolved local asset base URL. */
export interface PetBootstrap {
  manifest: PetManifest
  assetBaseUrl: string
}

/** Persisted Tauri window preferences. Coordinates are physical desktop pixels. */
export interface PetPreferences {
  enabled?: boolean
  x?: number
  y?: number
  scale?: number
  scaleSetByUser?: boolean
  alwaysOnTop?: boolean
}
