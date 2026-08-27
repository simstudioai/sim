/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ColumnDefinition } from '@/lib/table'
import { columnTypeOptionsForTable } from './column-types'

describe('columnTypeOptionsForTable', () => {
  const ttlColumn: ColumnDefinition = { name: 'expires_at', type: 'ttl' }

  it('disables TTL with an explanation when the table already has one', () => {
    const availableTtl = columnTypeOptionsForTable([{ name: 'name', type: 'string' }], undefined, {
      tableRowTtlEnabled: true,
    }).find((option) => option.type === 'ttl')
    const unavailableTtl = columnTypeOptionsForTable([ttlColumn], undefined, {
      tableRowTtlEnabled: true,
    }).find((option) => option.type === 'ttl')

    expect(availableTtl?.disabledReason).toBeUndefined()
    expect(unavailableTtl?.disabledReason).toBe('Only one Expiration column allowed per table')
  })

  it('keeps TTL enabled while editing the existing TTL column', () => {
    const ttlOption = columnTypeOptionsForTable([ttlColumn], ttlColumn, {
      tableRowTtlEnabled: true,
    }).find((option) => option.type === 'ttl')

    expect(ttlOption?.disabledReason).toBeUndefined()
  })

  it('hides TTL while disabled unless editing an existing TTL column', () => {
    expect(
      columnTypeOptionsForTable([], undefined, { tableRowTtlEnabled: false }).some(
        (option) => option.type === 'ttl'
      )
    ).toBe(false)
    expect(
      columnTypeOptionsForTable([ttlColumn], ttlColumn, { tableRowTtlEnabled: false }).some(
        (option) => option.type === 'ttl'
      )
    ).toBe(true)
  })
})
