/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  deleteColumns: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  signal: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_UPDATED: 'table.updated' },
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
  addTableColumn: vi.fn(),
  deleteColumn: vi.fn(),
  deleteColumns: mocks.deleteColumns,
}))
vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveContext,
}))
vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: mocks.signal }))
vi.mock('@/lib/table/orchestration', () => ({ performUpdateTableColumn: vi.fn() }))

import { deleteTableColumnsUseCase } from '@/lib/table/application/columns'

const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: { columns: [{ name: 'name', type: 'string' }] },
  metadata: null,
  rowCount: 0,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'owner-1',
  archivedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}
const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-01T00:00:00.000Z'),
  expiresAt: new Date('2099-08-01T00:00:00.000Z'),
  resourceScope: { tableId: 'table-1' },
}

describe('multi-column delete application use case', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveContext.mockResolvedValue({
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.deleteColumns.mockResolvedValue(table)
  })

  it('owns canonical mutation, audit, and schema effects', async () => {
    await deleteTableColumnsUseCase.execute({
      principal,
      input: {
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        columnNames: ['first', 'last'],
      },
    })

    expect(mocks.deleteColumns).toHaveBeenCalledWith(
      { tableId: 'table-1', columnNames: ['first', 'last'] },
      'request-1',
      { expectedWorkspaceId: 'workspace-1' }
    )
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.signal).toHaveBeenCalledWith('table-1')
  })

  it('rejects admission before mutation when delegated scope is stale', async () => {
    mocks.resolvePermission.mockResolvedValueOnce('read')

    await expect(
      deleteTableColumnsUseCase.execute({
        principal,
        input: {
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          columnNames: ['first', 'last'],
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.deleteColumns).not.toHaveBeenCalled()
  })
})
