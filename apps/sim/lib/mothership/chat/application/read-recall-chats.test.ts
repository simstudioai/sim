/** @vitest-environment node */
import { copilotChats, member, workspace } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { authBanMock, authBanMockFns } from '@sim/testing/mocks/auth-ban.mock'
import {
  mothershipOrganizationChatsMock,
  mothershipOrganizationChatsMockFns,
} from '@sim/testing/mocks/mothership-organization-chats.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import {
  RECALL_CHATS_AUDIENCE,
  readRecallChats,
} from '@/lib/mothership/chat/application/read-recall-chats'

const mocks = vi.hoisted(() => ({
  capability: vi.fn(),
  plan: vi.fn(),
}))
vi.mock('@/lib/permission-groups/capability-assertions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permission-groups/capability-assertions')>()),
  assertWorkspaceCapability: mocks.capability,
}))
vi.mock('@/lib/mothership/chat/organization-chats', () => mothershipOrganizationChatsMock)
vi.mock('@/lib/mothership/feature-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mothership/feature-flags')>()),
  isPlanModeEnabled: mocks.plan,
}))

const build = mothershipOrganizationChatsMockFns.mockRequireOrganizationBuildPermission

const input = { chatId: 'chat-1', limit: 50 }
const listed = [
  { id: 'chat-2', title: 'Import fix', updatedAt: new Date('2026-10-19T10:00:00.000Z') },
  { id: 'chat-3', title: null, updatedAt: new Date('2026-10-18T09:00:00.000Z') },
]
const expected = {
  userId: 'actor',
  chats: [
    { id: 'chat-2', title: 'Import fix', updatedAt: '2026-10-19T10:00:00.000Z' },
    { id: 'chat-3', title: null, updatedAt: '2026-10-18T09:00:00.000Z' },
  ],
}

function organizationPrincipal() {
  return createTrustedOrganizationCopilotPrincipal(
    { userId: 'actor', organizationId: 'org-1', chatId: 'chat-1', delegationId: 'recall-1' },
    { audience: RECALL_CHATS_AUDIENCE, ttlMs: 60_000 }
  )
}
/** The requesting chat, its owner's membership (checked by the funnel and again for the role), then the list. */
function queueOrganizationChat(mode = 'agent', membership = true) {
  queueTableRows(copilotChats, [
    { userId: 'actor', organizationId: 'org-1', workspaceId: null, type: 'mothership', mode },
  ])
  queueTableRows(member, membership ? [{ role: 'member' }] : [])
  queueTableRows(member, membership ? [{ role: 'member' }] : [])
  queueTableRows(copilotChats, listed)
}
function workspacePrincipal(overrides: { chatId?: string; audience?: string } = {}) {
  return createTrustedCopilotPrincipal(
    {
      userId: 'actor',
      workspaceId: 'workspace',
      chatId: overrides.chatId ?? 'chat-1',
      delegationId: 'recall',
    },
    { audience: overrides.audience ?? RECALL_CHATS_AUDIENCE, ttlMs: 60_000 }
  )
}
function queueWorkspaceChat(mode = 'agent', type = 'mothership') {
  queueTableRows(copilotChats, [
    { userId: 'actor', organizationId: null, workspaceId: 'workspace', type, mode },
  ])
  queueTableRows(workspace, [
    {
      id: 'workspace',
      organizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'actor',
    },
  ])
  queueTableRows(copilotChats, listed)
}
const code = (error: unknown) => (error instanceof OrchestrationError ? error.code : String(error))

describe("a chat's other chats", () => {
  beforeEach(() => {
    resetDbChainMock()
    authBanMockFns.mockGetActivelyBannedUserIds.mockResolvedValue([])
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(
      null
    )
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    mocks.capability.mockResolvedValue(undefined)
    build.mockReset()
    mocks.plan.mockReset().mockResolvedValue(true)
  })

  it.each(['agent', 'plan'])(
    "lists the owner's other live organization chats from a %s chat, newest first",
    async (mode) => {
      queueOrganizationChat(mode)
      expect(await readRecallChats.execute({ principal: organizationPrincipal(), input })).toEqual(
        expected
      )
      expect(build).toHaveBeenCalledWith({ organizationId: 'org-1', role: 'member' })
    }
  )

  it('lists nothing an organization member without build permission could open', async () => {
    queueOrganizationChat()
    build.mockRejectedValue(new OrchestrationError('forbidden', 'Build requires permission'))
    await expect(
      readRecallChats.execute({ principal: organizationPrincipal(), input })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a plan chat while Plan mode is off, in an organization or a workspace', async () => {
    mocks.plan.mockResolvedValue(false)
    queueOrganizationChat('plan')
    await expect(
      readRecallChats.execute({ principal: organizationPrincipal(), input })
    ).rejects.toMatchObject({ code: 'not_found' })
    resetDbChainMock()
    queueWorkspaceChat('plan')
    await expect(
      readRecallChats.execute({ principal: workspacePrincipal(), input })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it("lists a workspace chat owner's live chats in that workspace and rechecks access", async () => {
    queueWorkspaceChat()
    expect(await readRecallChats.execute({ principal: workspacePrincipal(), input })).toEqual(
      expected
    )
    resetDbChainMock()
    queueWorkspaceChat()
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
    await expect(
      readRecallChats.execute({ principal: workspacePrincipal(), input })
    ).rejects.toBeInstanceOf(OrchestrationError)
  })

  it.each([
    ['chat', { chatId: 'other' }],
    ['audience', { audience: 'other' }],
  ] as const)('rejects a workspace principal with a forged %s', async (_field, overrides) => {
    queueWorkspaceChat()
    const error = await readRecallChats
      .execute({ principal: workspacePrincipal(overrides), input })
      .catch((caught: unknown) => caught)
    expect(['forbidden', 'not_found']).toContain(code(error))
  })

  it.each(['user', 'organization', 'chat', 'audience', 'expired'] as const)(
    'rejects an organization principal with a forged %s',
    async (field) => {
      queueOrganizationChat()
      const trusted = organizationPrincipal()
      if (trusted.kind !== 'organization_delegated' || trusted.serviceId !== 'copilot')
        throw new Error('Expected copilot principal')
      const caller = {
        ...trusted,
        ...(field === 'user' ? { subjectUserId: 'other' } : {}),
        ...(field === 'organization' ? { organizationId: 'other' } : {}),
        ...(field === 'chat' ? { resourceScope: { chatId: 'other' } } : {}),
        ...(field === 'audience' ? { audience: 'other' } : {}),
        ...(field === 'expired' ? { expiresAt: new Date(0) } : {}),
      }
      const error = await readRecallChats
        .execute({ principal: caller, input })
        .catch((caught: unknown) => caught)
      expect(['forbidden', 'not_found']).toContain(code(error))
      expect(build).not.toHaveBeenCalled()
    }
  )

  it('lists nothing for revoked membership, an assistant chat, a workflow chat, or a suspended user', async () => {
    queueOrganizationChat('agent', false)
    await expect(
      readRecallChats.execute({ principal: organizationPrincipal(), input })
    ).rejects.toBeInstanceOf(OrchestrationError)
    resetDbChainMock()
    queueOrganizationChat('assistant')
    await expect(
      readRecallChats.execute({ principal: organizationPrincipal(), input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    resetDbChainMock()
    // A workflow's copilot chat is no home chat, so it reads no home chats back.
    queueWorkspaceChat('agent', 'copilot')
    await expect(
      readRecallChats.execute({ principal: workspacePrincipal(), input })
    ).rejects.toMatchObject({ code: 'not_found' })
    resetDbChainMock()
    queueOrganizationChat()
    authBanMockFns.mockGetActivelyBannedUserIds.mockResolvedValue(['actor'])
    await expect(
      readRecallChats.execute({ principal: organizationPrincipal(), input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(build).not.toHaveBeenCalled()
  })
})

vi.mock('@/lib/auth/ban', () => authBanMock)

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
