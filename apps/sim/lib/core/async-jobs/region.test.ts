/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

import {
  resolveTriggerRegion,
  TRIGGER_REGION_EU_CENTRAL,
  TRIGGER_REGION_US_EAST,
} from '@/lib/core/async-jobs/region'

describe('resolveTriggerRegion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
