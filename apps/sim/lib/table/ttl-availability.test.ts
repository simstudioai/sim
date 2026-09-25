import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import { assertTableRowTtlEnabled } from '@/lib/table/ttl-availability'

const mockIsFeatureEnabled = featureFlagsMockFns.mockIsFeatureEnabled

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
