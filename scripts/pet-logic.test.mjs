import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { gazeCell, gazeDirection, preferredAnimation } from '../lib/sidecar/logic.js'

const manifest = JSON.parse(readFileSync(new URL('../resources/whale-girl/pet.json', import.meta.url), 'utf8'))

test('gaze sectors follow the clockwise up-zero atlas convention', () => {
  assert.equal(gazeDirection(0, -200, false, null, 400), 0)
  assert.equal(gazeDirection(200, 0, false, null, 400), 4)
  assert.equal(gazeDirection(0, 200, false, null, 400), 8)
  assert.equal(gazeDirection(-200, 0, false, null, 400), 12)
  assert.equal(gazeDirection(10, 10, true, null, 400), null)
  assert.equal(gazeDirection(500, 0, false, null, 400), null)
})

test('gaze cells span the two direction rows', () => {
  assert.deepEqual(gazeCell(0), { row: 9, column: 0 })
  assert.deepEqual(gazeCell(7), { row: 9, column: 7 })
  assert.deepEqual(gazeCell(8), { row: 10, column: 0 })
  assert.deepEqual(gazeCell(15), { row: 10, column: 7 })
})

test('Harness state maps to expressive animation preferences', () => {
  const base = { activity: { name: 'idle', until: 0, sessionThink: false, sessionWait: false, turnCompleted: false } }
  assert.equal(preferredAnimation(base, 100), 'idle')
  assert.equal(preferredAnimation({ activity: { ...base.activity, sessionThink: true } }, 100), 'focus')
  assert.equal(preferredAnimation({ activity: { ...base.activity, sessionWait: true } }, 100), 'waiting')
  assert.equal(preferredAnimation({ activity: { ...base.activity, name: 'celebrate', until: 200 } }, 100), 'cheer')
  assert.equal(preferredAnimation({ activity: { ...base.activity, name: 'error', until: 200 } }, 100), 'failed')
  assert.equal(preferredAnimation({ activity: { ...base.activity, turnCompleted: true, until: 90 } }, 100), 'idle')
})

test('active work enters through row 8 and loops note-taking on row 9', () => {
  assert.equal(manifest.animations['focus-intro'].source.row, 7)
  assert.equal(manifest.animations['focus-intro'].playback, 'once')
  assert.equal(manifest.animations.focus.source.row, 8)
  assert.equal(manifest.animations.focus.playback, 'loop')
})
