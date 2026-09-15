/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({ mockIsFeatureEnabled: vi.fn() }))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

import { assertTableRowTtlEnabled, isTableRowTtlEnabled } from '@/lib/table/ttl-availability'

describe('table row TTL availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the global table-row-ttl flag without rollout context', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)

    await expect(isTableRowTtlEnabled()).resolves.toBe(true)
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('table-row-ttl')
  })

  it('rejects TTL column creation while the flag is disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    await expect(assertTableRowTtlEnabled()).rejects.toMatchObject({
      code: 'validation',
      detailCode: 'TABLE_ROW_TTL_DISABLED',
    })
  })

  it('allows TTL column creation while the flag is enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)

    await expect(assertTableRowTtlEnabled()).resolves.toBeUndefined()
  })

  it('propagates flag lookup failures instead of reporting the feature as disabled', async () => {
    const error = new Error('flag service unavailable')
    mockIsFeatureEnabled.mockRejectedValue(error)

    await expect(assertTableRowTtlEnabled()).rejects.toBe(error)
  })
})
