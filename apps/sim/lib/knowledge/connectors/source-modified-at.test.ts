/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveSourceModifiedAt } from '@/lib/knowledge/connectors/source-modified-at'

const NOW = new Date('2026-09-01T12:00:00Z')

describe('resolveSourceModifiedAt', () => {
  it.each([
    ['modifiedTime', '2026-08-20T12:00:00Z'],
    ['lastModified', '2026-08-20T12:00:00.000Z'],
    ['lastModifiedDateTime', '2026-08-20T12:00:00Z'],
    ['updatedAt', '2026-08-20T12:00:00Z'],
    ['updated', '2026-08-20T12:00:00Z'],
    ['lastUpdated', '2026-08-20 12:00:00Z'],
  ])('reads %s', (key, value) => {
    expect(resolveSourceModifiedAt({ [key]: value }, NOW)?.toISOString()).toBe(
      '2026-08-20T12:00:00.000Z'
    )
  })

  it('accepts Date objects and epoch seconds or milliseconds', () => {
    const at = new Date('2026-08-20T12:00:00Z')
    expect(resolveSourceModifiedAt({ modifiedAt: at }, NOW)).toBe(at)
    expect(resolveSourceModifiedAt({ updatedAt: at.getTime() }, NOW)?.getTime()).toBe(at.getTime())
    expect(resolveSourceModifiedAt({ updatedAt: at.getTime() / 1000 }, NOW)?.getTime()).toBe(
      at.getTime()
    )
  })

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

  it('rejects placeholders and far-future values', () => {
    expect(resolveSourceModifiedAt({ modifiedTime: 0 }, NOW)).toBeNull()
    expect(resolveSourceModifiedAt({ modifiedTime: '1970-01-01T00:00:00Z' }, NOW)).toBeNull()
    expect(resolveSourceModifiedAt({ modifiedTime: '2030-01-01T00:00:00Z' }, NOW)).toBeNull()
    expect(resolveSourceModifiedAt({ modifiedTime: '' }, NOW)).toBeNull()
    expect(resolveSourceModifiedAt(undefined, NOW)).toBeNull()
    expect(resolveSourceModifiedAt({}, NOW)).toBeNull()
  })
})
