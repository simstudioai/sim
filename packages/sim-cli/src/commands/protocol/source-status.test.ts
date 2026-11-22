import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, it } from 'vitest'
import { pathFilter } from './source-status'

describe('pathFilter', () => {
  it('reads a filter with a long run of slashes before its last segment in linear time', () => {
    expectLinearGrowth((n) => {
      const filter = `wf${'/'.repeat(n)}workflow.ts`
      return () => pathFilter([filter], '.')
    }, 4_000)
  })
})
