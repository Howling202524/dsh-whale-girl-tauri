import type { PetActivitySnapshot } from './types.ts'

const FULL_CIRCLE_DEGREES = 360
const DEFAULT_DIRECTION_COUNT = 16

/** Return the shortest unsigned angular distance between two headings. */
function angularDistance(left: number, right: number): number {
  const difference = Math.abs(left - right) % FULL_CIRCLE_DEGREES
  return Math.min(difference, FULL_CIRCLE_DEGREES - difference)
}

/**
 * Quantize a screen-space vector into clockwise gaze sectors where up is zero.
 * The pet stays neutral while the cursor overlaps it or is outside the configured radius.
 *
 * @param dx Horizontal cursor offset from the pet centre, positive to screen-right.
 * @param dy Vertical cursor offset from the pet centre, positive downward.
 * @param insidePet Whether the cursor overlaps the pet window.
 * @param previous Previously selected direction index, when one exists.
 * @param outerRadius Maximum distance from the pet centre that enables gaze.
 * @param hysteresis Extra degrees required before leaving the previous sector.
 * @returns A clockwise direction index, or null when gaze is inactive.
 */
export function gazeDirection(
  dx: number,
  dy: number,
  insidePet: boolean,
  previous: number | null,
  outerRadius: number,
  hysteresis = 4,
): number | null {
  if (insidePet || Math.hypot(dx, dy) > outerRadius) return null
  const step = FULL_CIRCLE_DEGREES / DEFAULT_DIRECTION_COUNT
  const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + FULL_CIRCLE_DEGREES) % FULL_CIRCLE_DEGREES
  const candidate = Math.round(angle / step) % DEFAULT_DIRECTION_COUNT
  if (previous === null) return candidate
  const previousCentre = previous * step
  return angularDistance(angle, previousCentre) <= step / 2 + hysteresis ? previous : candidate
}

/** Map Harness activity facts to the preferred visual animation. */
export function preferredAnimation(snapshot: PetActivitySnapshot, now = Date.now()): string {
  const activity = snapshot.activity
  const burstActive = activity.until > now
  if (burstActive && (activity.name === 'error' || activity.name === 'disappointed')) return 'failed'
  if (burstActive && activity.name === 'welcome') return 'curtsy'
  if (burstActive && activity.name === 'celebrate') return 'cheer'
  if (activity.sessionWait) return 'waiting'
  if (burstActive && activity.turnCompleted) return 'cheer'
  if (activity.sessionThink || activity.name === 'working') return 'focus'
  return 'idle'
}

/** Convert a 16-way gaze index to its atlas row and column. */
export function gazeCell(direction: number): { row: number; column: number } {
  const normalized = ((Math.round(direction) % DEFAULT_DIRECTION_COUNT) + DEFAULT_DIRECTION_COUNT) % DEFAULT_DIRECTION_COUNT
  return normalized < 8 ? { row: 9, column: normalized } : { row: 10, column: normalized - 8 }
}
