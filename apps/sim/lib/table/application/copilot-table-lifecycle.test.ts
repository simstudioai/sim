/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  deleteTable: vi.fn(),
  resolveActiveTableContext: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_DELETED: 'table.deleted' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: mocks.audit,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'request-1' }))
vi.mock('@/lib/table', () => ({
  deleteTable: mocks.deleteTable,
  TABLE_LIMITS: { MAX_TABLES_PER_WORKSPACE: 100 },
}))
vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveActiveTableContext,
  resolveTableWorkspaceContext: mocks.resolveWorkspaceContext,
}))

import { deleteCopilotTables } from '@/lib/table/application/copilot-table-lifecycle'

const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-01T00:00:00.000Z'),
  expiresAt: new Date('2099-08-01T00:00:00.000Z'),
  resourceScope: { chatId: 'chat-1' },
}

describe('deleteCopilotTables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.resolveActiveTableContext.mockImplementation(
      async ({ tableId }: { tableId: string }) => ({
        tableId,
        workspaceId: 'workspace-1',
      })
    )
    mocks.deleteTable.mockImplementation(async (tableId: string) => ({
      archived: { name: `Table ${tableId}`, workspaceId: 'workspace-1' },
    }))
  })

  it('canonically resolves each table and audits each authoritative archive', async () => {
    const result = await deleteCopilotTables.execute({
      principal,
      input: { workspaceId: 'workspace-1', tableIds: ['table-1', 'table-2'] },
    })

    expect(result).toEqual({ deleted: ['table-1', 'table-2'], failed: [] })
    expect(mocks.resolveActiveTableContext).toHaveBeenNthCalledWith(1, {
      tableId: 'table-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.resolveActiveTableContext).toHaveBeenNthCalledWith(2, {
      tableId: 'table-2',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.audit).toHaveBeenCalledTimes(2)
  })

  it('conceals a cross-workspace table as a best-effort miss', async () => {
    mocks.resolveActiveTableContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Table not found')
    )

    await expect(
      deleteCopilotTables.execute({
        principal,
        input: { workspaceId: 'workspace-1', tableIds: ['table-other'] },
      })
    ).resolves.toEqual({ deleted: [], failed: ['table-other'] })

    expect(mocks.deleteTable).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects admission before canonical loads or mutation', async () => {
    mocks.resolvePermission.mockResolvedValueOnce(null)

    await expect(
      deleteCopilotTables.execute({
        principal,
        input: { workspaceId: 'workspace-1', tableIds: ['table-1'] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveActiveTableContext).not.toHaveBeenCalled()
    expect(mocks.deleteTable).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('preserves audit for completed items before a later mutation fails', async () => {
    const failure = new Error('delete storage unavailable')
    mocks.deleteTable
      .mockResolvedValueOnce({
        archived: { name: 'Table table-1', workspaceId: 'workspace-1' },
      })
      .mockRejectedValueOnce(failure)

    await expect(
      deleteCopilotTables.execute({
        principal,
        input: { workspaceId: 'workspace-1', tableIds: ['table-1', 'table-2'] },
      })
    ).rejects.toBe(failure)

    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'table-1', action: 'table.deleted' })
    )
  })
})
