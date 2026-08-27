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

import { resolveSettingsHref, resolveSettingsReturnUrl } from '@/hooks/use-settings-navigation'

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

describe('resolveSettingsReturnUrl', () => {
  const fallback = '/workspace/workspace-b'

  it('returns the stored url when it belongs to the current workspace', () => {
    expect(
      resolveSettingsReturnUrl({
        storedUrl: '/workspace/workspace-b/w/workflow-a',
        workspaceId: 'workspace-b',
        fallback,
      })
    ).toBe('/workspace/workspace-b/w/workflow-a')
  })

  it('discards a stored url captured in a workspace the user has since left', () => {
    expect(
      resolveSettingsReturnUrl({
        storedUrl: '/workspace/workspace-a/w/workflow-a',
        workspaceId: 'workspace-b',
        fallback,
      })
    ).toBe(fallback)
  })

  it('keeps workspace-agnostic stored urls', () => {
    expect(
      resolveSettingsReturnUrl({
        storedUrl: '/account/settings/billing',
        workspaceId: 'workspace-b',
        fallback,
      })
    ).toBe('/account/settings/billing')
  })

  it('falls back when nothing was stored', () => {
    expect(
      resolveSettingsReturnUrl({ storedUrl: null, workspaceId: 'workspace-b', fallback })
    ).toBe(fallback)
  })
})
