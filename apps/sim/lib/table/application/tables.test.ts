/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  getTableById: vi.fn(),
  getLimits: vi.fn(),
  listDefinitions: vi.fn(),
  loadFolderIndex: vi.fn(),
  queryTables: vi.fn(),
  resolveArchivedContext: vi.fn(),
  resolveActiveContext: vi.fn(),
  resolveFolderPathFilter: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
  restoreTable: vi.fn(),
  signal: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_RESTORED: 'table.restored' },
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

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadFolderIndex,
  resolveFolderPathFilter: mocks.resolveFolderPathFilter,
}))

vi.mock('@/lib/table', () => ({
  createTable: vi.fn(),
  deleteTable: vi.fn(),
  getTableById: mocks.getTableById,
  getWorkspaceTableLimits: mocks.getLimits,
  listTables: mocks.listDefinitions,
  moveTableToFolder: vi.fn(),
  queryTables: mocks.queryTables,
  renameTable: vi.fn(),
  restoreTable: mocks.restoreTable,
  updateTableDescription: vi.fn(),
}))

vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveActiveContext,
  resolveArchivedTableContext: mocks.resolveArchivedContext,
  resolveTableWorkspaceContext: mocks.resolveWorkspaceContext,
}))

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

vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: mocks.signal }))

import {
  listTableDefinitionsUseCase,
  listTablesUseCase,
  readTableDefinitionUseCase,
  readTableDetailsUseCase,
  restoreTableUseCase,
} from '@/lib/table/application/tables'

const WORKSPACE = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const PRINCIPAL = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

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
    vi.clearAllMocks()
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

  it('lets the caller scope the listing without changing the default', async () => {
    await listTablesUseCase.execute({
      principal: PRINCIPAL,
      input: {
        workspaceId: 'workspace-1',
        sortBy: 'createdAt',
        sortOrder: 'asc',
        limit: 10,
      },
    })
    expect(mocks.queryTables).toHaveBeenLastCalledWith(
      'workspace-1',
      expect.objectContaining({ scope: undefined })
    )

    await listTablesUseCase.execute({
      principal: PRINCIPAL,
      input: {
        workspaceId: 'workspace-1',
        scope: 'archived',
        sortBy: 'createdAt',
        sortOrder: 'asc',
        limit: 10,
      },
    })
    expect(mocks.queryTables).toHaveBeenLastCalledWith(
      'workspace-1',
      expect.objectContaining({ scope: 'archived' })
    )
  })
})

describe('internal table compatibility reads', () => {
  const active = { ...ARCHIVED, archivedAt: null }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveWorkspaceContext.mockResolvedValue(WORKSPACE)
    mocks.resolveActiveContext.mockResolvedValue({
      ...WORKSPACE,
      tableId: active.id,
      table: active,
    })
    mocks.listDefinitions.mockResolvedValue([active])
    mocks.getLimits.mockResolvedValue({ maxRowsPerTable: 2500 })
  })

  it('lists definitions without materializing the workspace folder index', async () => {
    const result = await listTableDefinitionsUseCase.execute({
      principal: PRINCIPAL,
      input: { workspaceId: WORKSPACE.workspaceId, scope: 'all' },
    })

    expect(mocks.listDefinitions).toHaveBeenCalledWith(WORKSPACE.workspaceId, { scope: 'all' })
    expect(result.tables).toEqual([active])
    expect(mocks.loadFolderIndex).not.toHaveBeenCalled()
  })

  it('reads schema-only metadata without loading folders or plan limits', async () => {
    const result = await readTableDefinitionUseCase.execute({
      principal: PRINCIPAL,
      input: { tableId: active.id, workspaceId: WORKSPACE.workspaceId },
    })

    expect(result.table).toBe(active)
    expect(mocks.loadFolderIndex).not.toHaveBeenCalled()
    expect(mocks.getLimits).not.toHaveBeenCalled()
  })

  it('reads the live row limit without loading unrelated folder state', async () => {
    const result = await readTableDetailsUseCase.execute({
      principal: PRINCIPAL,
      input: { tableId: active.id, workspaceId: WORKSPACE.workspaceId },
    })

    expect(result).toEqual({ table: active, maxRows: 2500 })
    expect(mocks.loadFolderIndex).not.toHaveBeenCalled()
  })
})

/**
 * Without a restore, a headless `DELETE` was unrecoverable: the table is
 * archived, not erased, but nothing on the public surface could bring it back.
 */
describe('restoreTableUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('restores the archived table and audits the authoritative restored row', async () => {
    const result = await restoreTableUseCase.execute({
      principal: PRINCIPAL,
      input: { tableId: ARCHIVED.id, workspaceId: 'workspace-1' },
    })

    expect(mocks.restoreTable).toHaveBeenCalledWith(ARCHIVED.id, 'request-1')
    expect(result.table.archivedAt).toBeNull()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'table.restored',
        resourceId: ARCHIVED.id,
        resourceName: ARCHIVED.name,
      })
    )
    expect(mocks.signal).toHaveBeenCalledWith(ARCHIVED.id)
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
