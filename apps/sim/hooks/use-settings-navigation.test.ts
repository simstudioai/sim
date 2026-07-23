/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'

/**
 * `@/lib/auth/auth-client` builds a Better Auth client at module scope, which
 * throws when NEXT_PUBLIC_APP_URL is absent from the environment (and under
 * `isolate: false` an earlier file may have imported the graph in a polluted
 * env). This test only exercises the pure `resolveSettingsHref`, so stub the
 * client module out entirely.
 */
vi.mock('@/lib/auth/auth-client', () => ({
  useSession: vi.fn(() => ({ data: null, isPending: false })),
}))

import { resolveSettingsHref } from '@/hooks/use-settings-navigation'

const HOST_CONTEXT: WorkspaceHostContext = {
  workspace: {
    id: 'workspace-b',
    name: 'Workspace B',
    workspaceMode: 'organization',
    billedAccountUserId: 'owner-b',
  },
  hostOrganizationId: 'org-b',
  ownerBilling: {
    plan: 'team_25000',
    status: 'active',
    isPaid: true,
    isPro: false,
    isTeam: true,
    isEnterprise: false,
    isOrgScoped: true,
    organizationId: 'org-b',
    billingInterval: 'month',
    billingBlocked: false,
    billingBlockedReason: null,
  },
  viewer: {
    permission: 'admin',
    isHostOrganizationMember: false,
    isHostOrganizationAdmin: false,
  },
}

describe('resolveSettingsHref unified settings navigation', () => {
  it('preserves MCP server query parameters for workspace settings', () => {
    expect(
      resolveSettingsHref({
        options: { section: 'mcp', mcpServerId: 'server/a' },
        workspaceId: 'workspace-b',
      })
    ).toBe('/workspace/workspace-b/settings/mcp?mcpServerId=server%2Fa')
  })

  it('sends external workspace admins to the workspace contact-admin upgrade state', () => {
    expect(
      resolveSettingsHref({
        options: { section: 'billing' },
        workspaceId: 'workspace-b',
        hostContext: HOST_CONTEXT,
        viewerUserId: 'external-a',
      })
    ).toBe('/workspace/workspace-b/upgrade')
  })

  it('keeps host organization admins in the unified workspace settings shell', () => {
    expect(
      resolveSettingsHref({
        options: { section: 'billing' },
        workspaceId: 'workspace-b',
        hostContext: {
          ...HOST_CONTEXT,
          viewer: {
            ...HOST_CONTEXT.viewer,
            isHostOrganizationMember: true,
            isHostOrganizationAdmin: true,
          },
        },
        viewerUserId: 'admin-b',
      })
    ).toBe('/workspace/workspace-b/settings/billing')
  })

  it('keeps the billed owner of a personal workspace in the unified settings shell', () => {
    expect(
      resolveSettingsHref({
        options: { section: 'billing' },
        workspaceId: 'workspace-b',
        hostContext: {
          ...HOST_CONTEXT,
          workspace: {
            ...HOST_CONTEXT.workspace,
            workspaceMode: 'personal',
          },
          hostOrganizationId: null,
          ownerBilling: {
            ...HOST_CONTEXT.ownerBilling,
            isOrgScoped: false,
            organizationId: null,
          },
        },
        viewerUserId: 'owner-b',
      })
    ).toBe('/workspace/workspace-b/settings/billing')
  })
})
