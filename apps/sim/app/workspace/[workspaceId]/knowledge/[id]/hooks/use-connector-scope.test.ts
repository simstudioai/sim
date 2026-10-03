import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import {
  organizationProviderMock,
  organizationProviderMockFns,
} from '@sim/testing/mocks/organization-provider.mock'
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
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
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

nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })
organizationProviderMockFns.mockUseOptionalOrganizationContext.mockImplementation(
  () => mocks.organization
)

beforeEach(() => {
  mocks.organization.viewer.isAdmin = true
})

describe('connector resource authority', () => {
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
})
