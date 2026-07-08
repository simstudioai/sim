/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tableEventStreamQuerySchema } from '@/lib/api/contracts/tables'

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
