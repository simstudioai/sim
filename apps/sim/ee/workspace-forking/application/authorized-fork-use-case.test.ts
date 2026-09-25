import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  workspace: vi.fn(),
  execute: vi.fn(),
  capability: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 }
    return rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
  },
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/permission-groups/capability-assertions', () => ({
  assertWorkspaceCapability: mocks.capability,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ getWorkspaceWithOwner: mocks.workspace }))
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({ assertForkingEnabled: vi.fn() }))
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => ({ resolveForkEdge: vi.fn() }))

import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { defineForkUseCase } from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

const operation = defineForkUseCase({
  operation: forkOperations.sync,
  bothSides: true,
  async execute({
    context,
    input: _input,
  }: {
    context: import('@/ee/workspace-forking/application/authorized-fork-use-case').ForkApplicationContext
    input: { workspaceId: string; otherWorkspaceId: string }
  }) {
    mocks.execute(context)
    return context
  },
})
function principal(mark = true) {
  const value = createCopilotChatPrincipal(
    { userId: 'actor', workspaceId: 'source', chatId: 'chat' },
    'sim:workspaces'
  )
  if (mark) markCopilotWorkspaceInvocation(value)
  return value
}
function run(value = principal(), otherWorkspaceId = 'target') {
  return withWorkspaceInvocationScope({ workspaceId: 'source', organizationId: 'org' }, () =>
    operation.execute({ principal: value, input: { workspaceId: 'source', otherWorkspaceId } })
  )
}
beforeEach(() => {
  mocks.permission.mockResolvedValue('admin')
  mocks.capability.mockResolvedValue(undefined)
  mocks.workspace.mockImplementation(async (id: string) => ({
    id,
    name: id,
    organizationId: 'org',
    allowPersonalApiKeys: false,
  }))
})
describe('Copilot fork authorization', () => {
  it.each(['source', 'target'])(
    'refuses a missing admin role on %s before execution',
    async (denied) => {
      mocks.permission.mockImplementation(async (_user, workspace) =>
        workspace === denied ? 'write' : 'admin'
      )
      await expect(run()).rejects.toMatchObject({ code: 'forbidden' })
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )
  it('respects disabled Copilot access on the second workspace', async () => {
    mocks.capability.mockRejectedValue(new Error('Copilot is disabled'))
    await expect(run()).rejects.toThrow('Copilot is disabled')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('refuses a second workspace outside the organization', async () => {
    mocks.workspace.mockImplementation(async (id) => ({
      id,
      organizationId: id === 'target' ? 'elsewhere' : 'org',
      allowPersonalApiKeys: false,
    }))
    await expect(run()).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('does not accept an unadmitted delegation or stale serialized copy', async () => {
    await expect(run(principal(false))).rejects.toMatchObject({ code: 'forbidden' })
    await expect(run({ ...principal() })).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
