/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockTransaction,
  mockGetWorkflowById,
  mockCleanupExternalWebhook,
  mockWorkflowDeleted,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockGetWorkflowById: vi.fn(),
  mockCleanupExternalWebhook: vi.fn(),
  mockWorkflowDeleted: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    transaction: mockTransaction,
  },
}))

vi.mock('@sim/db/schema', () => ({
  a2aAgent: { archivedAt: 'a2a_archived_at' },
  chat: { archivedAt: 'chat_archived_at' },
  form: { archivedAt: 'form_archived_at' },
  webhook: { archivedAt: 'webhook_archived_at' },
  workflow: { archivedAt: 'workflow_archived_at' },
  workflowDeploymentVersion: { isActive: 'workflow_deployment_version_is_active' },
  workflowMcpTool: { archivedAt: 'workflow_mcp_tool_archived_at' },
  workflowSchedule: { archivedAt: 'workflow_schedule_archived_at' },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@/lib/workflows/utils', () => ({
  getWorkflowById: (...args: unknown[]) => mockGetWorkflowById(...args),
}))

vi.mock('@/lib/webhooks/provider-subscriptions', () => ({
  cleanupExternalWebhook: (...args: unknown[]) => mockCleanupExternalWebhook(...args),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    SOCKET_SERVER_URL: 'http://socket.test',
    INTERNAL_API_SECRET: 'secret',
  },
}))

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
