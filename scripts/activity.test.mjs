import assert from 'node:assert/strict'
import test from 'node:test'
import { PetActivityTracker } from '../lib/activity.js'

const timings = { celebrationMs: 4000, failureMs: 3000, welcomeMs: 2000 }

test('agent and approval state select working and waiting activity', () => {
  const tracker = new PetActivityTracker(timings, 0)
  tracker.setAgentStatus('agent-a', 'running')
  assert.equal(tracker.snapshot(3000).activity.sessionThink, true)
  tracker.askApproval('agent-a', 'approval-1')
  assert.deepEqual(tracker.snapshot(3000).activity, {
    name: 'idle', until: 0, sessionThink: false, sessionWait: true, turnCompleted: false,
  })
  tracker.decideApproval('agent-a', 'approval-1')
  assert.equal(tracker.snapshot(3000).activity.name, 'working')
  tracker.disposeAgent('agent-a')
  assert.equal(tracker.snapshot(3000).activity.name, 'idle')
})

test('turn completion and failure pulses expire deterministically', () => {
  const tracker = new PetActivityTracker(timings, 0)
  tracker.finishTurn('completed', 100)
  assert.deepEqual(tracker.snapshot(200).activity, {
    name: 'celebrate', until: 4100, sessionThink: false, sessionWait: false, turnCompleted: true,
  })
  assert.equal(tracker.snapshot(4100).activity.turnCompleted, false)
  tracker.finishTurn('error', 5000)
  assert.equal(tracker.snapshot(5001).activity.name, 'error')
  assert.equal(tracker.snapshot(8000).activity.name, 'idle')
})
