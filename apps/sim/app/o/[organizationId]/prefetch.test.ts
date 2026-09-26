import type { SessionPrincipal } from '@sim/auth/principal'
import { emcnMock } from '@sim/testing/mocks/emcn.mock'
import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import { usersQueriesMock, usersQueriesMockFns } from '@sim/testing/mocks/users-queries.mock'
import { dehydrate, hydrate, QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListWorkspacesForViewer } = vi.hoisted(() => ({
  mockListWorkspacesForViewer: vi.fn(),
}))

vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)
vi.mock('@/lib/workspaces/list', () => ({
  listWorkspacesForViewer: mockListWorkspacesForViewer,
}))
vi.mock('@/lib/users/queries', () => usersQueriesMock)
vi.mock('@sim/emcn', () => emcnMock)

import { prefetchOrganizationSidebar } from '@/app/o/[organizationId]/prefetch'
import { userProfileKeys } from '@/hooks/queries/current-user-data'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { workspaceKeys } from '@/hooks/queries/workspace'

const mockListOrganizationChats = mothershipOrganizationChatsMockFns.mockListOrganizationChats
const mockGetUserProfile = usersQueriesMockFns.mockGetUserProfile

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
})
