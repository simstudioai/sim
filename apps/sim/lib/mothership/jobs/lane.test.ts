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

  it.each([
    { COPILOT_API_KEY: undefined, REDIS_URL: 'redis://localhost:6379' },
    { COPILOT_API_KEY: 'key', REDIS_URL: undefined },
  ])('touches nothing where turns cannot be durable (%o)', async (env) => {
    setEnv(env)

    expect(await runJobLane()).toEqual({ claimed: 0 })
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
