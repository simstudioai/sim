import {
  dbChainMockFns,
  resetDbChainMock,
  resetEnvMock,
  setEnv,
  urlsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { getMockPlatformEvent, telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  setEnv({ SOCKET_SERVER_URL: 'http://socket.test', INTERNAL_API_SECRET: 'secret' })
})

afterAll(resetEnvMock)

const { mockCleanupExternalWebhook } = vi.hoisted(() => ({
  mockCleanupExternalWebhook: vi.fn(),
}))

const mockGetWorkflowById = workflowsUtilsMockFns.mockGetWorkflowById

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/webhooks/provider-subscriptions', () => ({
  cleanupExternalWebhook: (...args: unknown[]) => mockCleanupExternalWebhook(...args),
}))

vi.mock('@/lib/core/telemetry', () => telemetryMock)

import { archiveWorkflow } from '@/lib/workflows/lifecycle'

const mockWorkflowDeleted = getMockPlatformEvent('workflowDeleted')

describe('workflow lifecycle', () => {
  beforeEach(() => {
    resetDbChainMock()
    urlsMockFns.mockGetSocketServerUrl.mockReturnValue('http://socket.test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('archives workflow and disables live surfaces', async () => {
    mockGetWorkflowById
      .mockResolvedValueOnce({
        id: 'workflow-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        name: 'Workflow 1',
        archivedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'workflow-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        name: 'Workflow 1',
        archivedAt: new Date(),
      })

    const result = await archiveWorkflow('workflow-1', { requestId: 'req-1' })

    expect(result.archived).toBe(true)
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(7)
    expect(dbChainMockFns.set.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'superseded' })
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
    expect(mockWorkflowDeleted).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
    expect(fetch).toHaveBeenCalledWith(
      'http://socket.test/api/workflow-deleted',
      expect.any(Object)
    )
  })

  it('is idempotent for already archived workflows', async () => {
    mockGetWorkflowById.mockResolvedValue({
      id: 'workflow-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      name: 'Workflow 1',
      archivedAt: new Date(),
    })

    const result = await archiveWorkflow('workflow-1', { requestId: 'req-1' })

    expect(result.archived).toBe(false)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
