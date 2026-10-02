import assert from 'node:assert/strict'
import test from 'node:test'
import { InMemorySessionLimiter } from '../src/rate-limit.js'

test('session limiter allows one live investigation and can release rejected retrievals', () => {
  const limiter = new InMemorySessionLimiter(1)
  assert.deepEqual(limiter.consume('visitor'), { allowed: true, remaining: 0 })
  assert.deepEqual(limiter.consume('visitor'), { allowed: false, remaining: 0 })
  limiter.release('visitor')
  assert.deepEqual(limiter.consume('visitor'), { allowed: true, remaining: 0 })
})
