import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import {
  customBlockOperationsMock,
  customBlockOperationsMockFns,
} from '@sim/testing/mocks/custom-block-operations.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  createMockWorkspaceApplicationContext,
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsContext } from '@/lib/mothership/application/settings-context'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/workflows/custom-blocks/operations', () => customBlockOperationsMock)

import { customBlockSettingsActions } from '@/lib/mothership/tools/server/settings-custom-blocks'
import {
  deleteCustomBlockSettings,
  publishCustomBlockSettings,
  readCustomBlockUsages,
  updateCustomBlockSettings,
} from '@/lib/workflows/custom-blocks/application/settings'

const mocks = {
  manage: customBlockOperationsMockFns.mockGetCustomBlockManageContext,
  update: customBlockOperationsMockFns.mockUpdateCustomBlock,
  role: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}
customBlockOperationsMockFns.mockIsCustomBlocksDeploymentEnabled.mockReturnValue(true)
workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext.mockImplementation(
  async (workspaceId: string) =>
    createMockWorkspaceApplicationContext({ workspaceId, workspaceOrganizationId: 'org' })
)

const principal = createDelegatedPrincipal({
  subjectUserId: 'actor',
  workspaceId: 'trusted',
  audience: 'sim:settings',
  delegationId: 'call',
})
const context: SettingsContext = {
  scope: 'workspace',
  workspaceId: 'trusted',
  organizationId: 'org',
  principal,
}
const publish = {
  workflowId: 'workflow',
  name: 'Block',
  exposedOutputs: [{ blockId: 'answer', path: 'value', name: 'answer' }],
}

beforeEach(() => {
  mocks.role.mockResolvedValue('admin')
  mocks.manage.mockResolvedValue({
    sourceWorkspaceId: 'trusted',
    organizationId: 'org',
    type: 'custom',
    name: 'Block',
  })
  mocks.update.mockClear()
})

describe('custom block settings adapters', () => {
  it('binds publishing to trusted workspace and preserves private defaults', async () => {
    const run = vi.spyOn(publishCustomBlockSettings, 'execute').mockResolvedValue({} as never)
    await customBlockSettingsActions.publish.execute(context, publish)
    expect(run).toHaveBeenCalledWith({
      principal,
      input: { ...publish, workspaceId: 'trusted', description: '', traceChildRuns: false },
    })
    await expect(async () =>
      customBlockSettingsActions.publish.execute(context, { ...publish, workspaceId: 'foreign' })
    ).rejects.toThrow('Unrecognized')
    await expect(async () =>
      customBlockSettingsActions.publish.execute(context, { ...publish, organizationId: 'foreign' })
    ).rejects.toThrow('Unrecognized')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each(['update', 'delete', 'usages'] as const)(
    'binds %s to trusted workspace without accepting caller authority',
    async (action) => {
      const useCase =
        action === 'update'
          ? updateCustomBlockSettings
          : action === 'delete'
            ? deleteCustomBlockSettings
            : readCustomBlockUsages
      const run = vi.spyOn(useCase, 'execute').mockResolvedValue({} as never)
      const input = { id: 'block', ...(action === 'update' ? { patch: { enabled: false } } : {}) }
      await customBlockSettingsActions[action].execute(context, input)
      expect(run).toHaveBeenCalledWith({ principal, input: { ...input, workspaceId: 'trusted' } })
      await expect(async () =>
        customBlockSettingsActions[action].execute(context, { ...input, workspaceId: 'foreign' })
      ).rejects.toThrow('Unrecognized')
      await expect(async () =>
        customBlockSettingsActions[action].execute(context, { ...input, actorId: 'owner' })
      ).rejects.toThrow('Unrecognized')
      expect(run).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps strict update fields, safe icons and curated outputs', async () => {
    const run = vi.spyOn(updateCustomBlockSettings, 'execute').mockResolvedValue({} as never)
    for (const patch of [
      { workspaceId: 'foreign' },
      { iconUrl: 'data:text/html,unsafe' },
      { exposedOutputs: [] },
      { exposedOutputs: [{ blockId: 'a', path: 'x', name: 'cost' }] },
    ]) {
      await expect(async () =>
        customBlockSettingsActions.update.execute(context, { id: 'block', patch })
      ).rejects.toThrow()
    }
    await customBlockSettingsActions.update.execute(context, {
      id: 'block',
      patch: { iconUrl: null, traceChildRuns: false },
    })
    expect(run).toHaveBeenCalledExactlyOnceWith({
      principal,
      input: {
        id: 'block',
        workspaceId: 'trusted',
        patch: { iconUrl: null, traceChildRuns: false },
      },
    })
  })

  it('does not weaken publish output or icon validation', async () => {
    const run = vi.spyOn(publishCustomBlockSettings, 'execute').mockResolvedValue({} as never)
    for (const input of [
      { ...publish, exposedOutputs: [] },
      { ...publish, iconUrl: 'javascript:alert(1)' },
      { ...publish, exposedOutputs: [{ blockId: 'a', path: 'x', name: 'success' }] },
    ]) {
      await expect(async () =>
        customBlockSettingsActions.publish.execute(context, input)
      ).rejects.toThrow()
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('actually enters source-workspace authorization for mutations', async () => {
    mocks.manage.mockResolvedValue({
      sourceWorkspaceId: 'foreign',
      organizationId: 'org',
      type: 'custom',
      name: 'Block',
    })
    await expect(async () =>
      customBlockSettingsActions.update.execute(context, { id: 'block', patch: { enabled: false } })
    ).rejects.toThrow('another source workspace')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses a missing trusted workspace before calling the application', async () => {
    const run = vi.spyOn(readCustomBlockUsages, 'execute').mockResolvedValue({} as never)
    await expect(async () =>
      customBlockSettingsActions.usages.execute(
        { ...context, workspaceId: undefined },
        { id: 'block' }
      )
    ).rejects.toThrow('Workspace not found')
    expect(run).not.toHaveBeenCalled()
  })
})
