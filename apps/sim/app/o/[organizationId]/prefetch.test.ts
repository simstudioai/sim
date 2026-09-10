/**
 * @vitest-environment node
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { dehydrate, hydrate, QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListOrganizationChats, mockListWorkspacesForViewer, mockGetUserProfile } = vi.hoisted(
  () => ({
    mockListOrganizationChats: vi.fn(),
    mockListWorkspacesForViewer: vi.fn(),
    mockGetUserProfile: vi.fn(),
  })
)

vi.mock('@/lib/copilot/chat/organization-chats', () => ({
  listOrganizationChats: { execute: mockListOrganizationChats },
}))
vi.mock('@/lib/workspaces/list', () => ({
  listWorkspacesForViewer: mockListWorkspacesForViewer,
}))
vi.mock('@/lib/users/queries', () => ({ getUserProfile: mockGetUserProfile }))
vi.mock('@sim/emcn', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { prefetchOrganizationSidebar } from '@/app/o/[organizationId]/prefetch'
import { userProfileKeys } from '@/hooks/queries/current-user-data'
import {
  MOTHERSHIP_CHAT_LIST_STALE_TIME,
  mothershipChatKeys,
} from '@/hooks/queries/mothership-chats'
import { workspaceKeys } from '@/hooks/queries/workspace'

const PRINCIPAL: SessionPrincipal = { kind: 'session', userId: 'viewer', sessionId: 'session' }
const CHAT = {
  id: 'chat',
  title: 'Project notes',
  updatedAt: '2026-01-02T00:00:00.000Z',
  activeStreamId: null,
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  pinned: true,
  deletedAt: null,
}
const WORKSPACES = {
  workspaces: [
    {
      id: 'workspace',
      name: 'Engineering',
      ownerId: 'viewer',
      organizationId: 'route-org',
      workspaceMode: 'organization',
      permissions: 'read',
    },
  ],
  lastActiveWorkspaceId: 'workspace',
  pinnedWorkspaceIds: ['workspace'],
  creationPolicy: null,
}
const CHAT_KEY = mothershipChatKeys.organizationList('route-org', 'active')

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function prefetch(client: QueryClient) {
  return prefetchOrganizationSidebar(client, 'route-org', PRINCIPAL, 'active-org')
}

describe('organization sidebar hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListOrganizationChats.mockResolvedValue([CHAT])
    mockListWorkspacesForViewer.mockResolvedValue(WORKSPACES)
    mockGetUserProfile.mockResolvedValue({ id: 'viewer', name: 'Ada', email: 'ada@example.test' })
  })

  it('hydrates the current viewer’s routed org chats and keeps workspace metadata intact', async () => {
    const server = makeClient()
    await prefetch(server)
    const client = makeClient()
    hydrate(client, dehydrate(server))

    expect(mockListOrganizationChats).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: { organizationId: 'route-org', scope: 'active' },
    })
    expect(mockListWorkspacesForViewer).toHaveBeenCalledWith({
      userId: 'viewer',
      activeOrganizationId: 'active-org',
      scope: 'active',
    })
    expect(client.getQueryData(CHAT_KEY)).toEqual([
      {
        id: 'chat',
        name: 'Project notes',
        updatedAt: new Date(CHAT.updatedAt),
        isActive: false,
        isUnread: true,
        isPinned: true,
        deletedAt: null,
      },
    ])
    expect(client.getQueryData(workspaceKeys.list('active'))).toMatchObject(WORKSPACES)
    expect(client.getQueryData(userProfileKeys.profile())).toMatchObject({ name: 'Ada' })
    expect(client.getQueryData(mothershipChatKeys.organizationList('active-org'))).toBeUndefined()
    expect(client.getQueryData(mothershipChatKeys.list('workspace'))).toBeUndefined()
    expect(
      client.getQueryData(mothershipChatKeys.organizationList('route-org', 'archived'))
    ).toBeUndefined()
  })

  it('starts the independent reads together and waits for all before dehydration', async () => {
    const chats = Promise.withResolvers<(typeof CHAT)[]>()
    const workspaces = Promise.withResolvers<typeof WORKSPACES>()
    mockListOrganizationChats.mockReturnValue(chats.promise)
    mockListWorkspacesForViewer.mockReturnValue(workspaces.promise)
    const client = makeClient()
    let finished = false
    const pending = prefetch(client).then(() => {
      finished = true
    })

    expect(mockListOrganizationChats).toHaveBeenCalledOnce()
    expect(mockListWorkspacesForViewer).toHaveBeenCalledOnce()
    expect(mockGetUserProfile).toHaveBeenCalledOnce()
    expect(dehydrate(client).queries).toHaveLength(0)
    expect(finished).toBe(false)
    chats.resolve([CHAT])
    await chats.promise
    expect(finished).toBe(false)
    workspaces.resolve(WORKSPACES)
    await pending
    expect(dehydrate(client).queries).toHaveLength(3)
  })

  it('caches an empty chat list but leaves empty workspaces for the client creation path', async () => {
    mockListOrganizationChats.mockResolvedValue([])
    mockListWorkspacesForViewer.mockResolvedValue({ ...WORKSPACES, workspaces: [] })
    const client = makeClient()
    await prefetch(client)
    expect(client.getQueryData(CHAT_KEY)).toEqual([])
    expect(client.getQueryState(workspaceKeys.list('active'))).toBeUndefined()
  })

  it('omits a denied chat read from hydration without losing successful sidebar reads', async () => {
    mockListOrganizationChats.mockRejectedValue(new Error('Forbidden'))
    const server = makeClient()
    await expect(prefetch(server)).resolves.toBeUndefined()
    const client = makeClient()
    hydrate(client, dehydrate(server))
    expect(client.getQueryState(CHAT_KEY)).toBeUndefined()
    expect(client.getQueryData(workspaceKeys.list('active'))).toMatchObject(WORKSPACES)
    expect(mockListOrganizationChats).toHaveBeenCalledOnce()
  })

  it('does not suppress client recovery when the workspace read fails', async () => {
    mockListWorkspacesForViewer.mockRejectedValue(new Error('Unavailable'))
    const client = makeClient()
    await expect(prefetch(client)).resolves.toBeUndefined()
    expect(client.getQueryState(workspaceKeys.list('active'))).toBeUndefined()
    expect(client.getQueryData(CHAT_KEY)).toHaveLength(1)
  })

  it('does not fetch chats again when a fresh hydrated observer mounts', async () => {
    const server = makeClient()
    await prefetch(server)
    const client = makeClient()
    hydrate(client, dehydrate(server))
    const fetchChats = vi.fn().mockResolvedValue([])
    const observer = new QueryObserver(client, {
      queryKey: CHAT_KEY,
      queryFn: fetchChats,
      staleTime: MOTHERSHIP_CHAT_LIST_STALE_TIME,
    })
    const unsubscribe = observer.subscribe(() => {})
    expect(observer.getCurrentResult().isPending).toBe(false)
    expect(observer.getCurrentResult().data).toHaveLength(1)
    expect(fetchChats).not.toHaveBeenCalled()
    unsubscribe()
  })
})
