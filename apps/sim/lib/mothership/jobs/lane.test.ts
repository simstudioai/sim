/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { afterEach, describe, expect, it } from 'vitest'
import { runJobLane } from '@/lib/mothership/jobs/lane'

describe('runJobLane', () => {
  afterEach(() => {
    resetEnvMock()
    resetDbChainMock()
  })

  it('touches nothing where the worker is not configured', async () => {
    setEnv({ COPILOT_API_KEY: undefined })

    expect(await runJobLane()).toEqual({ claimed: 0 })
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
