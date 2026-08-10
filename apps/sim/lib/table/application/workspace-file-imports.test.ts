/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  batchInsert: vi.fn(),
  createTable: vi.fn(),
  deleteTable: vi.fn(),
  fetchFile: vi.fn(),
  inferSchema: vi.fn(),
  loadFileContext: vi.fn(),
  markJob: vi.fn(),
  parseRows: vi.fn(),
  provenance: vi.fn(),
  releaseJob: vi.fn(),
  replaceRows: vi.fn(),
  resolveFile: vi.fn(),
  resolvePermission: vi.fn(),
  resolveTableContext: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
  runDetached: vi.fn(),
  signal: vi.fn(),
  validateMapping: vi.fn(),
  CsvImportValidationError: class extends Error {},
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_CREATED: 'table.created', TABLE_UPDATED: 'table.updated' },
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
vi.mock('@sim/utils/id', () => ({ generateId: () => 'request-id-1234' }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: false }))
vi.mock('@/lib/core/utils/background', () => ({ runDetached: mocks.runDetached }))
vi.mock('@/lib/table', () => ({
  batchInsertRows: mocks.batchInsert,
  buildAutoMapping: vi.fn(() => ({ name: 'name' })),
  coerceRowsForTable: (rows: unknown[]) => rows,
  CsvImportValidationError: mocks.CsvImportValidationError,
  CSV_ASYNC_IMPORT_THRESHOLD_BYTES: 8 * 1024 * 1024,
  CSV_MAX_BATCH_SIZE: 1000,
  getWorkspaceTableLimits: vi.fn(() => ({ maxRowsPerTable: 100, maxTables: 5 })),
  inferSchemaFromCsv: mocks.inferSchema,
  parseFileRows: mocks.parseRows,
  replaceTableRows: mocks.replaceRows,
  sanitizeName: (value: string) => value,
  TABLE_LIMITS: { MAX_TABLE_NAME_LENGTH: 128 },
  validateMapping: mocks.validateMapping,
}))
vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveTableContext,
  resolveTableWorkspaceContext: mocks.resolveWorkspaceContext,
}))
vi.mock('@/lib/table/events', () => ({ signalTableRowsChanged: mocks.signal }))
vi.mock('@/lib/table/import-runner', () => ({ runTableImport: vi.fn() }))
vi.mock('@/lib/table/jobs/service', () => ({
  markTableJobRunningInWorkspace: mocks.markJob,
  releaseJobClaimInWorkspace: mocks.releaseJob,
}))
vi.mock('@/lib/table/rows/secret-provenance', () => ({
  createExactEmptyTableRowSecretProvenance: () => ({ complete: true, columns: {} }),
}))
vi.mock('@/lib/table/service', () => ({
  createTable: mocks.createTable,
  deleteTable: mocks.deleteTable,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mocks.fetchFile,
  loadActiveWorkspaceFileContext: mocks.loadFileContext,
  resolveWorkspaceFileReference: mocks.resolveFile,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mocks.provenance,
}))

import {
  createTableFromWorkspaceFile,
  importWorkspaceFileIntoTable,
} from '@/lib/table/application/workspace-file-imports'

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
const sourceFile = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  key: 'workspace/workspace-1/people.csv',
  name: 'people.csv',
  type: 'text/csv',
  size: 128,
}
const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-01T00:00:00.000Z'),
  expiresAt: new Date('2099-08-01T00:00:00.000Z'),
}
const tablePrincipal = { ...principal, resourceScope: { tableId: 'table-1' } }

describe('workspace-file Table application commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mocks.parseRows.mockResolvedValue({ headers: ['name'], rows: [{ name: 'Ada' }] })
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
    mocks.validateMapping.mockReturnValue({
      effectiveMap: new Map([['name', 'name']]),
      mappedHeaders: ['name'],
      skippedHeaders: [],
    })
  })

  it('owns canonical file resolution, bounded parsing, table creation, audit, and effects', async () => {
    const result = await createTableFromWorkspaceFile.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        fileReference: 'files/people.csv',
        name: 'People',
      },
    })

    expect(result).toMatchObject({ kind: 'inline', insertedCount: 1, table })
    expect(mocks.resolveFile).toHaveBeenCalledWith('workspace-1', 'files/people.csv')
    expect(mocks.fetchFile).toHaveBeenCalledWith(sourceFile, { maxBytes: 50 * 1024 * 1024 })
    expect(mocks.createTable).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', userId: 'user-1', maxTables: 5 }),
      'request-'
    )
    expect(mocks.batchInsert).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.signal).toHaveBeenCalledWith(table.id)
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
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'workspace-key-1',
        } as never,
        input: { workspaceId: 'workspace-1', fileReference: 'files/people.csv' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveWorkspaceContext).not.toHaveBeenCalled()
    expect(mocks.resolveFile).not.toHaveBeenCalled()
  })

  it('preserves large-file background admission without buffering inline', async () => {
    mocks.resolveFile.mockResolvedValueOnce({ ...sourceFile, size: 8 * 1024 * 1024 })

    const result = await createTableFromWorkspaceFile.execute({
      principal,
      input: { workspaceId: 'workspace-1', fileReference: 'files/people.csv' },
    })

    expect(result).toMatchObject({ kind: 'background', table, jobId: 'request-id-1234' })
    expect(mocks.fetchFile).not.toHaveBeenCalled()
    expect(mocks.runDetached).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledTimes(1)
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
