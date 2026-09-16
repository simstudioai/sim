/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SOURCE_ACL_MAX_AGE_MS } from '@/lib/knowledge/access/freshness'
import {
  effectiveConnectorSyncIntervalMinutes,
  MAX_PERMISSION_REFRESH_INTERVAL_MINUTES,
} from '@/lib/knowledge/connectors/access-modes'

describe('effective source permission refresh cadence', () => {
  it.each([
    ['workspace', 1440, 1440],
    ['members', 1440, 60],
    ['admin', 1440, 60],
    ['members', 15, 15],
    ['admin', 0, 0],
    ['members', 0, 0],
  ] as const)('%s with configured %d minutes refreshes after %d', (mode, configured, expected) => {
    expect(effectiveConnectorSyncIntervalMinutes(mode, configured)).toBe(expected)
  })

  it('leaves room for jitter, queue delay, and another crawl before evidence expires', () => {
    expect(MAX_PERMISSION_REFRESH_INTERVAL_MINUTES * 60_000 * 2).toBeLessThan(SOURCE_ACL_MAX_AGE_MS)
  })
})
