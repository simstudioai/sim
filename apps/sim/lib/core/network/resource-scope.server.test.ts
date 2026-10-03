import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/network/config.server', () => networkConfigMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

import {
  resolveCurrentOutboundRoute,
  runWithOutboundOrganization,
} from '@/lib/core/network/context.server'
import { withResourceOutboundScope } from '@/lib/core/network/resource-scope.server'

const mocks = {
  enabled: networkConfigMockFns.mockIsOutboundRoutingEnabled,
  route: networkConfigMockFns.mockResolveOutboundRoute,
  workspace: workspaceContextMockFns.mockLoadWorkspaceApplicationContext,
}

mocks.route.mockImplementation(async (organizationId) => ({ organizationId }))

describe('canonical resource outbound scope', () => {
  beforeEach(() => {
    mocks.enabled.mockReturnValue(true)
  })

  it.each(['publisher-org', null])(
    'uses current workspace ownership %s and restores its caller',
    async (organizationId) => {
      mocks.workspace.mockResolvedValue({ workspaceOrganizationId: organizationId })
      await runWithOutboundOrganization('caller-org', async () => {
        expect(
          await withResourceOutboundScope(
            { workspaceId: 'source-workspace' },
            resolveCurrentOutboundRoute
          )
        ).toEqual({ organizationId })
        expect(await resolveCurrentOutboundRoute()).toEqual({ organizationId: 'caller-org' })
      })
      expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith('source-workspace', {})
    }
  )

  it('rejects a missing or archived workspace before executing provider work', async () => {
    mocks.workspace.mockResolvedValue(null)
    await expect(
      withResourceOutboundScope({ workspaceId: 'removed' }, resolveCurrentOutboundRoute)
    ).rejects.toMatchObject({ code: 'MISSING_SCOPE' })
    expect(mocks.route).not.toHaveBeenCalled()
  })

  it('uses canonical archived workspace ownership only when cleanup explicitly requests it', async () => {
    mocks.workspace.mockImplementation(async (_id, options) =>
      options.includeArchived ? { workspaceOrganizationId: 'owner-org' } : null
    )
    await expect(
      withResourceOutboundScope({ workspaceId: 'archived' }, resolveCurrentOutboundRoute)
    ).rejects.toMatchObject({ code: 'MISSING_SCOPE' })
    await expect(
      withResourceOutboundScope({ workspaceId: 'archived' }, resolveCurrentOutboundRoute, {
        includeArchived: true,
      })
    ).resolves.toEqual({ organizationId: 'owner-org' })
  })

  it('uses organization ownership without loading a workspace or retaining caller scope', async () => {
    await runWithOutboundOrganization('caller-org', async () => {
      expect(
        await withResourceOutboundScope(
          { workspaceId: null, organizationId: 'owner-org' },
          resolveCurrentOutboundRoute
        )
      ).toEqual({ organizationId: 'owner-org' })
      expect(await resolveCurrentOutboundRoute()).toEqual({ organizationId: 'caller-org' })
    })
    expect(mocks.workspace).not.toHaveBeenCalled()
  })

  it('adds no workspace query when routing is unconfigured', async () => {
    mocks.enabled.mockReturnValue(false)
    const run = vi.fn(async () => 'done')
    expect(await withResourceOutboundScope({ workspaceId: null }, run)).toBe('done')
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledOnce()
  })

  it('rejects ambiguous or missing ownership when routing is configured', async () => {
    const run = vi.fn(async () => 'done')
    await expect(withResourceOutboundScope({}, run)).rejects.toThrow(
      'Resource requires exactly one workspace or organization owner'
    )
    await expect(
      withResourceOutboundScope({ workspaceId: 'workspace', organizationId: 'org' }, run)
    ).rejects.toThrow('Resource requires exactly one workspace or organization owner')
    expect(run).not.toHaveBeenCalled()
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
})
