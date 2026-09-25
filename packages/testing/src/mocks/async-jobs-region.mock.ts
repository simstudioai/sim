import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/async-jobs/region`.
 *
 * Default: `mockResolveTriggerRegion` resolves `'us-east-1'` (the real result while the
 * `trigger-eu-region` flag is off).
 *
 * @example
 * ```ts
 * import { asyncJobsRegionMockFns } from '@sim/testing/mocks/async-jobs-region.mock'
 *
 * asyncJobsRegionMockFns.mockResolveTriggerRegion.mockResolvedValue('eu-central-1')
 * ```
 */
export const asyncJobsRegionMockFns = {
  mockResolveTriggerRegion: vi.fn(async (): Promise<string> => 'us-east-1'),
}

/**
 * Static mock module for `@/lib/core/async-jobs/region`. Region constants carry the real values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
 * ```
 */
export const asyncJobsRegionMock = {
  TRIGGER_REGION_US_EAST: 'us-east-1',
  TRIGGER_REGION_EU_CENTRAL: 'eu-central-1',
  resolveTriggerRegion: asyncJobsRegionMockFns.mockResolveTriggerRegion,
}
