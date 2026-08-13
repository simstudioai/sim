/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetWorkspaceHostContextForViewer,
  mockListFoldersForWorkspace,
  mockListWorkspaceFileFolders,
  mockListWorkspaceFilesWithShares,
  mockPrefetchInternalJson,
} = vi.hoisted(() => ({
  mockGetWorkspaceHostContextForViewer: vi.fn(),
  mockListFoldersForWorkspace: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockListWorkspaceFilesWithShares: vi.fn(),
  mockPrefetchInternalJson: vi.fn(),
}))

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetWorkspaceHostContextForViewer,
}))
vi.mock('@/lib/folders/queries', () => ({
  listFoldersForWorkspace: mockListFoldersForWorkspace,
}))
vi.mock('@/lib/workspace-files/queries', () => ({
  listWorkspaceFilesWithShares: mockListWorkspaceFilesWithShares,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  listWorkspaceFileFolders: mockListWorkspaceFileFolders,
}))

vi.mock('@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch', () => ({
  prefetchInternalJson: mockPrefetchInternalJson,
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
    mockGetWorkspaceHostContextForViewer.mockResolvedValue({ viewer: { permission: 'admin' } })
    mockListFoldersForWorkspace.mockResolvedValue([])
    mockListWorkspaceFilesWithShares.mockResolvedValue([])
    mockListWorkspaceFileFolders.mockResolvedValue([])
  })

  describe.each([
    {
      name: 'prefetchKnowledgeBases',
      run: (client: QueryClient) => prefetchKnowledgeBases(client, WORKSPACE_ID, USER_ID),
      resourceType: 'knowledge_base' as const,
    },
    {
      name: 'prefetchTables',
      run: (client: QueryClient) => prefetchTables(client, WORKSPACE_ID, USER_ID),
      resourceType: 'table' as const,
    },
  ])('$name folder reads', ({ run, resourceType }) => {
    it('reads folders from the data layer rather than over the wire', async () => {
      const folderRow = {
        id: 'fld-1',
        name: 'Folder',
        userId: 'u-1',
        workspaceId: WORKSPACE_ID,
        parentId: null,
        resourceType,
        locked: false,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      }
      mockPrefetchInternalJson.mockResolvedValue({ data: { tables: [] } })
      mockListFoldersForWorkspace.mockResolvedValue([folderRow])
      const client = makeClient()

      await run(client)

      expect(mockListFoldersForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, 'active', resourceType)
      expect(mockPrefetchInternalJson).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/folders')
      )
      const cached = client.getQueryData(
        folderKeys.list(WORKSPACE_ID, 'active', resourceType)
      ) as Array<{
        resourceType: string
        createdAt: Date
      }>
      expect(cached).toHaveLength(1)
      expect(cached[0].resourceType).toBe(resourceType)
      expect(cached[0].createdAt).toBeInstanceOf(Date)
    })

    it('skips the folder read when the viewer cannot be proved', async () => {
      mockPrefetchInternalJson.mockResolvedValue({ data: { tables: [] } })
      mockGetWorkspaceHostContextForViewer.mockResolvedValue(null)
      const client = makeClient()

      await run(client)

      expect(mockListFoldersForWorkspace).not.toHaveBeenCalled()
      expect(
        client.getQueryData(folderKeys.list(WORKSPACE_ID, 'active', resourceType))
      ).toBeUndefined()
    })
  })

  describe('prefetchKnowledgeBases', () => {
    it('primes the exact key useKnowledgeBasesQuery reads and unwraps data', async () => {
      const bases = [{ id: 'kb-1' }]
      mockPrefetchInternalJson.mockResolvedValue({ data: bases })
      const client = makeClient()

      await prefetchKnowledgeBases(client, WORKSPACE_ID, USER_ID)

      expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
        `/api/knowledge?workspaceId=${WORKSPACE_ID}&scope=active`
      )
      expect(client.getQueryData(knowledgeKeys.list(WORKSPACE_ID, 'active'))).toEqual(bases)
    })
  })

  describe('prefetchTables', () => {
    it('primes the exact key useTablesList reads and unwraps data.tables', async () => {
      const tables = [{ id: 't-1' }]
      mockPrefetchInternalJson.mockResolvedValue({ data: { tables } })
      const client = makeClient()

      await prefetchTables(client, WORKSPACE_ID, USER_ID)

      expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
        `/api/table?workspaceId=${WORKSPACE_ID}&scope=active`
      )
      expect(client.getQueryData(tableKeys.list(WORKSPACE_ID, 'active'))).toEqual(tables)
    })
  })

  describe('prefetchFilesBrowser', () => {
    it('primes the folder key the client hook reads', async () => {
      const folders = [{ id: 'folder-1' }]
      mockListWorkspaceFileFolders.mockResolvedValue(folders)
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID)

      expect(mockListWorkspaceFileFolders).toHaveBeenCalledWith(WORKSPACE_ID, { scope: 'active' })
      expect(client.getQueryData(workspaceFileFolderKeys.list(WORKSPACE_ID, 'active'))).toEqual(
        folders
      )
    })

    /**
     * The FILE LIST is deliberately not primed here — `prefetchWorkspaceSidebar` owns it, because the
     * sidebar reads that query on every workspace route and therefore registers it before any page
     * renders. `HydrationBoundary` hands an already-seen query to a `useEffect`, which SSR never runs,
     * so a page-level prefetch of this key costs a request per render and still cannot reach the server
     * render. Restoring it here would reintroduce exactly that.
     */
    it('leaves the file list to the layout rather than re-reading it per page', async () => {
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID)

      expect(mockListWorkspaceFilesWithShares).not.toHaveBeenCalled()
      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toBeUndefined()
    })

    /**
     * The reads bypass the route that used to authorize them, so a viewer without workspace
     * access must prime nothing and let the client fetch reach the route for the real 403.
     */
    it('caches nothing when the viewer has no workspace access', async () => {
      mockGetWorkspaceHostContextForViewer.mockResolvedValue(null)
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID)

      expect(client.getQueryCache().getAll()).toHaveLength(0)
      expect(mockListWorkspaceFileFolders).not.toHaveBeenCalled()
    })
  })

  describe('resource-list chrome', () => {
    /**
     * Pinned ids are the list's primary sort key, so a page that paints without them renders
     * the whole list in the wrong order and then visibly re-sorts. Members back the Owner
     * column. Both must be primed on every foldered page, under the exact client keys.
     */
    const chromeCases = [
      {
        name: 'files',
        run: (client: QueryClient) => prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID),
        resourceType: 'file' as const,
      },
      {
        name: 'tables',
        run: (client: QueryClient) => prefetchTables(client, WORKSPACE_ID, USER_ID),
        resourceType: 'table' as const,
      },
      {
        name: 'knowledge',
        run: (client: QueryClient) => prefetchKnowledgeBases(client, WORKSPACE_ID, USER_ID),
        resourceType: 'knowledge_base' as const,
      },
    ]

    for (const { name, run, resourceType } of chromeCases) {
      it(`primes pinned ids (${resourceType} + folder) and members for ${name}`, async () => {
        const pinnedItems = [{ id: 'p-1', resourceId: 'r-1' }]
        const members = [{ userId: 'u-1', name: 'Ada' }]
        mockPrefetchInternalJson.mockImplementation(async (path: string) => {
          if (path.startsWith('/api/pinned-items')) return { pinnedItems }
          if (path.endsWith('/members')) return { members }
          if (path.includes('/folders')) return { folders: [] }
          return { success: true, files: [], data: { tables: [] } }
        })
        const client = makeClient()

        await run(client)

        expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
          `/api/pinned-items?workspaceId=${WORKSPACE_ID}&resourceType=${resourceType}`
        )
        expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
          `/api/pinned-items?workspaceId=${WORKSPACE_ID}&resourceType=folder`
        )
        expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
          `/api/workspaces/${WORKSPACE_ID}/members`
        )
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

  describe('prefetchHomeLists', () => {
    it('primes folder + file keys, mapping folder rows to the client shape', async () => {
      const folderRow = {
        id: 'folder-1',
        name: 'Docs',
        userId: 'u-1',
        workspaceId: WORKSPACE_ID,
        parentId: null,
        resourceType: 'workflow',
        locked: false,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      }
      const files = [{ id: 'f-1' }]
      mockPrefetchInternalJson.mockImplementation(async (path: string) =>
        path.startsWith('/api/folders') ? { folders: [folderRow] } : { success: true, files }
      )
      const client = makeClient()

      mockListWorkspaceFilesWithShares.mockResolvedValue(files)

      await prefetchHomeLists(client, WORKSPACE_ID, USER_ID)

      /**
       * Folders are hydrated by the workspace sidebar prefetch under this same
       * key, so repeating them here would be a second read of data the layout
       * already has.
       */
      expect(mockPrefetchInternalJson).not.toHaveBeenCalled()
      expect(mockListFoldersForWorkspace).not.toHaveBeenCalled()
      expect(client.getQueryData(folderKeys.list(WORKSPACE_ID, 'active'))).toBeUndefined()

      expect(mockListWorkspaceFilesWithShares).toHaveBeenCalledWith(WORKSPACE_ID, 'active')
      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toEqual(files)
    })
  })

  describe('graceful failure', () => {
    it.each([
      [
        'prefetchKnowledgeBases',
        (client: QueryClient) => prefetchKnowledgeBases(client, WORKSPACE_ID, USER_ID),
        knowledgeKeys.list(WORKSPACE_ID, 'active'),
      ],
      [
        'prefetchTables',
        (client: QueryClient) => prefetchTables(client, WORKSPACE_ID, USER_ID),
        tableKeys.list(WORKSPACE_ID, 'active'),
      ],
      [
        'prefetchHomeLists',
        (client: QueryClient) => prefetchHomeLists(client, WORKSPACE_ID, USER_ID),
        folderKeys.list(WORKSPACE_ID, 'active'),
      ],
      [
        'prefetchFilesBrowser',
        (client: QueryClient) => prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID),
        workspaceFilesKeys.list(WORKSPACE_ID, 'active'),
      ],
    ] as const)(
      '%s does not throw when the fetcher rejects (page still renders, client refetches)',
      async (_name, prefetch, queryKey) => {
        mockPrefetchInternalJson.mockRejectedValue(new Error('500'))
        mockListWorkspaceFilesWithShares.mockRejectedValue(new Error('500'))
        const client = makeClient()

        await expect(prefetch(client)).resolves.toBeUndefined()
        expect(client.getQueryData(queryKey)).toBeUndefined()
      }
    )
  })
})
