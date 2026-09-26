import {
  createDelegatedPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { backgroundTaskMock, backgroundTaskMockFns } from '@sim/testing/mocks/background-task.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import {
  tableJobsServiceMock,
  tableJobsServiceMockFns,
} from '@sim/testing/mocks/table-jobs-service.mock'
import {
  tableRowsSecretProvenanceMock,
  tableRowsSecretProvenanceMockFns,
} from '@sim/testing/mocks/table-rows-secret-provenance.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@sim/utils/id', () => idMock)
vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)
vi.mock('@/lib/table', () => ({ ...tableMock, CSV_MAX_BATCH_SIZE: 1000 }))
vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/import-runner', () => ({ runTableImport: vi.fn() }))
vi.mock('@/lib/table/jobs/service', () => tableJobsServiceMock)
vi.mock('@/lib/table/rows/secret-provenance', () => tableRowsSecretProvenanceMock)
vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

import {
  createTableFromWorkspaceFile,
  importWorkspaceFileIntoTable,
} from '@/lib/table/application/workspace-file-imports'

const mocks = {
  batchInsert: tableMockFns.mockBatchInsertRows,
  inferSchema: tableMockFns.mockInferSchemaFromCsv,
  markJob: tableJobsServiceMockFns.mockMarkTableJobRunningInWorkspace,
  parseRows: tableMockFns.mockParseFileRows,
  releaseJob: tableJobsServiceMockFns.mockReleaseJobClaimInWorkspace,
  replaceRows: tableMockFns.mockReplaceTableRows,
  resolveTableContext: tableApplicationContextMockFns.mockResolveActiveTableContext,
  resolveWorkspaceContext: tableApplicationContextMockFns.mockResolveTableWorkspaceContext,
  runDetached: backgroundTaskMockFns.mockRunDetached,
  validateMapping: tableMockFns.mockValidateMapping,
  coerceRows: tableMockFns.mockCoerceRowsForTable,
  audit: auditMockFns.mockRecordAudit,
  createTable: tableServiceMockFns.mockCreateTable,
  deleteTable: tableServiceMockFns.mockDeleteTable,
  fetchFile: workspaceFileManagerMockFns.mockFetchWorkspaceFileBuffer,
  loadFileContext: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  provenance: workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance,
  resolveFile: workspaceFileManagerMockFns.mockResolveWorkspaceFileReference,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  signal: tableEventsMockFns.mockSignalTableRowsChanged,
}

tableMockFns.mockBuildAutoMapping.mockReturnValue({ name: 'name' })
tableMockFns.mockGetWorkspaceTableLimits.mockReturnValue({ maxRowsPerTable: 100, maxTables: 5 })
tableMockFns.mockSanitizeName.mockImplementation((value: string) => value)
tableRowsSecretProvenanceMockFns.mockCreateExactEmptyTableRowSecretProvenance.mockReturnValue({
  complete: true,
  columns: {},
})

idMockFns.mockGenerateId.mockReturnValue('request-id-1234')

const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: 'Imported',
  schema: { columns: [{ id: 'column-name', name: 'name', type: 'string' }] },
  metadata: null,
  rowCount: 0,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'user-1',
  archivedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}
const rejectedSample = { code: 'CSV_QUOTE_NOT_CLOSED', line: 3, message: 'Quote Not Closed' }

const sourceFile = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  key: 'workspace/workspace-1/people.csv',
  name: 'people.csv',
  type: 'text/csv',
  size: 128,
}
const principal = createDelegatedPrincipal({
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
})
const tablePrincipal = { ...principal, resourceScope: { tableId: 'table-1' } }

describe('workspace-file Table application commands', () => {
  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.resolveTableContext.mockResolvedValue({
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.resolveFile.mockResolvedValue(sourceFile)
    mocks.loadFileContext.mockResolvedValue(sourceFile)
    mocks.provenance.mockResolvedValue({ status: 'exact', entries: [] })
    mocks.fetchFile.mockResolvedValue(Buffer.from('name\nAda'))
    mocks.parseRows.mockResolvedValue({
      headers: ['name'],
      rows: [{ name: 'Ada' }],
      rejections: { rowsRejected: 0, rejectedSamples: [] },
    })
    mocks.inferSchema.mockReturnValue({
      columns: [{ name: 'name', type: 'string' }],
      headerToColumn: new Map([['name', 'name']]),
    })
    mocks.createTable.mockResolvedValue(table)
    mocks.deleteTable.mockResolvedValue(undefined)
    mocks.batchInsert.mockImplementation(async ({ rows }: { rows: unknown[] }) =>
      rows.map((_, index) => ({ id: `row-${index}` }))
    )
    mocks.replaceRows.mockResolvedValue({ insertedCount: 1, deletedCount: 2 })
    mocks.markJob.mockResolvedValue(true)
    mocks.releaseJob.mockResolvedValue(true)
    mocks.coerceRows.mockImplementation((rows: unknown[]) => rows)
    mocks.validateMapping.mockReturnValue({
      effectiveMap: new Map([['name', 'name']]),
      mappedHeaders: ['name'],
      skippedHeaders: [],
    })
  })

  /**
   * The parse dropped these records silently, so an inline import used to finish
   * with a smaller table and nothing distinguishing it from a clean one.
   */
  it('surfaces the records the parse dropped', async () => {
    mocks.parseRows.mockResolvedValueOnce({
      headers: ['name'],
      rows: [{ name: 'Ada' }],
      rejections: { rowsRejected: 2, rejectedSamples: [rejectedSample] },
    })

    const result = await createTableFromWorkspaceFile.execute({
      principal,
      input: { workspaceId: 'workspace-1', fileReference: 'files/people.csv' },
    })

    expect(result).toMatchObject({
      kind: 'inline',
      rejections: { rowsRejected: 2, cellsRejected: 0, rejectedSamples: [rejectedSample] },
    })
  })

  it('conceals cross-workspace files before parsing or table mutation', async () => {
    mocks.resolveFile.mockResolvedValueOnce({ ...sourceFile, workspaceId: 'workspace-other' })

    await expect(
      createTableFromWorkspaceFile.execute({
        principal,
        input: { workspaceId: 'workspace-1', fileReference: 'files/people.csv' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.fetchFile).not.toHaveBeenCalled()
    expect(mocks.createTable).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects non-delegated upload identities before canonical workspace or file loading', async () => {
    await expect(
      createTableFromWorkspaceFile.execute({
        principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key-1' }) as never,
        input: { workspaceId: 'workspace-1', fileReference: 'files/people.csv' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveWorkspaceContext).not.toHaveBeenCalled()
    expect(mocks.resolveFile).not.toHaveBeenCalled()
  })

  it('rolls back a partially-created table and emits no audit or effect on insertion failure', async () => {
    const failure = new Error('database unavailable')
    mocks.batchInsert.mockRejectedValueOnce(failure)

    await expect(
      createTableFromWorkspaceFile.execute({
        principal,
        input: { workspaceId: 'workspace-1', fileReference: 'files/people.csv' },
      })
    ).rejects.toBe(failure)

    expect(mocks.deleteTable).toHaveBeenCalledWith(table.id, 'request-')
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('holds the concurrency claim across file loading and inline mutation', async () => {
    const events: string[] = []
    mocks.markJob.mockImplementationOnce(async () => {
      events.push('claim')
      return true
    })
    mocks.fetchFile.mockImplementationOnce(async () => {
      events.push('load')
      return Buffer.from('name\nAda')
    })
    mocks.batchInsert.mockImplementationOnce(async () => {
      events.push('mutate')
      return [{ id: 'row-1' }]
    })
    mocks.releaseJob.mockImplementationOnce(async () => {
      events.push('release')
      return true
    })

    await importWorkspaceFileIntoTable.execute({
      principal: tablePrincipal,
      input: {
        tableId: table.id,
        assertedWorkspaceId: table.workspaceId,
        fileReference: 'files/people.csv',
        mode: 'append',
      },
    })

    expect(events).toEqual(['claim', 'load', 'mutate', 'release'])
  })

  it('surfaces dropped records and uncoercible cells on an inline append', async () => {
    mocks.parseRows.mockResolvedValueOnce({
      headers: ['name'],
      rows: [{ name: 'Ada' }],
      rejections: { rowsRejected: 1, rejectedSamples: [rejectedSample] },
    })
    mocks.coerceRows.mockImplementationOnce(
      (
        rows: unknown[],
        _schema: unknown,
        _map: unknown,
        _options: unknown,
        onValueRejected?: (columnName: string) => void
      ) => {
        onValueRejected?.('name')
        return rows
      }
    )

    const result = await importWorkspaceFileIntoTable.execute({
      principal: tablePrincipal,
      input: {
        tableId: table.id,
        assertedWorkspaceId: table.workspaceId,
        fileReference: 'files/people.csv',
        mode: 'append',
      },
    })

    expect(result).toMatchObject({
      kind: 'inline',
      rejections: { rowsRejected: 1, cellsRejected: 1, rejectedSamples: [rejectedSample] },
    })
  })

  it('rejects a concurrent import claim before buffering or mutating rows', async () => {
    mocks.markJob.mockResolvedValueOnce(false)

    await expect(
      importWorkspaceFileIntoTable.execute({
        principal: tablePrincipal,
        input: {
          tableId: table.id,
          assertedWorkspaceId: table.workspaceId,
          fileReference: 'files/people.csv',
          mode: 'append',
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(mocks.fetchFile).not.toHaveBeenCalled()
    expect(mocks.batchInsert).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('preserves append partial-failure semantics and releases the claim on abort', async () => {
    mocks.parseRows.mockResolvedValueOnce({
      headers: ['name'],
      rows: Array.from({ length: 1001 }, (_, index) => ({ name: `Person ${index}` })),
      rejections: { rowsRejected: 0, rejectedSamples: [] },
    })
    const stopped = new Error('stopped')
    let checks = 0
    const assertNotAborted = vi.fn(() => {
      checks += 1
      if (checks === 3) throw stopped
    })

    await expect(
      importWorkspaceFileIntoTable.execute({
        principal: tablePrincipal,
        input: {
          tableId: table.id,
          assertedWorkspaceId: table.workspaceId,
          fileReference: 'files/people.csv',
          mode: 'append',
          assertNotAborted,
        },
      })
    ).rejects.toBe(stopped)

    expect(mocks.batchInsert).toHaveBeenCalledTimes(1)
    expect(mocks.releaseJob).toHaveBeenCalledWith(table.id, table.workspaceId, 'request-id-1234')
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('rejects non-empty secret provenance before parsing or mutation', async () => {
    mocks.provenance.mockResolvedValueOnce({ status: 'exact', entries: [{ name: 'SECRET' }] })

    await expect(
      importWorkspaceFileIntoTable.execute({
        principal: tablePrincipal,
        input: {
          tableId: table.id,
          assertedWorkspaceId: table.workspaceId,
          fileReference: 'files/people.csv',
          mode: 'append',
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.fetchFile).not.toHaveBeenCalled()
    expect(mocks.markJob).not.toHaveBeenCalled()
    expect(mocks.batchInsert).not.toHaveBeenCalled()
  })
})
