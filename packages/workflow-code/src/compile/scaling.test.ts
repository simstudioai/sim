/**
 * Compile steps grow linearly with the workflow (see `growth` for how a case is measured).
 */

import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, expect, it } from 'vitest'
import { stronglyConnected } from './edges'

describe('compile scaling', () => {
  it('finds the cycles of a block wired to many targets in linear time', () => {
    expectLinearGrowth((n) => {
      const targets = Array.from({ length: n }, (_, i) => `t${i}`)
      const keys = ['hub', ...targets]
      return () => stronglyConnected(keys, (key) => (key === 'hub' ? [...targets] : []))
    }, 5_000)
  })
})
