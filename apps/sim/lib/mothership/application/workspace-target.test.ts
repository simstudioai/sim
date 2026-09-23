/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ target: vi.fn(), context: vi.fn(), authorize: vi.fn() }))
vi.mock('@/lib/mothership/chat/application/workspace-target', () => ({
  WORKSPACE_TARGET_AUDIENCE: 'sim:workspaces',
  authorizeChatWorkspaceTarget: { execute: mocks.target },
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@/lib/core/application', async (original) => ({
  ...(await original<typeof import('@/lib/core/application')>()),
  authorizeWorkspaceOperation: mocks.authorize,
}))

import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.target.mockResolvedValue({ workspaceId: 'target', permission: 'write' })
})
describe('explicit invocation workspace', () => {
  it('requires a target for every org call without borrowing a prior bound workspace', async () => {
    await expect(
      resolveInvocationWorkspace({ userId: 'user', chatId: 'chat', organizationId: 'org' })
    ).rejects.toThrow('explicit workspace')
    await expect(
      resolveInvocationWorkspace({
        userId: 'user',
        chatId: 'chat',
        workspaceId: 'previous',
        chatOrganizationId: 'org',
      })
    ).rejects.toThrow('explicit workspace')
    expect(mocks.target).not.toHaveBeenCalled()
  })
  it('keeps workspace conversations scoped and cannot choose another workspace', async () => {
    await expect(
      resolveInvocationWorkspace({ userId: 'user', chatId: 'chat', workspaceId: 'own' }, 'other')
    ).rejects.toThrow('Workspace not found')
    expect(mocks.target).not.toHaveBeenCalled()
  })
  it('uses an exact owned-chat delegation and lets the canonical operation refuse current grants', async () => {
    const owner = { userId: 'user', chatId: 'chat', organizationId: 'org' }
    await resolveInvocationWorkspace(owner, 'target')
    expect(mocks.target).toHaveBeenCalledWith({
      input: { chatId: 'chat', workspaceId: 'target' },
      principal: expect.objectContaining({
        kind: 'organization_delegated',
        subjectUserId: 'user',
        organizationId: 'org',
        audience: 'sim:workspaces',
        resourceScope: { chatId: 'chat' },
      }),
    })
    mocks.target.mockRejectedValue(new Error('Current permission denied'))
    await expect(resolveInvocationWorkspace(owner, 'target')).rejects.toThrow(
      'Current permission denied'
    )
  })
})
