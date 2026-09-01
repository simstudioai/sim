/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  deleteByFilter: vi.fn(),
  markJob: vi.fn(),
  releaseJob: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  signal: vi.fn(),
  translateFilter: vi.fn(),
  updateByFilter: vi.fn(),
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

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'job-12345678'),
}))

vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: false }))
vi.mock('@/lib/core/utils/background', () => ({ runDetached: vi.fn() }))

vi.mock('@/lib/table', () => ({
  deleteRowsByFilter: mocks.deleteByFilter,
  queryRows: vi.fn(),
  rowDataNameToId: (data: Record<string, unknown>) => data,
  TABLE_LIMITS: { MAX_BULK_OPERATION_SIZE: 1000 },
  updateRowsByFilter: mocks.updateByFilter,
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveContext,
}))

vi.mock('@/lib/table/application/rows', () => ({
  tablePredicateNamesToFilter: mocks.translateFilter,
}))

vi.mock('@/lib/table/column-keys', () => ({ buildIdByName: () => new Map() }))
vi.mock('@/lib/table/delete-runner', () => ({
  markTableDeleteFailed: vi.fn(),
  runTableDelete: vi.fn(),
}))
vi.mock('@/lib/table/events', () => ({ signalTableRowsChanged: mocks.signal }))
vi.mock('@/lib/table/jobs/service', () => ({
  markTableJobRunningInWorkspace: mocks.markJob,
  releaseJobClaimInWorkspace: mocks.releaseJob,
}))
vi.mock('@/lib/table/mutation-locks', () => ({
  assertRowDelete: vi.fn(),
  assertRowUpdate: vi.fn(),
  patchColumnIds: () => [],
}))
vi.mock('@/lib/table/rows/secret-provenance', () => ({
  createExactEmptyTableRowSecretProvenance: () => ({ complete: true, columns: {} }),
}))
vi.mock('@/lib/table/update-runner', () => ({
  markTableUpdateFailed: vi.fn(),
  runTableUpdate: vi.fn(),
}))

import {
  copilotDeleteRowsByFilter,
  copilotUpdateRowsByFilter,
} from '@/lib/table/application/copilot-bulk-rows'

const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: { columns: [{ id: 'column-1', name: 'name', type: 'string' }] },
  metadata: null,
  rowCount: 2,
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

const input = {
  tableId: 'table-1',
  assertedWorkspaceId: 'workspace-1',
  filter: { all: [] as [] },
  data: { name: 'Ada' },
  limit: 1,
}

describe('Copilot bulk row application use cases', () => {
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
    mocks.translateFilter.mockReturnValue({})
    mocks.updateByFilter.mockResolvedValue({ affectedCount: 1, affectedRowIds: ['row-1'] })
    mocks.deleteByFilter.mockResolvedValue({ affectedCount: 1, affectedRowIds: ['row-1'] })
    mocks.markJob.mockResolvedValue(true)
    mocks.releaseJob.mockResolvedValue(true)
  })

  it('rejects delegated resource-scope mismatches before mutation', async () => {
    await expect(
      copilotUpdateRowsByFilter.execute({
        principal: { ...principal, resourceScope: { tableId: 'table-other' } },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.updateByFilter).not.toHaveBeenCalled()
  })

  it('rejects current permission loss before mutation', async () => {
    mocks.resolvePermission.mockResolvedValueOnce('read')

    await expect(copilotUpdateRowsByFilter.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.updateByFilter).not.toHaveBeenCalled()
  })

  it('projects audit and shared effects only from an authoritative mutation result', async () => {
    await copilotUpdateRowsByFilter.execute({ principal, input })

    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'table.updated',
        resourceId: 'table-1',
        metadata: expect.objectContaining({ operation: 'tables.rows.update_many', rowsUpdated: 1 }),
      })
    )
    expect(mocks.signal).toHaveBeenCalledWith('table-1')

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
    mocks.translateFilter.mockReturnValue({})
    mocks.updateByFilter.mockResolvedValue({ affectedCount: 0, affectedRowIds: [] })

    await copilotUpdateRowsByFilter.execute({ principal, input })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('releases inline delete claims and audits the committed count', async () => {
    await copilotDeleteRowsByFilter.execute({
      principal,
      input: {
        tableId: 'table-1',
        assertedWorkspaceId: 'workspace-1',
        filter: { all: [] },
        limit: 1,
      },
    })

    expect(mocks.deleteByFilter).toHaveBeenCalledTimes(1)
    expect(mocks.releaseJob).toHaveBeenCalledWith('table-1', 'workspace-1', 'job-12345678')
    expect(mocks.audit).toHaveBeenCalledTimes(1)
  })

  it('propagates unknown infrastructure failures without audit or effects', async () => {
    const failure = new Error('database host unavailable')
    mocks.updateByFilter.mockRejectedValueOnce(failure)

    await expect(copilotUpdateRowsByFilter.execute({ principal, input })).rejects.toBe(failure)
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })
})
