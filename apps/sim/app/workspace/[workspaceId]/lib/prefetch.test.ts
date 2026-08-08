/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockListKnowledgeBasesForViewer,
  mockGetUserEntityPermissions,
  mockGetWorkspaceMemberProfiles,
  mockListFoldersForWorkspace,
  mockListPinnedItemsForViewer,
  mockListTablesForWorkspace,
  mockListWorkspaceFileFolders,
  mockListWorkspaceFilesWithShares,
} = vi.hoisted(() => ({
  mockListKnowledgeBasesForViewer: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceMemberProfiles: vi.fn(),
  mockListFoldersForWorkspace: vi.fn(),
  mockListPinnedItemsForViewer: vi.fn(),
  mockListTablesForWorkspace: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockListWorkspaceFilesWithShares: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
  getWorkspaceMemberProfiles: mockGetWorkspaceMemberProfiles,
}))
vi.mock('@/lib/pinned-items/queries', () => ({
  listPinnedItemsForViewer: mockListPinnedItemsForViewer,
}))
vi.mock('@/lib/folders/queries', () => ({ listFoldersForWorkspace: mockListFoldersForWorkspace }))
vi.mock('@/lib/workspace-files/queries', () => ({
  listWorkspaceFilesWithShares: mockListWorkspaceFilesWithShares,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  listWorkspaceFileFolders: mockListWorkspaceFileFolders,
}))
vi.mock('@/lib/table/queries', () => ({ listTablesForWorkspace: mockListTablesForWorkspace }))
vi.mock('@/lib/knowledge/queries', () => ({
  listKnowledgeBasesForViewer: mockListKnowledgeBasesForViewer,
}))

vi.mock('@sim/emcn', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { prefetchFilesBrowser } from '@/app/workspace/[workspaceId]/files/prefetch'
import { prefetchHomeLists } from '@/app/workspace/[workspaceId]/home/prefetch'
import { prefetchKnowledgeBases } from '@/app/workspace/[workspaceId]/knowledge/prefetch'
import { prefetchTables } from '@/app/workspace/[workspaceId]/tables/prefetch'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { pinnedItemKeys } from '@/hooks/queries/utils/pinned-item-keys'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { workspaceKeys } from '@/hooks/queries/workspace'
import { workspaceFileFolderKeys } from '@/hooks/queries/workspace-file-folders'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

const WORKSPACE_ID = 'ws-123'
const USER_ID = 'user-1'

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('workspace list prefetches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockListPinnedItemsForViewer.mockResolvedValue([])
    mockGetWorkspaceMemberProfiles.mockResolvedValue([])
    mockListFoldersForWorkspace.mockResolvedValue([])
    mockListWorkspaceFilesWithShares.mockResolvedValue([])
    mockListWorkspaceFileFolders.mockResolvedValue([])
    mockListTablesForWorkspace.mockResolvedValue([])
    mockListKnowledgeBasesForViewer.mockResolvedValue([])
  })

  describe('prefetchKnowledgeBases', () => {
    it('primes the exact key useKnowledgeBasesQuery reads, scoped to the viewer', async () => {
      const bases = [{ id: 'kb-1' }]
      mockListKnowledgeBasesForViewer.mockResolvedValue(bases)
      const client = makeClient()

      await prefetchKnowledgeBases(client, WORKSPACE_ID, USER_ID)

      expect(mockListKnowledgeBasesForViewer).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID, 'active')
      expect(client.getQueryData(knowledgeKeys.list(WORKSPACE_ID, 'active'))).toEqual(bases)
    })
  })

  describe('prefetchTables', () => {
    it('primes the exact key useTablesList reads', async () => {
      const tables = [{ id: 't-1' }]
      mockListTablesForWorkspace.mockResolvedValue(tables)
      const client = makeClient()

      await prefetchTables(client, WORKSPACE_ID, USER_ID)

      expect(mockListTablesForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, 'active')
      expect(client.getQueryData(tableKeys.list(WORKSPACE_ID, 'active'))).toEqual(tables)
    })
  })

  describe('prefetchFilesBrowser', () => {
    it('primes both file + folder keys the client hooks read', async () => {
      const files = [{ id: 'f-1' }]
      const folders = [{ id: 'folder-1' }]
      mockListWorkspaceFilesWithShares.mockResolvedValue(files)
      mockListWorkspaceFileFolders.mockResolvedValue(folders)
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID)

      expect(mockListWorkspaceFilesWithShares).toHaveBeenCalledWith(WORKSPACE_ID, 'active')
      expect(mockListWorkspaceFileFolders).toHaveBeenCalledWith(WORKSPACE_ID, { scope: 'active' })
      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toEqual(files)
      expect(client.getQueryData(workspaceFileFolderKeys.list(WORKSPACE_ID, 'active'))).toEqual(
        folders
      )
    })

    /**
     * `prefetchQuery` swallows a rejection and `shouldDehydrateQuery` drops the errored
     * entry, so one failing read can silently ship a page with that list missing.
     */
    it('still primes folders when the files read throws', async () => {
      const folders = [{ id: 'folder-1' }]
      mockListWorkspaceFilesWithShares.mockRejectedValue(new Error('files read failed'))
      mockListWorkspaceFileFolders.mockResolvedValue(folders)
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID)

      expect(client.getQueryData(workspaceFileFolderKeys.list(WORKSPACE_ID, 'active'))).toEqual(
        folders
      )
      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toBeUndefined()
    })
  })

  describe('prefetchHomeLists', () => {
    it('primes the workflow folder tree and the file list', async () => {
      const files = [{ id: 'f-1' }]
      mockListWorkspaceFilesWithShares.mockResolvedValue(files)
      const client = makeClient()

      await prefetchHomeLists(client, WORKSPACE_ID, USER_ID)

      expect(mockListFoldersForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, 'active', 'workflow')
      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toEqual(files)
    })
  })

  describe('authorization', () => {
    /**
     * The prefetches call the data layer directly, bypassing the routes that used to
     * authorize each read. A viewer without workspace access must therefore prime nothing —
     * the client fetch then reaches the route and gets the real 403.
     */
    const allPrefetches = [
      { name: 'files', run: prefetchFilesBrowser },
      { name: 'tables', run: prefetchTables },
      { name: 'knowledge', run: prefetchKnowledgeBases },
      { name: 'home', run: prefetchHomeLists },
    ]

    for (const { name, run } of allPrefetches) {
      it(`caches nothing for ${name} when the viewer has no workspace access`, async () => {
        mockGetUserEntityPermissions.mockResolvedValue(null)
        const client = makeClient()

        await run(client, WORKSPACE_ID, USER_ID)

        expect(client.getQueryCache().getAll()).toHaveLength(0)
        expect(mockListWorkspaceFilesWithShares).not.toHaveBeenCalled()
        expect(mockListTablesForWorkspace).not.toHaveBeenCalled()
        expect(mockListKnowledgeBasesForViewer).not.toHaveBeenCalled()
        expect(mockListPinnedItemsForViewer).not.toHaveBeenCalled()
      })
    }
  })

  describe('resource-list chrome', () => {
    /**
     * Pinned ids are the list's primary sort key, so a page that paints without them renders
     * the whole list in the wrong order and then visibly re-sorts. Members back the Owner
     * column. Both must be primed on every foldered page, under the exact client keys.
     */
    const chromeCases = [
      { name: 'files', run: prefetchFilesBrowser, resourceType: 'file' as const },
      { name: 'tables', run: prefetchTables, resourceType: 'table' as const },
      { name: 'knowledge', run: prefetchKnowledgeBases, resourceType: 'knowledge_base' as const },
    ]

    for (const { name, run, resourceType } of chromeCases) {
      it(`primes pinned ids (${resourceType} + folder) and members for ${name}`, async () => {
        const pinnedItems = [{ id: 'p-1', resourceId: 'r-1' }]
        const members = [{ userId: 'u-1', name: 'Ada' }]
        mockListPinnedItemsForViewer.mockResolvedValue(pinnedItems)
        mockGetWorkspaceMemberProfiles.mockResolvedValue(members)
        const client = makeClient()

        await run(client, WORKSPACE_ID, USER_ID)

        expect(mockListPinnedItemsForViewer).toHaveBeenCalledWith(
          USER_ID,
          WORKSPACE_ID,
          resourceType
        )
        expect(mockListPinnedItemsForViewer).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID, 'folder')
        expect(mockGetWorkspaceMemberProfiles).toHaveBeenCalledWith(WORKSPACE_ID)
        expect(client.getQueryData(pinnedItemKeys.list(WORKSPACE_ID, resourceType))).toEqual(
          pinnedItems
        )
        expect(client.getQueryData(pinnedItemKeys.list(WORKSPACE_ID, 'folder'))).toEqual(
          pinnedItems
        )
        expect(client.getQueryData(workspaceKeys.members(WORKSPACE_ID))).toEqual(members)
      })
    }
  })

  describe('folder trees', () => {
    const folderCases = [
      { name: 'tables', run: prefetchTables, resourceType: 'table' as const },
      { name: 'knowledge', run: prefetchKnowledgeBases, resourceType: 'knowledge_base' as const },
    ]

    for (const { name, run, resourceType } of folderCases) {
      it(`primes the ${name} folder tree under its own resourceType key`, async () => {
        mockListFoldersForWorkspace.mockResolvedValue([])
        const client = makeClient()

        await run(client, WORKSPACE_ID, USER_ID)

        expect(mockListFoldersForWorkspace).toHaveBeenCalledWith(
          WORKSPACE_ID,
          'active',
          resourceType
        )
        expect(client.getQueryData(folderKeys.list(WORKSPACE_ID, 'active', resourceType))).toEqual(
          []
        )
      })
    }
  })
})
