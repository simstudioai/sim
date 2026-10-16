/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockEnqueue } = vi.hoisted(() => ({
  mockEnv: { COPILOT_API_KEY: undefined as string | undefined } as Record<
    string,
    string | undefined
  >,
  mockEnqueue: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent: mockEnqueue }))
vi.mock('@/lib/mothership/constants', () => ({ SIM_AGENT_API_URL: 'https://agent.example.test' }))
vi.mock('@/lib/mothership/request/go/fetch', () => ({ fetchGo: vi.fn() }))
vi.mock('@/lib/mothership/request/headers', () => ({ mothershipRequestHeaders: () => ({}) }))
vi.mock('@/lib/mothership/server/agent-url', () => ({ getMothershipSourceEnvHeaders: () => ({}) }))

import { enqueueMemoryCleanup } from '@/lib/mothership/memories/cleanup-outbox'

const executor = { insert: vi.fn() }
const targets = [
  { kind: 'private_owner' as const, userId: 'user-1' },
  { kind: 'workspace' as const, workspaceId: '00000000-0000-4000-8000-000000000001' },
]

describe('enqueueMemoryCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.COPILOT_API_KEY = undefined
  })

  it('queues nothing when this Sim has no worker credential', async () => {
    await enqueueMemoryCleanup(executor, targets)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('queues one credential-bound event per destination and target', async () => {
    mockEnv.COPILOT_API_KEY = 'configured-key'
    await enqueueMemoryCleanup(executor, targets)
    expect(mockEnqueue).toHaveBeenCalledTimes(targets.length)
    for (const [, , payload] of mockEnqueue.mock.calls)
      expect(payload).toMatchObject({
        baseUrl: 'https://agent.example.test',
        credentialFingerprint: expect.any(String),
      })
  })
})
