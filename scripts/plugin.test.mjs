import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as WhaleGirl from '../lib/plugin.js'

test('Cordis loads the disabled bundle plugin without launching a sidecar', async () => {
  const ctx = new Context()
  ctx.provide('agents', {})
  ctx.provide('sessions', {})
  await ctx.plugin(WhaleGirl, { enabled: false })
  await ctx.fiber.dispose()
})
