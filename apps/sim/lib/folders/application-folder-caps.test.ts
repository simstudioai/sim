import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { publicSharesMock } from '@sim/testing/mocks/public-shares.mock'
import { tableMock, tableMockFns } from '@sim/testing/mocks/table.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import {
  workflowsQueriesMock,
  workflowsQueriesMockFns,
} from '@sim/testing/mocks/workflows-queries.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/folders/queries', () => folderQueriesMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/workflows/queries', () => workflowsQueriesMock)
vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)
vi.mock('@/lib/table', () => tableMock)
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/public-shares/share-manager', () => publicSharesMock)

import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { listTableFoldersUseCase } from '@/lib/table/application/folders'
import { listTablesUseCase } from '@/lib/table/application/tables'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { listWorkflowFolders } from '@/lib/workflows/application/workflow-folders'
import { queryWorkspaceFilePage } from '@/lib/workspace-files/application/list-workspace-files'

const mocks = {
  listTables: tableMockFns.mockQueryTables,
  listWorkflows: workflowsQueriesMockFns.mockListWorkspaceWorkflows,
  resolveTableWorkspace: tableApplicationContextMockFns.mockResolveTableWorkspaceContext,
  listFolderRows: folderQueriesMockFns.mockListActiveFolderRows,
  loadFolderIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
  queryWorkspaceFiles: workspaceUploadsMockFns.mockQueryWorkspaceFiles,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  resolveWorkspaceFileWorkspace: workspaceUploadsMockFns.mockLoadActiveWorkspaceContext,
  resolveWorkflowWorkspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
}

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const principal = createSessionPrincipal()
const folderIndex = {
  idByPath: new Map<string, string>(),
  pathById: new Map<string, string>(),
  rowById: new Map(),
}

describe('workflow and table application folder caps', () => {
  beforeEach(() => {
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
            folderPath: '/Folder',
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
})
