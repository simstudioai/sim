/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { appendBrexArrayParam, appendBrexPagination, toBrexDateTime } from '@/tools/brex/utils'

describe('toBrexDateTime', () => {
  it('strips a Z suffix by converting to naive UTC', () => {
    expect(toBrexDateTime('2026-01-01T00:00:00Z')).toBe('2026-01-01T00:00:00')
    expect(toBrexDateTime('2026-01-01T12:30:45.123Z')).toBe('2026-01-01T12:30:45')
  })

  it('converts timezone offsets to UTC before stripping', () => {
    expect(toBrexDateTime('2026-01-01T02:00:00+02:00')).toBe('2026-01-01T00:00:00')
    expect(toBrexDateTime('2025-12-31T19:00:00-05:00')).toBe('2026-01-01T00:00:00')
  })

  it('passes through timestamps without a timezone unchanged', () => {
    expect(toBrexDateTime('2026-01-01T00:00:00')).toBe('2026-01-01T00:00:00')
    expect(toBrexDateTime('2026-01-01T00:00:00.000')).toBe('2026-01-01T00:00:00.000')
  })

  it('passes through unparseable values unchanged', () => {
    expect(toBrexDateTime('not-a-date-Z')).toBe('not-a-date-Z')
  })
})

describe('appendBrexArrayParam', () => {
  it('appends repeated params from a comma-separated value, trimming entries', () => {
    const query = new URLSearchParams()
    appendBrexArrayParam(query, 'status[]', ' APPROVED, SETTLED ,, ')
    expect(query.getAll('status[]')).toEqual(['APPROVED', 'SETTLED'])
  })

  it('does nothing for an empty value', () => {
    const query = new URLSearchParams()
    appendBrexArrayParam(query, 'status[]', undefined)
    expect(query.toString()).toBe('')
  })
})

describe('appendBrexPagination', () => {
  it('appends cursor and limit only when present', () => {
    const query = new URLSearchParams()
    appendBrexPagination(query, { cursor: 'abc', limit: '10' })
    expect(query.get('cursor')).toBe('abc')
    expect(query.get('limit')).toBe('10')

    const empty = new URLSearchParams()
    appendBrexPagination(empty, {})
    expect(empty.toString()).toBe('')
  })
})
