/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { mothershipAgentUrlMock } from '@sim/testing/mocks/mothership-agent-url.mock'
import { mothershipGoFetchMock } from '@sim/testing/mocks/mothership-go-fetch.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)
vi.mock('@/lib/mothership/constants', () => ({ SIM_AGENT_API_URL: 'https://agent.example.test' }))
vi.mock('@/lib/mothership/request/go/fetch', () => mothershipGoFetchMock)
vi.mock('@/lib/mothership/request/headers', () => ({ mothershipRequestHeaders: () => ({}) }))
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)

import { enqueueMemoryCleanup } from '@/lib/mothership/memories/cleanup-outbox'

const { mockEnqueueOutboxEvents } = outboxServiceMockFns
const executor = { insert: vi.fn() }
const targets = [
  { kind: 'private_owner' as const, userId: 'user-1' },
  { kind: 'workspace' as const, workspaceId: '00000000-0000-4000-8000-000000000001' },
]

describe('enqueueMemoryCleanup', () => {
  beforeEach(() => {
    resetEnvMock()
    setEnv({
      COPILOT_API_KEY: undefined,
      COPILOT_DEV_URL: undefined,
      COPILOT_STAGING_URL: undefined,
      COPILOT_PROD_URL: undefined,
    })
  })

  it('queues nothing when this Sim has no worker credential', async () => {
    await enqueueMemoryCleanup(executor, targets)
    expect(mockEnqueueOutboxEvents).not.toHaveBeenCalled()
  })
})
