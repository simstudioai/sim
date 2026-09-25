import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
  create: vi.fn(),
  getTable: vi.fn(),
  require: vi.fn(),
  resolveContext: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_EXPORTED: 'table.exported' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: vi.fn(),
}))
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/lib/table', () => ({ getTableById: mocks.getTable }))
vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveContext,
  resolveTableWorkspaceContext: mocks.resolveWorkspaceContext,
}))
vi.mock('@/lib/table/orchestration/export-resource', () => ({
  cancelTableExportResource: mocks.cancel,
  createTableExportResource: mocks.create,
  requireTableExport: mocks.require,
  tableExportResult: vi.fn(),
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  generatePresignedDownloadUrl: vi.fn(),
}))

import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { cancelTableExportUseCase, createTableExportUseCase } from '@/lib/table/application/exports'

const now = new Date('2026-08-01T00:00:00.000Z')
const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: { columns: [] },
  metadata: null,
  rowCount: 0,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'owner-1',
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
}
const record = {
  id: 'export-1',
  tableId: 'table-1',
  workspaceId: 'workspace-1',
  type: 'export',
  status: 'running',
  payload: { format: 'csv' },
  rowsProcessed: 0,
  error: null,
  startedAt: now,
  updatedAt: now,
  completedAt: null,
}
const executor: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-01T00:00:00.000Z'),
  expiresAt: new Date('2099-08-01T00:00:00.000Z'),
  resourceScope: { tableId: 'table-1' },
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

describe('table export application use cases', () => {
  beforeEach(() => {
    mocks.resolveContext.mockResolvedValue({
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.getTable.mockResolvedValue(table)
    mocks.create.mockResolvedValue(record)
    mocks.require.mockResolvedValue(record)
    mocks.cancel.mockResolvedValue({ ...record, status: 'canceled' })
    resolveGroupConfigMock.mockResolvedValue(null)
    mocks.resolveWorkspaceContext.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    }))
  })

  it('exports through admitted Copilot scope and rejects a different table binding', async () => {
    const delegated = createCopilotChatPrincipal(
      { userId: 'actor', workspaceId: 'workspace-1', chatId: 'chat' },
      'sim:tables'
    )
    markCopilotWorkspaceInvocation(delegated)
    const input = { tableId: 'table-1', workspaceId: 'workspace-1', format: 'csv' as const }
    await expect(
      createTableExportUseCase.execute({ principal: delegated, input })
    ).resolves.toEqual({ export: record })
    expect(createTableExportUseCase.delegationAudience).toBe('sim:tables')
    const narrower = { ...delegated, resourceScope: { chatId: 'chat', tableId: 'other-table' } }
    markCopilotWorkspaceInvocation(narrower)
    mocks.create.mockClear()
    await expect(
      createTableExportUseCase.execute({ principal: narrower, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects a mismatched executor table scope before export mutation', async () => {
    await expect(
      createTableExportUseCase.execute({
        principal: { ...executor, resourceScope: { tableId: 'table-other' } },
        input: { tableId: 'table-1', workspaceId: 'workspace-1', format: 'csv' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.create).not.toHaveBeenCalled()
  })

  describe('permission-group capability', () => {
    const member = { kind: 'session' as const, userId: 'user-1' }
    const governedContext = {
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: 'org-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    }

    beforeEach(() => {
      mocks.resolveContext.mockResolvedValue(governedContext)
      mocks.resolveWorkspaceContext.mockImplementation(async (workspaceId: string) => ({
        workspaceId,
        workspaceOrganizationId: 'org-1',
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-owner-1',
      }))
      resolveGroupConfigMock.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disableTableExport: true,
      })
    })

    it('refuses to generate an export when the group withholds tables.export', async () => {
      await expect(
        createTableExportUseCase.execute({
          principal: member,
          input: { tableId: 'table-1', workspaceId: 'workspace-1', format: 'csv' },
        })
      ).rejects.toMatchObject({ capability: 'tables.export' })

      expect(mocks.create).not.toHaveBeenCalled()
    })

    it('still allows cancelling an export, which stops extraction rather than performing it', async () => {
      await expect(
        cancelTableExportUseCase.execute({
          principal: member,
          input: { exportId: 'export-1', workspaceId: 'workspace-1' },
        })
      ).resolves.toMatchObject({ export: { status: 'canceled' } })
    })
  })
})
