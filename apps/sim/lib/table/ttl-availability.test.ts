import { describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({ mockIsFeatureEnabled: vi.fn() }))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

import { assertTableRowTtlEnabled } from '@/lib/table/ttl-availability'

describe('table row TTL availability', () => {
  it('rejects TTL column creation while the flag is disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    await expect(assertTableRowTtlEnabled()).rejects.toMatchObject({
      code: 'validation',
      detailCode: 'TABLE_ROW_TTL_DISABLED',
    })
  })

  it('propagates flag lookup failures instead of reporting the feature as disabled', async () => {
    const error = new Error('flag service unavailable')
    mockIsFeatureEnabled.mockRejectedValue(error)

    await expect(assertTableRowTtlEnabled()).rejects.toBe(error)
  })
})
