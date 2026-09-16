/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  organization: {
    organization: { id: 'org-1' },
    viewer: { isAdmin: true },
    searchAccess: { memberScoped: true, sourceMirrored: false },
  },
  workspace: {
    workspace: { id: 'workspace-1' },
    ownerBilling: {},
    features: { knowledgeMemberAccess: true, knowledgeSourceMirroredAccess: true },
  },
}))
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOptionalOrganizationContext: () => mocks.organization,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => mocks.workspace,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useOptionalWorkspacePermissionsContext: () => ({ userPermissions: { canAdmin: true } }),
}))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-entitlements', () => ({
  hasWorkspaceMaxConnectorAccess: () => true,
}))

import { useConnectorScope } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope'

beforeEach(() => {
  mocks.organization.viewer.isAdmin = true
})

describe('connector resource authority', () => {
  it('reads the organization role and flags independently of workspace authority', () => {
    expect(useConnectorScope({ kind: 'organization', organizationId: 'org-1' })).toMatchObject({
      canAdmin: true,
      memberAccessAvailable: true,
      mirroredAccessAvailable: false,
    })
  })
  it('does not grant an organization member the surrounding workspace admin role', () => {
    mocks.organization.viewer.isAdmin = false
    expect(useConnectorScope({ kind: 'organization', organizationId: 'org-1' }).canAdmin).toBe(
      false
    )
  })
  it.each([
    { kind: 'organization' as const, organizationId: 'other-org' },
    { kind: 'workspace' as const, workspaceId: 'other-workspace' },
  ])('refuses UI permissions from a different resource owner', (scope) => {
    expect(useConnectorScope(scope)).toMatchObject({
      canAdmin: false,
      memberAccessAvailable: false,
      mirroredAccessAvailable: false,
    })
  })
  it('preserves the routed workspace capabilities', () => {
    expect(useConnectorScope()).toMatchObject({
      scope: { kind: 'workspace', workspaceId: 'workspace-1' },
      canAdmin: true,
      memberAccessAvailable: true,
      mirroredAccessAvailable: true,
      hasMaxAccess: true,
    })
  })
})
