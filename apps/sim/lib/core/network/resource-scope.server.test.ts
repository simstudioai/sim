/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  workspace: vi.fn(),
  route: vi.fn(async (organizationId: string | null | undefined) => ({ organizationId })),
}))
vi.mock('@/lib/core/network/config.server', () => ({
  isOutboundRoutingEnabled: mocks.enabled,
  resolveOutboundRoute: mocks.route,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.workspace,
}))

import {
  resolveCurrentOutboundRoute,
  runWithOutboundOrganization,
} from '@/lib/core/network/context.server'
import { withResourceOutboundScope } from '@/lib/core/network/resource-scope.server'

describe('canonical resource outbound scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith('source-workspace')
    }
  )

  it('rejects a missing or archived workspace before executing provider work', async () => {
    mocks.workspace.mockResolvedValue(null)
    await expect(
      withResourceOutboundScope({ workspaceId: 'removed' }, resolveCurrentOutboundRoute)
    ).rejects.toMatchObject({ code: 'MISSING_SCOPE' })
    expect(mocks.route).not.toHaveBeenCalled()
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
