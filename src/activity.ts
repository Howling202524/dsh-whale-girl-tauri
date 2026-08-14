import type { PetActivitySnapshot } from './protocol.ts'

/** Timings used to turn durable Harness events into short visual reactions. */
export interface ActivityTimings {
  celebrationMs: number
  failureMs: number
  welcomeMs: number
}

/** Process-local projection of live Harness work into desktop-pet activity. */
export class PetActivityTracker {
  readonly #runningAgents = new Set<string>()
  readonly #pendingApprovals = new Set<string>()
  #pulse: { name: string; until: number } = { name: 'welcome', until: 0 }

  constructor(private readonly timings: ActivityTimings, now = Date.now()) {
    this.#pulse = { name: 'welcome', until: now + timings.welcomeMs }
  }

  /** Apply an `agent/status` transition. */
  setAgentStatus(id: string, status: 'idle' | 'running'): void {
    if (status === 'running') this.#runningAgents.add(id)
    else this.#runningAgents.delete(id)
  }

  /** Remove all live state owned by a disposed agent. */
  disposeAgent(id: string): void {
    this.#runningAgents.delete(id)
    for (const approval of this.#pendingApprovals) {
      if (approval.startsWith(`${id}:`)) this.#pendingApprovals.delete(approval)
    }
  }

  /** Mark an approval as waiting for the user. */
  askApproval(sessionId: string, approvalId: string): void {
    this.#pendingApprovals.add(`${sessionId}:${approvalId}`)
  }

  /** Close a pending approval. */
  decideApproval(sessionId: string, approvalId: string): void {
    this.#pendingApprovals.delete(`${sessionId}:${approvalId}`)
  }

  /** Turn one durable turn result into a bounded reaction. */
  finishTurn(reason: string, now = Date.now()): void {
    if (reason === 'completed') {
      this.#pulse = { name: 'celebrate', until: now + this.timings.celebrationMs }
    } else if (reason === 'error' || reason === 'max-tokens' || reason === 'blocked') {
      this.#pulse = { name: 'error', until: now + this.timings.failureMs }
    }
  }

  /** Return the current renderer snapshot without retaining expired pulses. */
  snapshot(now = Date.now()): PetActivitySnapshot {
    const pulseActive = this.#pulse.until > now
    const sessionWait = this.#pendingApprovals.size > 0
    const sessionThink = this.#runningAgents.size > 0 && !sessionWait
    return {
      activity: {
        name: pulseActive ? this.#pulse.name : sessionThink ? 'working' : 'idle',
        until: pulseActive ? this.#pulse.until : 0,
        sessionThink,
        sessionWait,
        turnCompleted: pulseActive && this.#pulse.name === 'celebrate',
      },
    }
  }
}
