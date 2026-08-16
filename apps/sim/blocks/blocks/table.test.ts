/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({
  getTrigger: vi.fn(() => ({ subBlocks: [] })),
}))

import { TableBlock } from '@/blocks/blocks/table'

function params(input: Record<string, unknown>): Record<string, unknown> {
  return TableBlock.tools.config?.params?.(input as never) as Record<string, unknown>
}

describe('table query_rows transformer', () => {
  it('keeps an omitted limit unbounded', () => {
    expect(params({ operation: 'query_rows', tableId: 'table-1' }).limit).toBeUndefined()
  })

  it('parses and validates an explicit limit', () => {
    expect(params({ operation: 'query_rows', tableId: 'table-1', limit: '25' }).limit).toBe(25)
    expect(params({ operation: 'query_rows', tableId: 'table-1', limit: '1000000' }).limit).toBe(
      1000000
    )
    expect(() => params({ operation: 'query_rows', tableId: 'table-1', limit: 'abc' })).toThrow(
      /Invalid number for Limit/
    )
  })
})
