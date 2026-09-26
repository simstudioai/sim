import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  apiServerRoutesMock,
  apiServerRoutesMockFns,
} from '@sim/testing/mocks/api-server-routes.mock'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import {
  knowledgeBaseUseCasesMock,
  knowledgeBaseUseCasesMockFns,
} from '@sim/testing/mocks/knowledge-base-use-cases.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  tableApplicationTablesMock,
  tableApplicationTablesMockFns,
} from '@sim/testing/mocks/table-application-tables.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import { usersQueriesMock, usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
import {
  workflowsQueriesMock,
  workflowsQueriesMockFns,
} from '@sim/testing/mocks/workflows-queries.mock'
import {
  workspaceFileFoldersMock,
  workspaceFileFoldersMockFns,
} from '@sim/testing/mocks/workspace-file-folders.mock'
import {
  workspaceFilesListMock,
  workspaceFilesListMockFns,
} from '@sim/testing/mocks/workspace-files-list.mock'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const {
  mockGetWorkspaceHostContextForViewer,
  mockKnowledgePresenterList,
  mockListPinnedItemsForUser,
  mockListWorkspacesForViewer,
  mockListMothershipChats,
  mockListWorkspaceFilesWithShares,
} = vi.hoisted(() => ({
  mockGetWorkspaceHostContextForViewer: vi.fn(),
  mockKnowledgePresenterList: vi.fn(),
  mockListPinnedItemsForUser: vi.fn(),
  mockListWorkspacesForViewer: vi.fn(),
  mockListMothershipChats: vi.fn(),
  mockListWorkspaceFilesWithShares: vi.fn(),
}))

vi.mock('@/lib/workspaces/host-context', () => ({
  getWorkspaceHostContextForViewer: mockGetWorkspaceHostContextForViewer,
}))
vi.mock('@/lib/folders/queries', () => folderQueriesMock)
vi.mock('@/lib/workspace-files/queries', () => ({
  listWorkspaceFilesWithShares: mockListWorkspaceFilesWithShares,
}))
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-folder-manager',
  () => workspaceFileFoldersMock
)
vi.mock('@/lib/pinned-items/queries', () => ({
  listPinnedItemsForUser: mockListPinnedItemsForUser,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workflows/queries', () => workflowsQueriesMock)
vi.mock('@/lib/workspaces/list', () => ({
  listWorkspacesForViewer: mockListWorkspacesForViewer,
}))
vi.mock('@/lib/users/queries', () => usersQueriesMock)
vi.mock('@/lib/mothership/chat/list-mothership-chats', () => ({
  listMothershipChats: mockListMothershipChats,
}))
vi.mock('@/lib/table/application/tables', () => tableApplicationTablesMock)
vi.mock('@/lib/workspace-files/application/list-workspace-files', () => workspaceFilesListMock)
vi.mock('@/lib/table/service', () => tableServiceMock)
/**
 * `typeMetadataOf` is the one leaf of the real wire projection that reaches the
 * column-type registry, and through it every type module's icon and editor. Stub
 * that leaf only, so `toTableListItem`'s timestamp, `metadata`, and job
 * normalization stay under test rather than being mocked away wholesale.
 */
vi.mock('@/lib/table/column-types', () => ({
  typeMetadataOf: () => ({}),
}))
vi.mock('@/lib/api/server/routes', () => apiServerRoutesMock)
vi.mock('@/lib/knowledge/application/knowledge-bases', () => knowledgeBaseUseCasesMock)
vi.mock('@/lib/knowledge/api/internal-route', () => ({
  internalKnowledgePresenters: { list: mockKnowledgePresenterList },
}))

vi.mock('@sim/emcn', () => emcnMock)

import { prefetchFilesBrowser } from '@/app/workspace/[workspaceId]/files/prefetch'
import { prefetchKnowledgeBases } from '@/app/workspace/[workspaceId]/knowledge/prefetch'
import { prefetchWorkspaceSidebar } from '@/app/workspace/[workspaceId]/prefetch'
import { prefetchTables } from '@/app/workspace/[workspaceId]/tables/prefetch'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { tableKeys } from '@/hooks/queries/utils/table-keys'

const mockAuthenticate = apiServerRoutesMockFns.mockInternalSessionAuthenticate
const mockListFoldersForWorkspace = folderQueriesMockFns.mockListFoldersForWorkspace
const mockListInternalKnowledgeBases =
  knowledgeBaseUseCasesMockFns.mockListInternalKnowledgeBasesExecute
const mockListWorkflowsForUser = workflowsQueriesMockFns.mockListWorkflowsForUser
const mockGetUserProfile = usersQueriesMockFns.mockGetUserProfile
const mockListWorkspaceFileFolders = workspaceFileFoldersMockFns.mockListWorkspaceFileFolders

/** One authorization decision shared by the table, knowledge, and file module operations. */
const mockAuthorizeResource = vi.fn()
for (const authorize of [
  tableApplicationTablesMockFns.mockListTableDefinitionsUseCaseAuthorize,
  knowledgeBaseUseCasesMockFns.mockListKnowledgeBasesAuthorize,
  workspaceFilesListMockFns.mockListAllWorkspaceFilesAuthorize,
]) {
  authorize.mockImplementation((...args: unknown[]) => mockAuthorizeResource(...args))
}

const mockGetWorkspacePermissions =
  permissionsMockFns.mockGetWorkspacePermissionsForAuthorizedViewer
const mockListTables = tableServiceMockFns.mockListTables
const mockGetWorkspaceMemberProfiles = permissionsMockFns.mockGetWorkspaceMemberProfiles

const WORKSPACE_ID = 'ws-123'
const USER_ID = 'user-1'

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('workspace list prefetches', () => {
  beforeEach(() => {
    mockAuthorizeResource.mockResolvedValue(undefined)
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
    mockAuthenticate.mockResolvedValue(
      createSessionPrincipal({ userId: USER_ID, sessionId: 'sess-1' })
    )
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

  it.each([prefetchTables, prefetchKnowledgeBases, prefetchFilesBrowser])(
    'seeds no protected data or chrome when the module operation refuses access',
    async (prefetch) => {
      mockAuthorizeResource.mockRejectedValue(
        new OrchestrationError('forbidden', 'Module withheld')
      )
      const client = makeClient()
      await prefetch(client, WORKSPACE_ID, USER_ID)
      expect(client.getQueryCache().getAll()).toHaveLength(0)
      expect(mockListTables).not.toHaveBeenCalled()
      expect(mockListInternalKnowledgeBases).not.toHaveBeenCalled()
      expect(mockListWorkspaceFilesWithShares).not.toHaveBeenCalled()
      expect(mockListFoldersForWorkspace).not.toHaveBeenCalled()
      expect(mockListWorkspaceFileFolders).not.toHaveBeenCalled()
      expect(mockListPinnedItemsForUser).not.toHaveBeenCalled()
    }
  )

  describe('prefetchKnowledgeBases', () => {
    it('caches nothing when the session principal cannot be built', async () => {
      mockAuthenticate.mockRejectedValue(new InternalUnauthenticatedError())
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
  })
  describe('prefetchFilesBrowser', () => {
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

  describe('prefetchWorkspaceSidebar / seedWorkspaceList', () => {
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
})
