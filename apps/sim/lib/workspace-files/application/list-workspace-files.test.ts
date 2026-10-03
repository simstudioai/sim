import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { publicSharesMock } from '@sim/testing/mocks/public-shares.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  resolveFolderScope: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)

vi.mock('@/lib/public-shares/share-manager', () => publicSharesMock)

vi.mock('@/lib/workspace-files/resolve-folder-scope', () => ({
  resolveWorkspaceFolderScope: hoisted.resolveFolderScope,
}))

vi.mock('@/lib/folders/queries', () => folderQueriesMock)

import {
  listWorkspaceFilesInFolderScope,
  queryWorkspaceFilePage,
} from '@/lib/workspace-files/application/list-workspace-files'

const mocks = {
  loadWorkspace: workspaceUploadsMockFns.mockLoadActiveWorkspaceContext,
  queryFiles: workspaceUploadsMockFns.mockQueryWorkspaceFiles,
  recordAudit: auditMockFns.mockRecordAudit,
  ...hoisted,
  loadFolderIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

/**
 * Projects / (a)
 *   └── Q3 (b)
 *         └── Drafts (c)
 * Archive (d)
 */
const ROWS = [
  { id: 'a', name: 'Projects', parentId: null },
  { id: 'b', name: 'Q3', parentId: 'a' },
  { id: 'c', name: 'Drafts', parentId: 'b' },
  { id: 'd', name: 'Archive', parentId: null },
]

/** `files.list` accepts a session principal — see `ALL_COPILOT_PRINCIPAL_POLICY`. */
const principal = {
  kind: 'session' as const,
  userId: 'user-1',
  workspaceId: 'workspace-1',
}

function buildIndex() {
  const rowById = new Map(ROWS.map((row) => [row.id, row]))
  const pathById = new Map([
    ['a', '/Projects'],
    ['b', '/Projects/Q3'],
    ['c', '/Projects/Q3/Drafts'],
    ['d', '/Archive'],
  ])
  const idByPath = new Map([...pathById].map(([id, path]) => [path, id]))
  return { rowById, pathById, idByPath }
}

const baseInput = {
  workspaceId: 'workspace-1',
  sortBy: 'uploadedAt' as const,
  sortOrder: 'asc' as const,
  limit: 100,
}

type PageInput = Parameters<typeof queryWorkspaceFilePage.execute>[0]['input']

async function execute(input: Partial<PageInput> = {}) {
  return queryWorkspaceFilePage.execute({
    input: { ...baseInput, ...input } as PageInput,
    principal,
  })
}

/** The folder scoping the use case handed to the query layer. */
async function run(input: Partial<PageInput> = {}) {
  await execute(input)
  return mocks.queryFiles.mock.calls.at(-1)?.[1]
}

describe('queryWorkspaceFilePage folder scoping', () => {
  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mocks.loadFolderIndex.mockResolvedValue(buildIndex())
    mocks.resolveFolderScope.mockResolvedValue({
      folderIds: new Set(['a', 'b', 'c']),
      includeRootItems: false,
    })
    mocks.queryFiles.mockResolvedValue({ files: [], nextKeys: null })
  })

  it('pushes a multi-path scope into the bounded query', async () => {
    await listWorkspaceFilesInFolderScope.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        folderPaths: ['/Projects', '/Archive'],
        includeSubfolders: false,
        limit: 5000,
      },
    })

    expect(mocks.resolveFolderScope).toHaveBeenCalledWith({
      principal,
      workspaceId: 'workspace-1',
      folderPaths: ['/Projects', '/Archive'],
      includeSubfolders: false,
    })
    expect(mocks.queryFiles).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        folderScope: { folderIds: new Set(['a', 'b', 'c']), includeRootItems: false },
        limit: 5000,
      })
    )
  })

  it('stops at the subtree it was asked for', async () => {
    const options = await run({ folderPath: '/Projects/Q3', recursive: true })
    expect(options.folderId).toEqual(['b', 'c'])
  })

  it('treats a recursive root filter as the whole workspace, not root-level files', async () => {
    const options = await run({ folderPath: '/', recursive: true })
    expect(options.folderId).toBeUndefined()
  })

  it('still means root-level files only when the root filter is not recursive', async () => {
    const options = await run({ folderPath: '/' })
    expect(options.folderId).toBeNull()
  })
})
