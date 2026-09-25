import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { backgroundTaskMock } from '@sim/testing/mocks/background-task.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import {
  tableApplicationRowsMock,
  tableApplicationRowsMockFns,
} from '@sim/testing/mocks/table-application-rows.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import {
  tableJobsServiceMock,
  tableJobsServiceMockFns,
} from '@sim/testing/mocks/table-jobs-service.mock'
import {
  tableRowsSecretProvenanceMock,
  tableRowsSecretProvenanceMockFns,
} from '@sim/testing/mocks/table-rows-secret-provenance.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@sim/utils/id', () => idMock)

vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)

vi.mock('@/lib/table', () => tableMock)

vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)

vi.mock('@/lib/table/application/rows', () => tableApplicationRowsMock)

vi.mock('@/lib/table/column-keys', () => ({ buildIdByName: () => new Map() }))
vi.mock('@/lib/table/delete-runner', () => ({
  markTableDeleteFailed: vi.fn(),
  runTableDelete: vi.fn(),
}))
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/jobs/service', () => tableJobsServiceMock)
vi.mock('@/lib/table/mutation-locks', () => ({
  assertRowDelete: vi.fn(),
  assertRowUpdate: vi.fn(),
  patchColumnIds: () => [],
}))
vi.mock('@/lib/table/rows/secret-provenance', () => tableRowsSecretProvenanceMock)
vi.mock('@/lib/table/update-runner', () => ({
  markTableUpdateFailed: vi.fn(),
  runTableUpdate: vi.fn(),
}))

import {
  copilotDeleteRowsByFilter,
  copilotUpdateRowsByFilter,
} from '@/lib/table/application/copilot-bulk-rows'

const mocks = {
  deleteByFilter: tableMockFns.mockDeleteRowsByFilter,
  updateByFilter: tableMockFns.mockUpdateRowsByFilter,
  markJob: tableJobsServiceMockFns.mockMarkTableJobRunningInWorkspace,
  releaseJob: tableJobsServiceMockFns.mockReleaseJobClaimInWorkspace,
  resolveContext: tableApplicationContextMockFns.mockResolveActiveTableContext,
  translateFilter: tableApplicationRowsMockFns.mockTablePredicateNamesToFilter,
  audit: auditMockFns.mockRecordAudit,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  signal: tableEventsMockFns.mockSignalTableRowsChanged,
}

idMockFns.mockGenerateId.mockReturnValue('job-12345678')
tableMockFns.mockRowDataNameToId.mockImplementation((data) => data)
tableRowsSecretProvenanceMockFns.mockCreateExactEmptyTableRowSecretProvenance.mockReturnValue({
  complete: true,
  columns: {},
})

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

const principal = createDelegatedPrincipal({
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  resourceScope: { tableId: 'table-1' },
})

const input = {
  tableId: 'table-1',
  assertedWorkspaceId: 'workspace-1',
  filter: { all: [] as [] },
  data: { name: 'Ada' },
  limit: 1,
}

describe('Copilot bulk row application use cases', () => {
  beforeEach(() => {
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
})
