/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listFolderRows: vi.fn(),
  listTables: vi.fn(),
  listWorkflows: vi.fn(),
  loadFolderIndex: vi.fn(),
  queryWorkspaceFiles: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkspaceFileWorkspace: vi.fn(),
  resolveTableWorkspace: vi.fn(),
  resolveWorkflowWorkspace: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => actual === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/folders/queries', () => ({
  listActiveFolderRows: mocks.listFolderRows,
  loadActiveFolderPathIndex: mocks.loadFolderIndex,
  resolveFolderPathFromIndex: (index: { idByPath: Map<string, string> }, path: string) =>
    path === '/' ? null : index.idByPath.get(path),
  resolveFolderPathFilter: (index: { idByPath: Map<string, string> }, path: string | undefined) => {
    if (path === undefined) return { kind: 'unfiltered' }
    if (path === '/') return { kind: 'folder', folderId: null }
    const folderId = index.idByPath.get(path)
    return folderId === undefined ? { kind: 'noMatch' } : { kind: 'folder', folderId }
  },
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveWorkflowWorkspace,
}))
vi.mock('@/lib/workflows/queries', () => ({
  listWorkspaceWorkflows: mocks.listWorkflows,
}))
vi.mock('@/lib/table/application/context', () => ({
  resolveTableWorkspaceContext: mocks.resolveTableWorkspace,
}))
vi.mock('@/lib/table', () => ({
  createTable: vi.fn(),
  deleteTable: vi.fn(),
  getTableById: vi.fn(),
  getWorkspaceTableLimits: vi.fn(),
  moveTableToFolder: vi.fn(),
  queryTables: mocks.listTables,
  renameTable: vi.fn(),
  updateTableDescription: vi.fn(),
}))
vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: vi.fn() }))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  listWorkspaceFiles: vi.fn(),
  loadActiveWorkspaceContext: mocks.resolveWorkspaceFileWorkspace,
  queryWorkspaceFiles: mocks.queryWorkspaceFiles,
}))
vi.mock('@/lib/public-shares/share-manager', () => ({ getWorkspaceShares: vi.fn() }))

import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { listTableFoldersUseCase } from '@/lib/table/application/folders'
import { listTablesUseCase } from '@/lib/table/application/tables'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { listWorkflowFolders } from '@/lib/workflows/application/workflow-folders'
import { queryWorkspaceFilePage } from '@/lib/workspace-files/application/list-workspace-files'

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const folderIndex = {
  idByPath: new Map<string, string>(),
  pathById: new Map<string, string>(),
  rowById: new Map(),
}

describe('workflow and table application folder caps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveWorkflowWorkspace.mockResolvedValue(context)
    mocks.resolveTableWorkspace.mockResolvedValue(context)
    mocks.loadFolderIndex.mockResolvedValue(folderIndex)
    mocks.listFolderRows.mockResolvedValue([])
    mocks.listWorkflows.mockResolvedValue({ data: [], nextCursorKeys: null })
    mocks.listTables.mockResolvedValue({ tables: [], nextKeys: null })
    mocks.resolveWorkspaceFileWorkspace.mockResolvedValue(context)
    mocks.queryWorkspaceFiles.mockResolvedValue({ files: [], nextKeys: null })
  })

  it.each([
    [
      'workflow',
      () =>
        listWorkflowFolders.execute({
          principal,
          input: {
            workspaceId: context.workspaceId,
            sortBy: 'name',
            sortOrder: 'asc',
          },
        }),
    ],
    [
      'table',
      () =>
        listTableFoldersUseCase.execute({
          principal,
          input: { workspaceId: context.workspaceId },
        }),
    ],
  ] as const)('bounds the %s folder-list index and result rows', async (resourceType, execute) => {
    await execute()

    expect(mocks.loadFolderIndex).toHaveBeenCalledWith(
      context.workspaceId,
      resourceType,
      undefined,
      { maxRows: MAX_FOLDERS_PER_WORKSPACE }
    )
    expect(mocks.listFolderRows).toHaveBeenCalledWith(
      context.workspaceId,
      resourceType,
      expect.objectContaining({ maxRows: MAX_FOLDERS_PER_WORKSPACE })
    )
  })

  it.each([
    [
      'workflow',
      () =>
        listWorkflows.execute({
          principal,
          input: {
            workspaceId: context.workspaceId,
            deployedOnly: false,
            sortBy: 'name',
            sortOrder: 'asc',
            limit: 25,
          },
        }),
    ],
    [
      'table',
      () =>
        listTablesUseCase.execute({
          principal,
          input: {
            workspaceId: context.workspaceId,
            sortBy: 'name',
            sortOrder: 'asc',
            limit: 25,
          },
        }),
    ],
    [
      'file',
      () =>
        queryWorkspaceFilePage.execute({
          principal,
          input: {
            workspaceId: context.workspaceId,
            sortBy: 'name',
            sortOrder: 'asc',
            limit: 25,
            cursorSort: 'name:asc',
          },
        }),
    ],
  ] as const)('bounds the %s paged-resource folder index', async (resourceType, execute) => {
    await execute()

    expect(mocks.loadFolderIndex).toHaveBeenCalledWith(
      context.workspaceId,
      resourceType,
      undefined,
      { maxRows: MAX_FOLDERS_PER_WORKSPACE }
    )
  })
})

/**
 * A `folderPath` that names no active folder is a filter nothing satisfies, not
 * a missing collection. Answering `404 Folder not found` made the folder filter
 * the only one of each list's filters whose miss was an error rather than an
 * empty page, and turned a folder deleted mid-walk into a failed pagination
 * loop. The row query must not run at all: without a folder id there is nothing
 * to constrain it, so issuing it would return the whole unfiltered set.
 */
describe('a list folder filter that matches no folder', () => {
  const MISSING = '/does-not-exist'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.resolveWorkflowWorkspace.mockResolvedValue(context)
    mocks.resolveTableWorkspace.mockResolvedValue(context)
    mocks.resolveWorkspaceFileWorkspace.mockResolvedValue(context)
    mocks.loadFolderIndex.mockResolvedValue(folderIndex)
  })

  it('returns an empty workflow page without querying rows', async () => {
    const result = await listWorkflows.execute({
      principal,
      input: {
        workspaceId: context.workspaceId,
        folderPath: MISSING,
        deployedOnly: false,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 25,
      },
    })

    expect(result).toMatchObject({ workflows: [], nextCursorKeys: null })
    expect(mocks.listWorkflows).not.toHaveBeenCalled()
  })

  it('returns an empty table page without querying rows', async () => {
    const result = await listTablesUseCase.execute({
      principal,
      input: {
        workspaceId: context.workspaceId,
        folderPath: MISSING,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 25,
      },
    })

    expect(result).toMatchObject({ tables: [], nextKeys: null })
    expect(mocks.listTables).not.toHaveBeenCalled()
  })

  it('returns an empty file page without querying rows', async () => {
    const result = await queryWorkspaceFilePage.execute({
      principal,
      input: {
        workspaceId: context.workspaceId,
        folderPath: MISSING,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 25,
      },
    })

    expect(result).toMatchObject({ files: [], nextKeys: null })
    expect(mocks.queryWorkspaceFiles).not.toHaveBeenCalled()
  })
})
