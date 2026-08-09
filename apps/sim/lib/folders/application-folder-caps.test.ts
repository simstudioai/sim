/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listFolderRows: vi.fn(),
  listTables: vi.fn(),
  listWorkflows: vi.fn(),
  loadFolderIndex: vi.fn(),
  resolvePermission: vi.fn(),
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
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveWorkflowWorkspace,
}))
vi.mock('@/lib/workflows/queries', () => ({
  InvalidWorkflowListCursorError: class InvalidWorkflowListCursorError extends Error {},
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

import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { listTableFoldersUseCase } from '@/lib/table/application/folders'
import { listTablesUseCase } from '@/lib/table/application/tables'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { listWorkflowFolders } from '@/lib/workflows/application/workflow-folders'

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
