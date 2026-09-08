/** @vitest-environment node */
import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  available: vi.fn(),
  group: vi.fn(),
  setup: vi.fn(),
  list: vi.fn(),
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorize,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: mocks.group,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.available,
}))
vi.mock('@/lib/credential-groups/organization-setup', () => ({
  requireOrganizationAccountsSetup: mocks.setup,
}))
vi.mock('@/lib/credential-groups/provider-availability', () => ({
  listConfiguredCredentialGroupProviders: vi.fn(),
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: vi.fn(),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: vi.fn(),
}))
vi.mock('@/lib/credential-groups/service', () => ({
  ensureWorkspaceAccountsGroup: vi.fn(),
  getOrganizationAccountsGroup: vi.fn(),
  updateCredentialGroup: vi.fn(),
}))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  CredentialGroupEnrollmentError: class extends Error {},
  listCredentialGroupEnrollments: mocks.list,
  inviteCredentialGroupEnrollments: vi.fn(),
  loadCredentialGroupInviterIdentity: vi.fn(),
  resendCredentialGroupEnrollment: vi.fn(),
  revokeCredentialGroupEnrollment: vi.fn(),
}))
vi.mock('@/lib/credential-groups/managed-mcp-service', () => ({
  ManagedMcpConnectorError: class extends Error {},
  createManagedMcpConnector: vi.fn(),
  deleteManagedMcpConnector: vi.fn(),
}))
vi.mock('@/lib/credential-groups/mcp-oauth-state', () => ({
  clearCredentialGroupMcpOAuthAttempts: vi.fn(),
}))
vi.mock('@/lib/mcp/connection-pool', () => ({ evictMcpServerConnections: vi.fn() }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  listOrganizationAccountPeople,
  organizationAccountManagementOperations,
} from '@/lib/credential-groups/application/organization-account-management'

const principal: SessionPrincipal = { kind: 'session', userId: 'admin-1', sessionId: 'session-1' }
const input = { organizationId: 'org-1', limit: 50, cursor: 'cursor-1', search: 'example' }

describe('organization account people search application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ organizationId: 'org-1', userId: 'admin-1', role: 'admin' })
    mocks.available.mockResolvedValue(true)
    mocks.group.mockResolvedValue({ credentialGroupId: 'group-1' })
    mocks.setup.mockResolvedValue(undefined)
    mocks.list.mockResolvedValue({ enrollments: [], nextCursor: null })
  })

  it('keeps the existing session-only admin operation and forwards search after authorization', async () => {
    const result = await listOrganizationAccountPeople.execute({ principal, input })
    expect(organizationAccountManagementOperations.people).toMatchObject({
      minimumRole: 'admin',
      principalKinds: ['session'],
      capability: 'integrations.manage',
    })
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(
      principal,
      organizationAccountManagementOperations.people,
      input
    )
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(
      { kind: 'organization', organizationId: 'org-1' },
      'group-1',
      50,
      'cursor-1',
      { email: undefined, search: 'example' }
    )
    expect(result).toEqual({ enrollments: [], nextCursor: null })
  })

  it('preserves exact email filtering when search is omitted', async () => {
    await listOrganizationAccountPeople.execute({
      principal,
      input: { organizationId: 'org-1', limit: 20, email: 'person@example.com' },
    })
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(
      { kind: 'organization', organizationId: 'org-1' },
      'group-1',
      20,
      undefined,
      { email: 'person@example.com', search: undefined }
    )
  })

  it('does not query people or source accounts after current authorization is refused', async () => {
    mocks.authorize.mockRejectedValue(new OrchestrationError('forbidden', 'Admin access required'))
    await expect(listOrganizationAccountPeople.execute({ principal, input })).rejects.toMatchObject(
      {
        code: 'forbidden',
      }
    )
    expect(mocks.group).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('keeps feature availability and account-pool setup gates ahead of search', async () => {
    mocks.setup.mockRejectedValue(new OrchestrationError('conflict', 'Account setup required'))
    await expect(listOrganizationAccountPeople.execute({ principal, input })).rejects.toMatchObject(
      {
        code: 'conflict',
      }
    )
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
