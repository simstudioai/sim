/**
 * @vitest-environment node
 */
import {
  createEnvMock,
  schemaMock,
  urlsMock,
  urlsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect, mockTransaction, mockCleanupExternalWebhook, mockWorkflowDeleted } = vi.hoisted(
  () => ({
    mockSelect: vi.fn(),
    mockTransaction: vi.fn(),
    mockCleanupExternalWebhook: vi.fn(),
    mockWorkflowDeleted: vi.fn(),
  })
)

const mockGetWorkflowById = workflowsUtilsMockFns.mockGetWorkflowById

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    transaction: mockTransaction,
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/webhooks/provider-subscriptions', () => ({
  cleanupExternalWebhook: (...args: unknown[]) => mockCleanupExternalWebhook(...args),
}))

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({ SOCKET_SERVER_URL: 'http://socket.test', INTERNAL_API_SECRET: 'secret' })
)

vi.mock('@/lib/core/utils/urls', () => urlsMock)

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    workflowDeleted: (...args: unknown[]) => mockWorkflowDeleted(...args),
  },
}))

import { archiveWorkflow } from '@/lib/workflows/lifecycle'

function createSelectChain<T>(result: T) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(result),
  }

  return chain
}

function createUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }
}

describe('workflow lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    urlsMockFns.mockGetSocketServerUrl.mockReturnValue('http://socket.test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
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

    mockSelect.mockReturnValue(createSelectChain([]))

    const tx = {
      update: vi.fn().mockImplementation(() => createUpdateChain()),
    }
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkflow('workflow-1', { requestId: 'req-1' })

    expect(result.archived).toBe(true)
    expect(tx.update).toHaveBeenCalledTimes(8)
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
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
