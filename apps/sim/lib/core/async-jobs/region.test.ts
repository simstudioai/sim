import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import {
  resolveTriggerRegion,
  TRIGGER_REGION_EU_CENTRAL,
  TRIGGER_REGION_US_EAST,
} from '@/lib/core/async-jobs/region'

const mockIsFeatureEnabled = featureFlagsMockFns.mockIsFeatureEnabled

describe('resolveTriggerRegion', () => {
  it('returns eu-central-1 when the flag is enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    expect(await resolveTriggerRegion()).toBe(TRIGGER_REGION_EU_CENTRAL)
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('trigger-eu-region')
  })

  it('returns us-east-1 when the flag is disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    expect(await resolveTriggerRegion()).toBe(TRIGGER_REGION_US_EAST)
  })

  it('evaluates globally, passing no gating context', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    await resolveTriggerRegion()
    expect(mockIsFeatureEnabled).toHaveBeenCalledTimes(1)
    expect(mockIsFeatureEnabled.mock.calls[0]).toEqual(['trigger-eu-region'])
  })
})
