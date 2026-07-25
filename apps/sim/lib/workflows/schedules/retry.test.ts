/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBackoffWithJitter } = vi.hoisted(() => ({
  mockBackoffWithJitter: vi.fn(),
}))

vi.mock('@sim/utils/retry', () => ({
  backoffWithJitter: mockBackoffWithJitter,
}))

import {
  SCHEDULE_INFRA_RETRY_BASE_MS,
  SCHEDULE_INFRA_RETRY_MAX_MS,
} from '@/lib/workflows/schedules/execution-limits'
import { calculateScheduleInfraRetryDelayMs } from '@/lib/workflows/schedules/retry'

describe('calculateScheduleInfraRetryDelayMs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the configured bounded jitter calculation', () => {
    mockBackoffWithJitter.mockReturnValue(1_234.6)

    expect(calculateScheduleInfraRetryDelayMs(3)).toBe(1_235)
    expect(mockBackoffWithJitter).toHaveBeenCalledWith(3, null, {
      baseMs: SCHEDULE_INFRA_RETRY_BASE_MS,
      maxMs: SCHEDULE_INFRA_RETRY_MAX_MS,
    })
  })

  it('clamps the rounded delay to the schedule retry ceiling', () => {
    mockBackoffWithJitter.mockReturnValue(SCHEDULE_INFRA_RETRY_MAX_MS + 1_000)

    expect(calculateScheduleInfraRetryDelayMs(1)).toBe(SCHEDULE_INFRA_RETRY_MAX_MS)
  })
})
