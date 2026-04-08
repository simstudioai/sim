import { describe, expect, it } from 'vitest'
import { createTableColumn } from './table.factory'

describe('table factory', () => {
  it('generates default column names that match table naming rules', () => {
    const generatedNames = Array.from({ length: 100 }, () => createTableColumn().name)

    for (const name of generatedNames) {
      expect(name).toMatch(/^[a-z_][a-z0-9_]*$/)
    }
  })
})
