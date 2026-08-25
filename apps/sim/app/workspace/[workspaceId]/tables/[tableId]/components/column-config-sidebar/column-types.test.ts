/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ColumnDefinition } from '@/lib/table'
import { columnTypeOptionsForTable } from './column-types'

describe('columnTypeOptionsForTable', () => {
  const ttlColumn: ColumnDefinition = { name: 'expires_at', type: 'ttl' }

  it('disables TTL with an explanation when the table already has one', () => {
    const availableTtl = columnTypeOptionsForTable([{ name: 'name', type: 'string' }]).find(
      (option) => option.type === 'ttl'
    )
    const unavailableTtl = columnTypeOptionsForTable([ttlColumn]).find(
      (option) => option.type === 'ttl'
    )

    expect(availableTtl?.disabledReason).toBeUndefined()
    expect(unavailableTtl?.disabledReason).toBe('Only one TTL column allowed per table')
  })

  it('keeps TTL enabled while editing the existing TTL column', () => {
    const ttlOption = columnTypeOptionsForTable([ttlColumn], ttlColumn).find(
      (option) => option.type === 'ttl'
    )

    expect(ttlOption?.disabledReason).toBeUndefined()
  })
})
