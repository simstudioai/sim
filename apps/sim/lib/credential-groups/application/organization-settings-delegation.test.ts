import type { OrganizationDelegatedPrincipal, Principal } from '@sim/auth/principal'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { organizationAccountAccessOperations } from '@/lib/credential-groups/application/organization-access'
import { updateOrganizationAccountIndexingOperation } from '@/lib/credential-groups/application/organization-account-indexing'
import { organizationAccountManagementOperations } from '@/lib/credential-groups/application/organization-account-management'
import { organizationAccountOperations } from '@/lib/credential-groups/application/organization-accounts'

const operations = [
  ...Object.values(organizationAccountOperations),
  ...Object.values(organizationAccountAccessOperations),
  ...Object.values(organizationAccountManagementOperations),
  updateOrganizationAccountIndexingOperation,
]
const principal: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  organizationId: 'org',
  subjectUserId: 'actor',
  delegationId: 'tool-call',
  audience: 'sim:settings',
  issuedAt: new Date('2020-01-01'),
  expiresAt: new Date('2099-01-01'),
  resourceScope: { chatId: 'chat' },
}

describe('connected account settings delegation', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it.each(operations)('reauthorizes current organization role for $id', async (operation) => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    await expect(
      authorizeOrganizationOperation(principal, operation, { organizationId: 'org' })
    ).resolves.toMatchObject({ userId: 'actor', role: 'admin' })
    queueTableRows(schemaMock.member, [])
    await expect(
      authorizeOrganizationOperation(principal, operation, { organizationId: 'org' })
    ).rejects.toThrow('Organization not found')
    if (operation.minimumRole === 'admin') {
      queueTableRows(schemaMock.member, [{ role: 'member' }])
      await expect(
        authorizeOrganizationOperation(principal, operation, { organizationId: 'org' })
      ).rejects.toThrow('administrator')
    }
  })

  it.each<Principal>([
    { ...principal, organizationId: 'other' },
    { ...principal, audience: 'sim:search' },
    { ...principal, expiresAt: new Date(0) },
    {
      ...principal,
      serviceId: 'slack-search',
      resourceScope: { installationId: 'i', eventId: 'e' },
    },
    createPersonalApiKeyPrincipal({ userId: 'actor', keyId: 'key' }),
    createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }),
  ])('rejects other identity and delegation boundaries before data access: %j', async (caller) => {
    for (const operation of operations)
      await expect(
        authorizeOrganizationOperation(caller, operation, { organizationId: 'org' })
      ).rejects.toThrow()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
