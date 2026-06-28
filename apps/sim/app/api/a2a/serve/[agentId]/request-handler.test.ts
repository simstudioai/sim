/**
 * @vitest-environment node
 */
import { A2AError } from '@a2a-js/sdk/server'
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/a2a/push-notifications', () => ({
  notifyTaskStateChange: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/execution/cancellation', () => ({
  markExecutionCancelled: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  getRedisClient: vi.fn(() => null),
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: vi.fn().mockResolvedValue({ isValid: true, resolvedIP: '1.2.3.4' }),
  secureFetchWithPinnedIP: vi.fn(),
}))
vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn().mockResolvedValue('internal-token'),
}))
vi.mock('@/ee/whitelabeling', () => ({
  getBrandConfig: () => ({ name: 'Sim' }),
}))

import { buildAgentCard } from '@/lib/a2a/agent-card'
import { SimA2ARequestHandler } from '@/app/api/a2a/serve/[agentId]/request-handler'

const agent = { id: 'agent-1', name: 'A', workflowId: 'wf-1', workspaceId: 'ws-1' }
const agentCard = buildAgentCard({
  agent: { id: agent.id, name: agent.name, version: '1.0.0' },
  baseUrl: 'https://example.com',
  providerOrganization: 'Sim',
})

function makeHandler(callerFingerprint = 'user:u1') {
  return new SimA2ARequestHandler({ agent, agentCard, callerFingerprint })
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    agentId: 'agent-1',
    sessionId: 'ctx-1',
    status: 'completed',
    messages: [],
    artifacts: [],
    executionId: null,
    metadata: { callerFingerprint: 'user:u1' },
    ...overrides,
  }
}

describe('SimA2ARequestHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('getAgentCard returns the configured card', async () => {
    await expect(makeHandler().getAgentCard()).resolves.toBe(agentCard)
  })

  it('getAuthenticatedExtendedAgentCard rejects when not configured', async () => {
    await expect(makeHandler().getAuthenticatedExtendedAgentCard()).rejects.toMatchObject({
      code: -32007,
    })
  })

  it('getTask returns an SDK Task for an owned task', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([taskRow({ status: 'completed' })])

    const task = await makeHandler('user:u1').getTask({ id: 't1' })

    expect(task.kind).toBe('task')
    expect(task.id).toBe('t1')
    expect(task.contextId).toBe('ctx-1')
    expect(task.status.state).toBe('completed')
  })

  it('hides a task owned by a different caller (taskNotFound)', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      taskRow({ metadata: { callerFingerprint: 'user:someone-else' } }),
    ])

    await expect(makeHandler('user:u1').getTask({ id: 't1' })).rejects.toMatchObject({
      code: -32001,
    })
  })

  it('cancelTask rejects a task already in a terminal state (taskNotCancelable)', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([taskRow({ status: 'completed' })])

    await expect(makeHandler('user:u1').cancelTask({ id: 't1' })).rejects.toMatchObject({
      code: -32002,
    })
  })

  it('cancelTask cancels a running task and returns canceled state', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      taskRow({ status: 'working', executionId: 'exec-1' }),
    ])

    const task = await makeHandler('user:u1').cancelTask({ id: 't1' })

    expect(task.status.state).toBe('canceled')
    expect(task.id).toBe('t1')
  })

  it('all thrown errors are SDK A2AError instances', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    const error = await makeHandler('user:u1')
      .getTask({ id: 'missing' })
      .catch((e) => e)
    expect(error).toBeInstanceOf(A2AError)
    expect(error.code).toBe(-32001)
  })
})
