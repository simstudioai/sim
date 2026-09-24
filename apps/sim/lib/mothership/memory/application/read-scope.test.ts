/** @vitest-environment node */
import { copilotChats, member, workspace } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { MEMORY_SCOPE_AUDIENCE, readMemoryScope } from './read-scope'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  banned: vi.fn(),
  permission: vi.fn(),
  capability: vi.fn(),
}))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: mocks.banned }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/permission-groups/capability-assertions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permission-groups/capability-assertions')>()),
  assertWorkspaceCapability: mocks.capability,
}))
const input = { chatId: 'chat-1' }
function principal() {
  return createTrustedOrganizationCopilotPrincipal(
    { userId: 'actor', organizationId: 'org-1', chatId: 'chat-1', delegationId: 'memory-1' },
    { audience: MEMORY_SCOPE_AUDIENCE, ttlMs: 60_000 }
  )
}
function queueChat(mode = 'plan', membership = true) {
  queueTableRows(copilotChats, [
    { userId: 'actor', organizationId: 'org-1', workspaceId: null, type: 'mothership', mode },
  ])
  queueTableRows(member, membership ? [{ role: 'member' }] : [])
}
describe('private memory scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.banned.mockResolvedValue([])
    mocks.config.mockResolvedValue(null)
    mocks.permission.mockResolvedValue('read')
    mocks.capability.mockResolvedValue(undefined)
  })
  it.each(['plan', 'agent'])('resolves the current %s chat owner', async (mode) => {
    queueChat(mode)
    expect(await readMemoryScope.execute({ principal: principal(), input })).toEqual({
      userId: 'actor',
      organizationId: 'org-1',
      workspaceId: null,
    })
  })
  it.each(['user', 'organization', 'chat', 'audience', 'expired'] as const)(
    'rejects forged %s',
    async (field) => {
      queueChat()
      const trusted = principal()
      const caller = {
        ...trusted,
        ...(field === 'user' ? { subjectUserId: 'other' } : {}),
        ...(field === 'organization' ? { organizationId: 'other' } : {}),
        ...(field === 'chat' ? { resourceScope: { chatId: 'other' } } : {}),
        ...(field === 'audience' ? { audience: 'other' } : {}),
        ...(field === 'expired' ? { expiresAt: new Date(0) } : {}),
      }
      await expect(readMemoryScope.execute({ principal: caller, input })).rejects.toThrow()
    }
  )
  it('rejects revoked membership, Search chats, and suspended users', async () => {
    queueChat('plan', false)
    await expect(readMemoryScope.execute({ principal: principal(), input })).rejects.toThrow()
    resetDbChainMock()
    queueChat('assistant')
    await expect(readMemoryScope.execute({ principal: principal(), input })).rejects.toThrow()
    resetDbChainMock()
    queueChat()
    mocks.banned.mockResolvedValue(['actor'])
    await expect(readMemoryScope.execute({ principal: principal(), input })).rejects.toThrow()
  })
  it('derives workspace organization from canonical state and rechecks access on every call', async () => {
    function queueWorkspace() {
      queueTableRows(copilotChats, [
        {
          userId: 'actor',
          organizationId: null,
          workspaceId: 'workspace',
          type: 'mothership',
          mode: 'plan',
        },
      ])
      queueTableRows(workspace, [
        {
          id: 'workspace',
          organizationId: 'canonical-org',
          allowPersonalApiKeys: true,
          billedAccountUserId: 'billing-owner',
        },
      ])
    }
    const caller = createTrustedCopilotPrincipal(
      { userId: 'actor', workspaceId: 'workspace', chatId: 'chat-1', delegationId: 'memory' },
      { audience: MEMORY_SCOPE_AUDIENCE, ttlMs: 60000 }
    )
    queueWorkspace()
    expect(await readMemoryScope.execute({ principal: caller, input })).toEqual({
      userId: 'actor',
      organizationId: 'canonical-org',
      workspaceId: 'workspace',
    })
    expect(mocks.capability).toHaveBeenCalledWith(
      'actor',
      'workspace',
      'copilot.use',
      'canonical-org',
      undefined
    )
    resetDbChainMock()
    queueWorkspace()
    mocks.permission.mockResolvedValue(null)
    await expect(readMemoryScope.execute({ principal: caller, input })).rejects.toThrow()
    resetDbChainMock()
    queueWorkspace()
    mocks.permission.mockResolvedValue('read')
    await expect(
      readMemoryScope.execute({
        principal: { ...caller, resourceScope: { chatId: 'other' } },
        input,
      })
    ).rejects.toThrow()
    resetDbChainMock()
    queueWorkspace()
    mocks.capability.mockRejectedValue(new Error('Capability revoked'))
    await expect(readMemoryScope.execute({ principal: caller, input })).rejects.toThrow(
      'Capability revoked'
    )
  })
})
