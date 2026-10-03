import { describe, expect, it } from 'vitest'
import { resolveSourceModifiedAt } from '@/lib/knowledge/connectors/source-modified-at'

const NOW = new Date('2026-09-01T12:00:00Z')

describe('resolveSourceModifiedAt', () => {
  it('prefers the earlier key and skips values that are not plausible timestamps', () => {
    expect(
      resolveSourceModifiedAt(
        { updatedAt: '2026-08-01T00:00:00Z', modifiedTime: '2026-08-20T12:00:00Z' },
        NOW
      )?.toISOString()
    ).toBe('2026-08-20T12:00:00.000Z')
    expect(
      resolveSourceModifiedAt(
        { modifiedTime: 'yesterday', updatedAt: '2026-08-01T00:00:00Z' },
        NOW
      )?.toISOString()
    ).toBe('2026-08-01T00:00:00.000Z')
  })

  it('rejects an invalid Date instance and a number outside the Date range', () => {
    expect(resolveSourceModifiedAt({ modifiedTime: new Date('not a date') })).toBeNull()
    expect(resolveSourceModifiedAt({ modifiedTime: 1e20 })).toBeNull()
  })

  it('rejects placeholders and far-future values', () => {
    expect(resolveSourceModifiedAt({ modifiedTime: 0 }, NOW)).toBeNull()
    expect(resolveSourceModifiedAt({ modifiedTime: '1970-01-01T00:00:00Z' }, NOW)).toBeNull()
    expect(resolveSourceModifiedAt({ modifiedTime: '2030-01-01T00:00:00Z' }, NOW)).toBeNull()
    expect(resolveSourceModifiedAt({ modifiedTime: '' }, NOW)).toBeNull()
    expect(resolveSourceModifiedAt(undefined, NOW)).toBeNull()
    expect(resolveSourceModifiedAt({}, NOW)).toBeNull()
  })
})
