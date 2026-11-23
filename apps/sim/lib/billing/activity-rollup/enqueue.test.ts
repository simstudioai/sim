import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { runActivityRollupPass } = vi.hoisted(() => ({ runActivityRollupPass: vi.fn() }))

vi.mock('@/lib/billing/activity-rollup/pass', () => ({ runActivityRollupPass }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: async () => true }))
vi.mock('@/lib/core/async-jobs/scheduled-pass', () => ({ startScheduledPass: vi.fn() }))
vi.mock('@/lib/core/config/trigger-availability', () => ({ isTriggerAvailable: () => false }))

import { runActivityRollupMaintenance } from '@/lib/billing/activity-rollup/enqueue'

afterEach(() => {
  resetEnvMock()
  runActivityRollupPass.mockReset()
})

describe('runActivityRollupMaintenance', () => {
  it.each([
    { configured: '50000', expected: 50_000 },
    { configured: 'fast', expected: 20_000 },
    { configured: '0', expected: 20_000 },
    { configured: undefined, expected: 20_000 },
  ])(
    'paces the backfill at $expected rows a second when the deployment sets $configured (env values arrive as strings)',
    async ({ configured, expected }) => {
      setEnv({ ACTIVITY_ROLLUP_BACKFILL_ROWS_PER_SECOND: configured })

      await runActivityRollupMaintenance()

      expect(runActivityRollupPass).toHaveBeenCalledWith(
        expect.objectContaining({ backfillRowsPerSecond: expected })
      )
    }
  )
})
