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
  mockListWorkflowsForUser,
  mockListWorkspacesForViewer,
  mockGetUserProfile,
  mockGetWorkspacePermissions,
  mockListMothershipChats,
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
  mockListWorkflowsForUser: vi.fn(),
  mockListWorkspacesForViewer: vi.fn(),
  mockGetUserProfile: vi.fn(),
  mockGetWorkspacePermissions: vi.fn(),
  mockListMothershipChats: vi.fn(),
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
  getWorkspacePermissionsForAuthorizedViewer: mockGetWorkspacePermissions,
}))
vi.mock('@/lib/workflows/queries', () => ({
  listWorkflowsForUser: mockListWorkflowsForUser,
}))
vi.mock('@/lib/workspaces/list', () => ({
  listWorkspacesForViewer: mockListWorkspacesForViewer,
}))
vi.mock('@/lib/users/queries', () => ({
  getUserProfile: mockGetUserProfile,
}))
vi.mock('@/lib/copilot/chat/list-mothership-chats', () => ({
  listMothershipChats: mockListMothershipChats,
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
import { prefetchWorkspaceSidebar } from '@/app/workspace/[workspaceId]/prefetch'
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
    mockListWorkflowsForUser.mockResolvedValue([])
    mockGetUserProfile.mockResolvedValue({ id: USER_ID, name: 'Ada', email: 'a@b.c' })
    mockGetWorkspacePermissions.mockResolvedValue({ users: [] })
    mockListMothershipChats.mockResolvedValue([])
    mockListWorkspacesForViewer.mockResolvedValue({
      workspaces: [],
      lastActiveWorkspaceId: null,
      pinnedWorkspaceIds: [],
      creationPolicy: null,
    })
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
    /**
     * The sibling `workspaceFilesKeys.list` once held ISO strings from one producer and
     * `Date`s from another because a seed skipped the contract parse. This key is fed by
     * a manager whose record type and the contract schema are independent declarations,
     * so the parse — and this assertion — are what stop that recurring here.
     */
    it('seeds the shape a client fetch caches, not the raw manager row', async () => {
      mockListWorkspaceFileFolders.mockResolvedValue([
        {
          id: 'folder-1',
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          name: 'Docs',
          parentId: null,
          path: '/Docs',
          sortOrder: 0,
          deletedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          serverOnlyColumn: 'should-be-stripped',
        },
      ])
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID)

      const [cached] = client.getQueryData(
        workspaceFileFolderKeys.list(WORKSPACE_ID, 'active')
      ) as Array<Record<string, unknown>>
      expect(cached.createdAt).toBeInstanceOf(Date)
      expect(cached.updatedAt).toBeInstanceOf(Date)
      expect(cached).not.toHaveProperty('serverOnlyColumn')
    })

    it('primes the folder key the client hook reads', async () => {
      const folders = [
        {
          id: 'folder-1',
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          name: 'Docs',
          parentId: null,
          path: '/Docs',
          sortOrder: 0,
          deletedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ]
      mockListWorkspaceFileFolders.mockResolvedValue(folders)
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID)

      expect(mockListWorkspaceFileFolders).toHaveBeenCalledWith(WORKSPACE_ID, { scope: 'active' })
      /** Shape parity is asserted by the sibling test; this one pins the key and the args. */
      expect(
        client.getQueryData(workspaceFileFolderKeys.list(WORKSPACE_ID, 'active')) as Array<{
          id: string
        }>
      ).toHaveLength(folders.length)
    })

    /**
     * The file list is the browser's primary content, so it must be seeded by the page that
     * renders it — the layout no longer seeds it, which would have charged every workspace
     * route for a list only a few of them read.
     */
    it('seeds the file list the browser renders', async () => {
      const files = [{ id: 'file-1' }]
      mockListWorkspaceFilesWithShares.mockResolvedValue(files)
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID)

      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toEqual(files)
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

  describe('prefetchWorkspaceSidebar / seedWorkspaceList', () => {
    const HOST_CONTEXT = {
      workspace: { id: WORKSPACE_ID },
      viewer: { permission: 'admin' },
    } as never

    const WORKSPACE_ROW = {
      id: WORKSPACE_ID,
      name: 'GTM',
      ownerId: USER_ID,
      organizationId: null,
      workspaceMode: 'personal',
      permissions: 'admin',
    }

    const LIST_PAYLOAD = {
      workspaces: [WORKSPACE_ROW],
      lastActiveWorkspaceId: null,
      pinnedWorkspaceIds: [],
      creationPolicy: null,
    }

    /**
     * The load-bearing contract: an empty list must leave the key UNSET so the client
     * fetch reaches `GET /api/workspaces`' default-workspace creation path. Seeding an
     * empty array instead would suppress it and strand a brand-new viewer.
     */
    it('seeds nothing when the viewer has no workspaces', async () => {
      mockListWorkspacesForViewer.mockResolvedValue({ ...LIST_PAYLOAD, workspaces: [] })
      const client = makeClient()

      await prefetchWorkspaceSidebar(client, WORKSPACE_ID, USER_ID, HOST_CONTEXT, null)

      expect(client.getQueryData(workspaceKeys.list('active'))).toBeUndefined()
    })

    it('seeds the workspace list when the viewer has one', async () => {
      mockListWorkspacesForViewer.mockResolvedValue(LIST_PAYLOAD)
      const client = makeClient()

      await prefetchWorkspaceSidebar(client, WORKSPACE_ID, USER_ID, HOST_CONTEXT, null)

      const cached = client.getQueryData(workspaceKeys.list('active')) as
        | { workspaces: Array<{ id: string }> }
        | undefined
      expect(cached).toBeDefined()
      expect(cached?.workspaces.map((w) => w.id)).toEqual([WORKSPACE_ID])
    })

    /** A failed seed is an optimization loss, not a render failure. */
    it('does not throw when the workspace read rejects, and seeds nothing', async () => {
      mockListWorkspacesForViewer.mockRejectedValue(new Error('500'))
      const client = makeClient()

      await expect(
        prefetchWorkspaceSidebar(client, WORKSPACE_ID, USER_ID, HOST_CONTEXT, null)
      ).resolves.toBeUndefined()
      expect(client.getQueryData(workspaceKeys.list('active'))).toBeUndefined()
    })

    /**
     * The file list belongs to the pages that render it, not to every workspace route. A sidebar
     * seed would charge the workflow editor, logs, and settings for a read none of them make.
     */
    it('does not read the workspace file list', async () => {
      const client = makeClient()

      await prefetchWorkspaceSidebar(client, WORKSPACE_ID, USER_ID, HOST_CONTEXT, null)

      expect(mockListWorkspaceFilesWithShares).not.toHaveBeenCalled()
      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toBeUndefined()
    })

    /** Guards the mismatch check that keeps one workspace's data out of another's cache. */
    it('seeds nothing when the host context is for a different workspace', async () => {
      mockListWorkspacesForViewer.mockResolvedValue(LIST_PAYLOAD)
      const client = makeClient()

      await prefetchWorkspaceSidebar(
        client,
        WORKSPACE_ID,
        USER_ID,
        { workspace: { id: 'other-ws' }, viewer: { permission: 'admin' } } as never,
        null
      )

      expect(client.getQueryCache().getAll()).toHaveLength(0)
      expect(mockListWorkspacesForViewer).not.toHaveBeenCalled()
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
        /**
         * Asserted against the folder key: the file list is seeded rather than prefetched, so
         * a rejecting read leaves that key empty by design and could not distinguish a
         * swallowed failure from a function that did nothing.
         */
        'prefetchFilesBrowser',
        (client: QueryClient) => prefetchFilesBrowser(client, WORKSPACE_ID, USER_ID),
        workspaceFileFolderKeys.list(WORKSPACE_ID, 'active'),
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
        mockListWorkspaceFileFolders.mockRejectedValue(boom)
        const client = makeClient()

        await expect(prefetch(client)).resolves.toBeUndefined()
        expect(client.getQueryData(queryKey)).toBeUndefined()
      }
    )
  })
})
