import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { tableBillingMock, tableBillingMockFns } from '@sim/testing/mocks/table-billing.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/folders/queries', () => folderQueriesMock)

vi.mock('@/lib/table/billing', () => tableBillingMock)
vi.mock('@/lib/table/service', () => tableServiceMock)

vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)

/**
 * The two projectors are deliberately distinguishable here: the strict one
 * reproduces the bare `Error` a dangling `folderId` raises in production, so a
 * listing that reaches for the wrong one fails the test the same way it 500s
 * the page.
 */
vi.mock('@/lib/table/application/folder-paths', () => ({
  resolveTableFolderPath: vi.fn(),
  tableFolderPathForId: (_index: unknown, folderId: string | null | undefined) => {
    if (folderId) throw new Error('Table references an inactive or missing folder')
    return '/'
  },
  archivableTableFolderPath: () => '/',
}))

vi.mock('@/lib/table/events', () => tableEventsMock)

import { listTablesUseCase, restoreTableUseCase } from '@/lib/table/application/tables'

const mocks = {
  loadFolderIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
  resolveFolderPathFilter: folderQueriesMockFns.mockResolveFolderPathFilter,
  getLimits: tableBillingMockFns.mockGetWorkspaceTableLimits,
  resolveActiveContext: tableApplicationContextMockFns.mockResolveActiveTableContext,
  resolveArchivedContext: tableApplicationContextMockFns.mockResolveArchivedTableContext,
  resolveWorkspaceContext: tableApplicationContextMockFns.mockResolveTableWorkspaceContext,
  audit: auditMockFns.mockRecordAudit,
  getTableById: tableServiceMockFns.mockGetTableById,
  listDefinitions: tableServiceMockFns.mockListTables,
  queryTables: tableServiceMockFns.mockQueryTables,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  restoreTable: tableServiceMockFns.mockRestoreTable,
  signal: tableEventsMockFns.mockSignalTableSchemaChanged,
}

const WORKSPACE = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const PRINCIPAL = createSessionPrincipal()

const ARCHIVED: TableDefinition = {
  id: 'table-1',
  name: 'People (restored 4f2a)',
  description: null,
  schema: { columns: [] },
  metadata: null,
  rowCount: 0,
  maxRows: 10,
  workspaceId: 'workspace-1',
  createdBy: 'owner-1',
  archivedAt: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

describe('table list scope', () => {
  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveWorkspaceContext.mockResolvedValue(WORKSPACE)
    mocks.loadFolderIndex.mockResolvedValue({ pathById: new Map() })
    mocks.resolveFolderPathFilter.mockReturnValue({ kind: 'all' })
    mocks.queryTables.mockResolvedValue({ tables: [], nextKeys: null })
  })

  /**
   * Archiving a folder cascades onto its tables but leaves each `folderId`
   * pointing at the soft-deleted row, so the archived scope is exactly the
   * population whose folder cannot resolve. Projected strictly, one such row
   * threw and 500'd the whole page — and no cursor position could step past it,
   * which made every archived table id undiscoverable and `restore` unreachable.
   */
  it('renders an archived table whose folder was archived too at the root', async () => {
    mocks.queryTables.mockResolvedValue({
      tables: [{ ...ARCHIVED, folderId: 'folder-archived' }],
      nextKeys: null,
    })

    const result = await listTablesUseCase.execute({
      principal: PRINCIPAL,
      input: {
        workspaceId: 'workspace-1',
        scope: 'archived',
        sortBy: 'createdAt',
        sortOrder: 'asc',
        limit: 10,
      },
    })

    expect(result.tables).toEqual([
      { table: { ...ARCHIVED, folderId: 'folder-archived' }, folderPath: '/' },
    ])
  })

  /**
   * The negative leg. A LIVE table pointing at a folder that does not resolve is
   * a genuine inconsistency, so the active listing must stay loud rather than
   * quietly re-rooting it.
   */
  it('still fails loudly on a dangling folder in the active listing', async () => {
    mocks.queryTables.mockResolvedValue({
      tables: [{ ...ARCHIVED, archivedAt: null, folderId: 'folder-archived' }],
      nextKeys: null,
    })

    await expect(
      listTablesUseCase.execute({
        principal: PRINCIPAL,
        input: {
          workspaceId: 'workspace-1',
          sortBy: 'createdAt',
          sortOrder: 'asc',
          limit: 10,
        },
      })
    ).rejects.toThrow('Table references an inactive or missing folder')
  })
})

/**
 * Without a restore, a headless `DELETE` was unrecoverable: the table is
 * archived, not erased, but nothing on the public surface could bring it back.
 */
describe('restoreTableUseCase', () => {
  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveArchivedContext.mockResolvedValue({
      ...WORKSPACE,
      tableId: ARCHIVED.id,
      table: ARCHIVED,
    })
    mocks.getTableById.mockResolvedValue({ ...ARCHIVED, archivedAt: null })
    mocks.loadFolderIndex.mockResolvedValue({ pathById: new Map() })
    mocks.restoreTable.mockResolvedValue(undefined)
  })

  /**
   * Restore is idempotent: a `409` for an already-active table would make a
   * retry after a dropped response look like a failure, and there is no state a
   * second restore could corrupt. Matches `restoreKnowledgeBase`.
   */
  it('returns an already-active table unchanged, with no write and no audit', async () => {
    const active = { ...ARCHIVED, archivedAt: null }
    mocks.resolveArchivedContext.mockResolvedValue({
      ...WORKSPACE,
      tableId: ARCHIVED.id,
      table: active,
    })

    const result = await restoreTableUseCase.execute({
      principal: PRINCIPAL,
      input: { tableId: ARCHIVED.id, workspaceId: 'workspace-1' },
    })

    expect(result.table.archivedAt).toBeNull()
    expect(mocks.restoreTable).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('refuses a caller without write permission before restoring', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(
      restoreTableUseCase.execute({
        principal: PRINCIPAL,
        input: { tableId: ARCHIVED.id, workspaceId: 'workspace-1' },
      })
    ).rejects.toBeDefined()

    expect(mocks.restoreTable).not.toHaveBeenCalled()
  })

  it('propagates a name-collision conflict without audit or shared effects', async () => {
    const failure = Object.assign(new Error('Table name is already taken'), { code: 'conflict' })
    mocks.restoreTable.mockRejectedValueOnce(failure)

    await expect(
      restoreTableUseCase.execute({
        principal: PRINCIPAL,
        input: { tableId: ARCHIVED.id, workspaceId: 'workspace-1' },
      })
    ).rejects.toBe(failure)

    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })
})
