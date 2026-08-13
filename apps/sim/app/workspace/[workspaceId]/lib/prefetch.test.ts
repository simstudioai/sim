/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticate,
  mockGetWorkspaceHostContextForViewer,
  mockGetWorkspaceMemberProfiles,
  mockKnowledgePresenterList,
  mockListFoldersForWorkspace,
  mockListInternalKnowledgeBases,
  mockListPinnedItemsForUser,
  mockListTables,
  mockListWorkspaceFileFolders,
  mockListWorkspaceFilesWithShares,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockGetWorkspaceHostContextForViewer: vi.fn(),
  mockGetWorkspaceMemberProfiles: vi.fn(),
  mockKnowledgePresenterList: vi.fn(),
  mockListFoldersForWorkspace: vi.fn(),
  mockListInternalKnowledgeBases: vi.fn(),
  mockListPinnedItemsForUser: vi.fn(),
  mockListTables: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockListWorkspaceFilesWithShares: vi.fn(),
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
vi.mock('@/lib/pinned-items/queries', () => ({
  listPinnedItemsForUser: mockListPinnedItemsForUser,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceMemberProfiles: mockGetWorkspaceMemberProfiles,
}))
vi.mock('@/lib/table/service', () => ({
  listTables: mockListTables,
}))
/**
 * `typeMetadataOf` is the one leaf of the real wire projection that reaches the
 * column-type registry, and through it every type module's icon and editor. Stub
 * that leaf only, so `toTableListItem`'s timestamp, `metadata`, and job
 * normalization stay under test rather than being mocked away wholesale.
 */
vi.mock('@/lib/table/column-types', () => ({
  typeMetadataOf: () => ({}),
}))
vi.mock('@/lib/api/server/routes', () => ({
  internalSessionAuth: { authenticate: mockAuthenticate },
}))
vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  listInternalKnowledgeBases: { execute: mockListInternalKnowledgeBases },
}))
vi.mock('@/lib/knowledge/api/internal-route', () => ({
  internalKnowledgePresenters: { list: mockKnowledgePresenterList },
}))

vi.mock('@sim/emcn', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { prefetchFilesBrowser } from '@/app/workspace/[workspaceId]/files/prefetch'
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
    mockListPinnedItemsForUser.mockResolvedValue([])
    mockGetWorkspaceMemberProfiles.mockResolvedValue([])
    mockListTables.mockResolvedValue([])
    mockAuthenticate.mockResolvedValue({ kind: 'session', userId: USER_ID, sessionId: 'sess-1' })
    mockListInternalKnowledgeBases.mockResolvedValue({ knowledgeBases: [] })
    mockKnowledgePresenterList.mockReturnValue({ success: true, data: [] })
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
      mockListFoldersForWorkspace.mockResolvedValue([folderRow])
      const client = makeClient()

      await run(client)

      expect(mockListFoldersForWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, 'active', resourceType)
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
    /**
     * The bases list is a protected read behind an application operation, so the prefetch runs
     * the same use case the route declares, with a principal from the same auth policy —
     * rather than reaching past it to a manager.
     */
    it('runs the route’s own use case with a session principal', async () => {
      const client = makeClient()

      await prefetchKnowledgeBases(client, WORKSPACE_ID, USER_ID)

      expect(mockAuthenticate).toHaveBeenCalled()
      expect(mockListInternalKnowledgeBases).toHaveBeenCalledWith({
        principal: { kind: 'session', userId: USER_ID, sessionId: 'sess-1' },
        input: { workspaceId: WORKSPACE_ID, scope: 'active' },
      })
      expect(client.getQueryData(knowledgeKeys.list(WORKSPACE_ID, 'active'))).toEqual([])
    })

    it('caches nothing when the session principal cannot be built', async () => {
      mockAuthenticate.mockRejectedValue(new Error('Unauthorized'))
      const client = makeClient()

      await prefetchKnowledgeBases(client, WORKSPACE_ID, USER_ID)

      expect(mockListInternalKnowledgeBases).not.toHaveBeenCalled()
      expect(client.getQueryData(knowledgeKeys.list(WORKSPACE_ID, 'active'))).toBeUndefined()
    })
  })

  describe('prefetchTables', () => {
    const TABLE_ROW = {
      id: 't-1',
      name: 'people',
      description: null,
      schema: { columns: [{ id: 'c1', name: 'name', type: 'string' }] },
      metadata: { columnWidths: { c1: 120 } },
      rowCount: 3,
      maxRows: 10_000,
      workspaceId: WORKSPACE_ID,
      folderId: null,
      createdBy: 'u-1',
      locks: {
        schemaLocked: false,
        insertLocked: false,
        updateLocked: false,
        deleteLocked: false,
      },
      archivedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    }

    it('reads tables from the data layer', async () => {
      mockListTables.mockResolvedValue([TABLE_ROW])
      const client = makeClient()

      await prefetchTables(client, WORKSPACE_ID, USER_ID)

      expect(mockListTables).toHaveBeenCalledWith(WORKSPACE_ID, { scope: 'active' })
    })

    /**
     * `listTablesContract`'s response schema is a passthrough, so a client fetch caches the
     * route's JSON verbatim. Seeding the raw data-layer row would put `Date`s and the
     * server-only `metadata` field under a key the hook never sees them on.
     */
    it('seeds the wire shape a client fetch caches, not the raw data-layer row', async () => {
      mockListTables.mockResolvedValue([TABLE_ROW])
      const client = makeClient()

      await prefetchTables(client, WORKSPACE_ID, USER_ID)

      const [cached] = client.getQueryData(tableKeys.list(WORKSPACE_ID, 'active')) as Array<
        Record<string, unknown>
      >
      expect(cached.createdAt).toBe('2026-01-01T00:00:00.000Z')
      expect(cached.updatedAt).toBe('2026-01-02T00:00:00.000Z')
      expect(cached.archivedAt).toBeNull()
      expect(cached).not.toHaveProperty('metadata')
      expect(cached.jobStatus).toBeNull()
      expect(cached.jobRowsProcessed).toBe(0)
    })

    it('caches no tables when the viewer cannot be proved', async () => {
      mockGetWorkspaceHostContextForViewer.mockResolvedValue(null)
      const client = makeClient()

      await prefetchTables(client, WORKSPACE_ID, USER_ID)

      expect(mockListTables).not.toHaveBeenCalled()
      expect(client.getQueryData(tableKeys.list(WORKSPACE_ID, 'active'))).toBeUndefined()
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
        /**
         * Distinct fixtures per key: identical ones would still pass if the two pin
         * namespaces were crossed.
         */
        const resourcePins = [{ id: 'p-1', resourceType, resourceId: 'r-1' }]
        const folderPins = [{ id: 'p-2', resourceType: 'folder' as const, resourceId: 'fld-1' }]
        const members = [{ userId: 'u-1', name: 'Ada', image: null }]
        mockListPinnedItemsForUser.mockImplementation(
          async (_userId: string, _workspaceId: string, type: string) =>
            type === 'folder' ? folderPins : resourcePins
        )
        mockGetWorkspaceMemberProfiles.mockResolvedValue(members)
        const client = makeClient()

        await run(client)

        expect(mockListPinnedItemsForUser).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID, resourceType)
        expect(mockListPinnedItemsForUser).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID, 'folder')
        expect(mockGetWorkspaceMemberProfiles).toHaveBeenCalledWith(WORKSPACE_ID)
        expect(client.getQueryData(pinnedItemKeys.list(WORKSPACE_ID, resourceType))).toEqual(
          resourcePins
        )
        expect(client.getQueryData(pinnedItemKeys.list(WORKSPACE_ID, 'folder'))).toEqual(folderPins)
        expect(client.getQueryData(workspaceKeys.members(WORKSPACE_ID))).toEqual(members)
      })

      it(`caches no chrome for ${name} when the viewer cannot be proved`, async () => {
        mockGetWorkspaceHostContextForViewer.mockResolvedValue(null)
        const client = makeClient()

        await run(client)

        expect(mockListPinnedItemsForUser).not.toHaveBeenCalled()
        expect(mockGetWorkspaceMemberProfiles).not.toHaveBeenCalled()
        expect(client.getQueryData(pinnedItemKeys.list(WORKSPACE_ID, resourceType))).toBeUndefined()
        expect(client.getQueryData(workspaceKeys.members(WORKSPACE_ID))).toBeUndefined()
      })
    }
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
        'prefetchFilesBrowser',
        (client: QueryClient) => prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID),
        workspaceFilesKeys.list(WORKSPACE_ID, 'active'),
      ],
    ] as const)(
      '%s does not throw when the fetcher rejects (page still renders, client refetches)',
      async (_name, prefetch, queryKey) => {
        const boom = new Error('500')
        mockListWorkspaceFilesWithShares.mockRejectedValue(boom)
        mockListFoldersForWorkspace.mockRejectedValue(boom)
        mockListTables.mockRejectedValue(boom)
        mockListInternalKnowledgeBases.mockRejectedValue(boom)
        mockListPinnedItemsForUser.mockRejectedValue(boom)
        mockGetWorkspaceMemberProfiles.mockRejectedValue(boom)
        const client = makeClient()

        await expect(prefetch(client)).resolves.toBeUndefined()
        expect(client.getQueryData(queryKey)).toBeUndefined()
      }
    )
  })
})
