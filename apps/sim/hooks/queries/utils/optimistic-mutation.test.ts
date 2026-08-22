/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateTempId } from '@/hooks/queries/utils/optimistic-mutation'

describe('generateTempId', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is unique for ids created within the same millisecond', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const ids = new Set(Array.from({ length: 100 }, () => generateTempId('temp-folder')))

    expect(ids.size).toBe(100)
  })

  it('keeps the prefix so callers can identify optimistic rows', () => {
    expect(generateTempId('temp-folder').startsWith('temp-folder-')).toBe(true)
  })
})
