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
  markJob: vi.fn(),
  releaseJob: vi.fn(),
  resolveTableContext: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
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
vi.mock('@/lib/core/utils/background', () => ({ runDetached: vi.fn() }))
vi.mock('@/lib/table', () => ({
  batchInsertRows: mocks.batchInsert,
  buildAutoMapping: vi.fn(() => ({ name: 'name' })),
  coerceRowsForTable: (rows: unknown[]) => rows,
  CsvImportValidationError: mocks.CsvImportValidationError,
  CSV_MAX_BATCH_SIZE: 1000,
  getWorkspaceTableLimits: vi.fn(() => ({ maxRowsPerTable: 100, maxTables: 5 })),
  replaceTableRows: vi.fn(),
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

import {
  createTableFromWorkspaceFile,
  importWorkspaceFileIntoTable,
} from '@/lib/table/application/workspace-file-imports'

const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: 'Imported',
  schema: { columns: [{ name: 'name', type: 'string' }] },
  metadata: null,
  rowCount: 0,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'user-1',
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
  kind: 'inline' as const,
  workspaceId: 'workspace-1',
  sourceFile: {
    id: 'file-1',
    workspaceId: 'workspace-1',
    key: 'workspace/workspace-1/people.csv',
    name: 'people.csv',
    type: 'text/csv',
    size: 128,
  },
  name: 'People',
  description: 'Imported',
  columns: [{ name: 'name', type: 'string' as const }],
  headerToColumn: new Map([['name', 'name']]),
  rows: [{ name: 'Ada' }],
}

describe('Copilot workspace-file table creation', () => {
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
    mocks.createTable.mockResolvedValue(table)
    mocks.deleteTable.mockResolvedValue(undefined)
    mocks.batchInsert.mockResolvedValue([{ id: 'row-1' }])
    mocks.markJob.mockResolvedValue(true)
    mocks.releaseJob.mockResolvedValue(true)
    mocks.validateMapping.mockReturnValue({
      effectiveMap: new Map([['name', 'name']]),
      mappedHeaders: ['name'],
      skippedHeaders: [],
    })
  })

  it('owns table creation, row insertion, audit, and shared effects', async () => {
    await expect(createTableFromWorkspaceFile.execute({ principal, input })).resolves.toMatchObject(
      { kind: 'inline', insertedCount: 1, table }
    )

    expect(mocks.createTable).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', userId: 'user-1', maxTables: 5 }),
      'request-'
    )
    expect(mocks.batchInsert).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.signal).toHaveBeenCalledWith('table-1')
  })

  it('rejects HTTP-capable workspace keys before canonical loading or mutation', async () => {
    await expect(
      createTableFromWorkspaceFile.execute({
        principal: {
          kind: 'workspace_api_key',
          workspaceId: 'workspace-1',
          keyId: 'workspace-key-1',
        } as never,
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveWorkspaceContext).not.toHaveBeenCalled()
    expect(mocks.createTable).not.toHaveBeenCalled()
  })

  it('holds the table job claim across inline file loading and mutation', async () => {
    const events: string[] = []
    mocks.markJob.mockImplementationOnce(async () => {
      events.push('claim')
      return true
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
      principal,
      input: {
        kind: 'inline',
        tableId: 'table-1',
        assertedWorkspaceId: 'workspace-1',
        sourceFile: input.sourceFile,
        mode: 'append',
        loadRows: async () => {
          events.push('load')
          return { headers: ['name'], rows: [{ name: 'Ada' }] }
        },
      },
    })

    expect(events).toEqual(['claim', 'load', 'mutate', 'release'])
  })

  it('checks for a user stop after loading and before every inline insert batch', async () => {
    const assertNotAborted = vi.fn()

    await importWorkspaceFileIntoTable.execute({
      principal,
      input: {
        kind: 'inline',
        tableId: 'table-1',
        assertedWorkspaceId: 'workspace-1',
        sourceFile: input.sourceFile,
        mode: 'append',
        assertNotAborted,
        loadRows: async () => ({
          headers: ['name'],
          rows: Array.from({ length: 1001 }, (_, index) => ({ name: `Person ${index}` })),
        }),
      },
    })

    expect(assertNotAborted).toHaveBeenCalledTimes(3)
    expect(mocks.batchInsert).toHaveBeenCalledTimes(2)
  })

  it('classifies mapping failures before mutation so Copilot can correct them', async () => {
    mocks.validateMapping.mockImplementationOnce(() => {
      throw new mocks.CsvImportValidationError('Mapping references an unknown column')
    })

    await expect(
      importWorkspaceFileIntoTable.execute({
        principal,
        input: {
          kind: 'inline',
          tableId: 'table-1',
          assertedWorkspaceId: 'workspace-1',
          sourceFile: input.sourceFile,
          mode: 'append',
          loadRows: async () => ({ headers: ['name'], rows: [{ name: 'Ada' }] }),
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Mapping references an unknown column',
    })
    expect(mocks.batchInsert).not.toHaveBeenCalled()
  })

  it('rolls back and propagates unknown insertion failures without audit or effects', async () => {
    const failure = new Error('database unavailable')
    mocks.batchInsert.mockRejectedValueOnce(failure)

    await expect(createTableFromWorkspaceFile.execute({ principal, input })).rejects.toBe(failure)
    expect(mocks.deleteTable).toHaveBeenCalledWith('table-1', 'request-')
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })
})
