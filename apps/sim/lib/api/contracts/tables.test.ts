/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tableColumnSchema, tableEventStreamQuerySchema } from '@/lib/api/contracts/tables'

describe('tableColumnSchema', () => {
  it('accepts display names with spaces, digits-first, punctuation, and unicode', () => {
    for (const name of ['First Name', '2024 Revenue', 'price ($)', 'caf\u00e9']) {
      expect(tableColumnSchema.safeParse({ name, type: 'string' }).success).toBe(true)
    }
  })

  it('rejects invisible characters, edge whitespace, leading $, and the CSV-dialog sentinels', () => {
    const bad = [' leading', 'trailing ', 'a\u0000b', 'zero\u200bwidth', '$or', '\u0000skip']
    for (const name of bad) {
      expect(tableColumnSchema.safeParse({ name, type: 'string' }).success).toBe(false)
    }
  })

  it('accepts identifier-shaped column ids and rejects non-identifier ids', () => {
    const good = { name: 'x', type: 'string' }
    expect(tableColumnSchema.safeParse({ ...good, id: 'col_ab12' }).success).toBe(true)
    expect(tableColumnSchema.safeParse({ ...good, id: 'legacy_name' }).success).toBe(true)
    for (const id of ["a-b'", 'has space', '1leading', '']) {
      expect(tableColumnSchema.safeParse({ ...good, id }).success).toBe(false)
    }
  })
})

describe('tableEventStreamQuerySchema', () => {
  it('parses an explicit cursor', () => {
    expect(tableEventStreamQuerySchema.parse({ from: '7' })).toEqual({ from: 7 })
  })

  it('keeps 0 as an explicit replay-from-start cursor', () => {
    expect(tableEventStreamQuerySchema.parse({ from: '0' })).toEqual({ from: 0 })
  })

  it('yields undefined when absent — the tail-from-latest signal', () => {
    expect(tableEventStreamQuerySchema.parse({})).toEqual({ from: undefined })
  })

  it('yields undefined for invalid values instead of coercing to a full replay', () => {
    expect(tableEventStreamQuerySchema.parse({ from: 'abc' })).toEqual({ from: undefined })
    expect(tableEventStreamQuerySchema.parse({ from: '-4' })).toEqual({ from: undefined })
  })
})
