import { credential, credentialGroup, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resourceScopeCondition,
  sameResourceScopeCondition,
} from '@/lib/core/resource-scope.server'

vi.mock('@/lib/credential-groups/providers', () => ({
  getCredentialGroupProviderId: vi.fn(),
  isCredentialGroupProvider: vi.fn(),
}))

import { getOwnOrganizationManagedOAuthCredentials } from '@/lib/credentials/organization-managed'

const live = {
  id: 'managed-1',
  displayName: 'My Jira',
  providerId: 'jira',
  grantedScopes: ['read:jira-work'],
  managedOauthStatus: 'active',
  enrollmentStatus: 'completed',
  groupStatus: 'active',
  optionId: 'option-1',
  options: [{ id: 'option-1', status: 'active' }],
}

beforeEach(() => {
  resetDbChainMock()
})

describe('own organization managed browsing credentials', () => {
  it('binds both the credential creator and verified enrollee to the acting person in the same organization', async () => {
    queueTableRows(credential, [live])
    await expect(
      getOwnOrganizationManagedOAuthCredentials({
        organizationId: 'org-1',
        userId: 'user-1',
        providerId: 'jira',
      })
    ).resolves.toEqual([
      { id: 'managed-1', displayName: 'My Jira', providerId: 'jira', scopes: ['read:jira-work'] },
    ])
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      and(
        resourceScopeCondition(credential, { kind: 'organization', organizationId: 'org-1' }),
        sameResourceScopeCondition(credential, credentialGroup),
        eq(credential.type, 'managed_oauth'),
        eq(credential.createdBy, 'user-1'),
        eq(user.id, 'user-1'),
        eq(user.emailVerified, true),
        eq(credential.providerId, 'jira'),
        undefined
      )
    )
    expect(dbChainMockFns.select.mock.calls[0]?.[0]).not.toHaveProperty('encryptedAccessToken')
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1000)
  })

  it.each([
    ['revoked credential', { managedOauthStatus: 'revoked' }],
    ['revoked enrollment', { enrollmentStatus: 'revoked' }],
    ['disabled group', { groupStatus: 'disabled' }],
    ['disabled option', { options: [{ id: 'option-1', status: 'disabled' }] }],
    ['missing provider', { providerId: null }],
  ])('omits a %s', async (_name, override) => {
    queueTableRows(credential, [{ ...live, ...override }])
    await expect(
      getOwnOrganizationManagedOAuthCredentials({ organizationId: 'org-1', userId: 'user-1' })
    ).resolves.toEqual([])
  })

  it('supports a connected account while other enrollment options remain unfinished', async () => {
    queueTableRows(credential, [{ ...live, enrollmentStatus: 'in_progress' }])
    expect(
      await getOwnOrganizationManagedOAuthCredentials({ organizationId: 'org-1', userId: 'user-1' })
    ).toHaveLength(1)
  })

  it('rechecks a single credential with an exact ID and bounded result', async () => {
    queueTableRows(credential, [live])
    await getOwnOrganizationManagedOAuthCredentials({
      organizationId: 'org-1',
      userId: 'user-1',
      credentialId: 'managed-1',
    })
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      and(
        resourceScopeCondition(credential, { kind: 'organization', organizationId: 'org-1' }),
        sameResourceScopeCondition(credential, credentialGroup),
        eq(credential.type, 'managed_oauth'),
        eq(credential.createdBy, 'user-1'),
        eq(user.id, 'user-1'),
        eq(user.emailVerified, true),
        undefined,
        eq(credential.id, 'managed-1')
      )
    )
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
  })
})
