import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, it } from 'vitest'
import { seedRowsFiles } from './workspace-source-dir'

describe('seedRowsFiles', () => {
  it('reads a table declaration of unclosed column calls in linear time', () => {
    expectLinearGrowth((n) => {
      const files = { 'tables/leads.ts': 'column.text('.repeat(n) }
      return () => seedRowsFiles(files)
    }, 4_000)
  })
})
