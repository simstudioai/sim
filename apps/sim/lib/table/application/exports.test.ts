/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  create: vi.fn(),
  getTable: vi.fn(),
  require: vi.fn(),
  resolveContext: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_EXPORTED: 'table.exported' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: vi.fn(),
}))
vi.mock('@/lib/table', () => ({ getTableById: mocks.getTable }))
vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveContext,
  resolveTableWorkspaceContext: vi.fn(async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner-1',
  })),
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

import {
  cancelTableExportUseCase,
  createTableExportUseCase,
  readTableExportUseCase,
} from '@/lib/table/application/exports'

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
const principal = {
  kind: 'workspace_api_key' as const,
  workspaceId: 'workspace-1',
  keyId: 'workspace-key-1',
}

describe('table export application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  it('returns domain records for create and read operations', async () => {
    await expect(
      createTableExportUseCase.execute({
        principal,
        input: { tableId: 'table-1', workspaceId: 'workspace-1', format: 'csv' },
      })
    ).resolves.toEqual({ export: record })

    await expect(
      readTableExportUseCase.execute({
        principal,
        input: { exportId: 'export-1', workspaceId: 'workspace-1' },
      })
    ).resolves.toEqual({ export: record })

    expect(record.startedAt).toBeInstanceOf(Date)
  })

  it('returns the authoritative canceled domain record', async () => {
    await expect(
      cancelTableExportUseCase.execute({
        principal,
        input: { exportId: 'export-1', workspaceId: 'workspace-1' },
      })
    ).resolves.toMatchObject({ export: { status: 'canceled', startedAt: now } })
  })
})
