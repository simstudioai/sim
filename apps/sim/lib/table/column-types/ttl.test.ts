/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { retypeCellRewrite } from '@/lib/table/columns/service'
import type { ColumnDefinition } from '@/lib/table/types'

const column = (over: Partial<ColumnDefinition>): ColumnDefinition =>
  ({ name: 'col', type: 'string', ...over }) as ColumnDefinition

describe('TTL column type', () => {
  it('converts epoch seconds to an ISO date before retyping', () => {
    expect(
      retypeCellRewrite(1_700_000_000, column({ type: 'date' }), column({ type: 'ttl' }))
    ).toEqual({ value: '2023-11-14T22:13:20Z' })
  })
})
