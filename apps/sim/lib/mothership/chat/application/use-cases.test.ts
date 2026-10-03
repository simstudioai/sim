import type { OrganizationDelegatedPrincipal, Principal } from '@sim/auth/principal'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  mothershipChatStatusMock,
  mothershipChatStatusMockFns,
} from '@sim/testing/mocks/mothership-chat-status.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mothership/chat-status', () => mothershipChatStatusMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
const hoisted = vi.hoisted(() => ({ authorizeWorkspace: vi.fn() }))
vi.mock('@/lib/core/application/workspace-authorization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: hoisted.authorizeWorkspace,
}))

import {
  archivedChatListInputSchema,
  listWorkspaceChats,
  projectArchivedChatsForTool,
  restoreMothershipChat,
} from '@/lib/mothership/chat/application/use-cases'
import { listOrganizationChats } from '@/lib/mothership/chat/organization-chats'

const mocks = {
  publish: mothershipChatStatusMockFns.mockPublishChatStatusChanged,
  authorizeWorkspace: hoisted.authorizeWorkspace,
  config: permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
  workspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
}

const principal: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date('2020-01-01'),
  expiresAt: new Date('2099-01-01'),
  resourceScope: { chatId: 'origin-chat' },
}
const session = createSessionPrincipal({ userId: 'actor', sessionId: 'session' })
const input = { chatId: 'archived-chat', assertedOrganizationId: 'org' }
beforeEach(() => {
  resetDbChainMock()
  mocks.config.mockResolvedValue(null)
  mocks.workspace.mockResolvedValue({
    workspaceId: 'workspace',
    workspaceOrganizationId: 'org',
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner',
  })
  mocks.authorizeWorkspace.mockResolvedValue(undefined)
})

describe('private archived chat operations', () => {
  it.each<Principal>([
    createPersonalApiKeyPrincipal({ userId: 'actor', keyId: 'key' }),
    createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }),
    { ...principal, audience: 'sim:knowledge' },
    { ...principal, expiresAt: new Date(0) },
    {
      ...principal,
      serviceId: 'slack-search',
      resourceScope: { installationId: 'install', eventId: 'event' },
    },
  ])('refuses unsupported or stale restore authority before loading chats', async (caller) => {
    await expect(restoreMothershipChat.execute({ principal: caller, input })).rejects.toThrow()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('allows a current organization member to restore their archived sibling chat', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ role: 'member' }])
      .mockResolvedValueOnce([{ workspaceId: null, organizationId: 'org' }])
      .mockResolvedValueOnce([{ role: 'member' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ workspaceId: null, organizationId: 'org' }])
    await expect(restoreMothershipChat.execute({ principal, input })).resolves.toEqual({
      chatId: 'archived-chat',
      userId: 'actor',
      workspaceId: null,
      organizationId: 'org',
    })
    expect(mocks.publish).toHaveBeenCalledWith(
      { workspaceId: null, organizationId: 'org', userId: 'actor' },
      { chatId: 'archived-chat', type: 'created' }
    )
  })
  it('does not use organization administrator status to restore someone else’s chat', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'owner' }]).mockResolvedValueOnce([])
    await expect(restoreMothershipChat.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('refuses cross-organization and asserted-owner mismatches', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ role: 'member' }])
      .mockResolvedValueOnce([{ workspaceId: null, organizationId: 'other-org' }])
    await expect(restoreMothershipChat.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('does not restore after membership revocation', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(restoreMothershipChat.execute({ principal, input })).rejects.toThrow()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('preserves current workspace access and subject ownership', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'workspace', organizationId: null }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { workspaceId: 'workspace', organizationId: null },
    ])
    await restoreMothershipChat.execute({
      principal: session,
      input: { chatId: 'archived-chat', assertedWorkspaceId: 'workspace' },
    })
    expect(mocks.authorizeWorkspace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ minimumRole: 'read', capability: 'none' }),
      expect.objectContaining({ workspaceId: 'workspace' }),
      expect.any(Object)
    )
  })
  it('does not publish when a concurrent restore/delete wins', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'workspace', organizationId: null }])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      restoreMothershipChat.execute({ principal: session, input: { chatId: 'archived-chat' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('bounds organization archived lists and skips stream-marker repair', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ role: 'member' }]).mockResolvedValueOnce([])
    await expect(
      listOrganizationChats.execute({
        principal,
        input: { organizationId: 'org', scope: 'archived', limit: 100 },
      })
    ).resolves.toEqual([])
    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(100)
  })
  it('bounds workspace archived lists through shared current authorization', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(
      listWorkspaceChats.execute({
        principal: session,
        input: { workspaceId: 'workspace', scope: 'archived', limit: 100 },
      })
    ).resolves.toEqual([])
    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(100)
  })
  it('removes stream identity and bounds tool metadata', () => {
    expect(archivedChatListInputSchema.safeParse({ limit: 201 }).success).toBe(false)
    const result = projectArchivedChatsForTool([
      {
        id: 'chat',
        title: 'x'.repeat(2000),
        mode: 'agent',
        updatedAt: '2026-09-15T00:00:00.000Z',
        deletedAt: '2026-09-15T00:00:00.000Z',
        activeStreamId: 'secret',
        lastSeenAt: null,
        pinned: false,
      },
    ])
    expect(result[0].title!.length).toBeLessThanOrEqual(500)
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
