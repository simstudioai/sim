import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import { createExecutorPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { storageServiceMock } from '@sim/testing/mocks/storage-service.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const hoisted = vi.hoisted(() => ({
  cancel: vi.fn(),
  create: vi.fn(),
  require: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/lib/table', () => tableMock)
vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)
vi.mock('@/lib/table/orchestration/export-resource', () => ({
  cancelTableExportResource: hoisted.cancel,
  createTableExportResource: hoisted.create,
  requireTableExport: hoisted.require,
  tableExportResult: vi.fn(),
}))
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { cancelTableExportUseCase, createTableExportUseCase } from '@/lib/table/application/exports'

const mocks = {
  ...hoisted,
  getTable: tableMockFns.mockGetTableById,
  resolveContext: tableApplicationContextMockFns.mockResolveActiveTableContext,
  resolveWorkspaceContext: tableApplicationContextMockFns.mockResolveTableWorkspaceContext,
}

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
const executor = createExecutorPrincipal({
  audience: 'sim:tables',
  resourceScope: { tableId: 'table-1' },
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
})

workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')

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
