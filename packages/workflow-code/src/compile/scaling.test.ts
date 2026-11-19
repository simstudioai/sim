/**
 * Compile steps grow linearly with the workflow (see `growth` for how a case is measured).
 */
import { describe, expect, it } from 'vitest'
import { growth, MAX_GROWTH } from '../scaling.test-helpers'
import { stronglyConnected } from './edges'

describe('compile scaling', () => {
  it('finds the cycles of a block wired to many targets in linear time', () => {
    const ratio = growth((n) => {
      const targets = Array.from({ length: n }, (_, i) => `t${i}`)
      const keys = ['hub', ...targets]
      return () => stronglyConnected(keys, (key) => (key === 'hub' ? [...targets] : []))
    }, 5_000)
    expect(ratio).toBeLessThan(MAX_GROWTH)
  })
})
