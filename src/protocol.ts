/** Activity facts exposed by the Harness plugin to the desktop-pet sidecar. */
export interface PetActivitySnapshot {
  activity: {
    name: string
    until: number
    sessionThink: boolean
    sessionWait: boolean
    turnCompleted: boolean
  }
}

/** Validate one activity snapshot after a process or network hop. */
export function isPetActivitySnapshot(value: unknown): value is PetActivitySnapshot {
  if (typeof value !== 'object' || value === null) return false
  const activity = (value as { activity?: unknown }).activity
  if (typeof activity !== 'object' || activity === null) return false
  const fields = activity as Record<string, unknown>
  return typeof fields.name === 'string'
    && typeof fields.until === 'number'
    && Number.isFinite(fields.until)
    && typeof fields.sessionThink === 'boolean'
    && typeof fields.sessionWait === 'boolean'
    && typeof fields.turnCompleted === 'boolean'
}
