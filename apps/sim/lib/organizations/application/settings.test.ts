import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  authorizedWorkspaceUseCaseMock,
  authorizedWorkspaceUseCaseMockFns,
} from '@sim/testing/mocks/authorized-workspace-use-case.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock(
  '@/lib/core/application/authorized-workspace-use-case',
  () => authorizedWorkspaceUseCaseMock
)

import { organizationSettingsOperations } from '@/lib/organizations/application/operations'
import {
  readOrganizationSettings,
  updateOrganizationSettings,
} from '@/lib/organizations/application/settings'

const mocks = {
  audit: authorizedWorkspaceUseCaseMockFns.mockRecordProjectedUseCaseAuditEntries,
  authorize: organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
}

const principal: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'call',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
}
const row = {
  id: 'org',
  name: 'Company',
  slug: 'company',
  logo: null,
  updatedAt: new Date('2026-09-15T00:00:00Z'),
}

describe('organization identity settings', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.authorize.mockResolvedValue({ organizationId: 'org', userId: 'actor', role: 'admin' })
    dbChainMockFns.limit.mockResolvedValue([row])
    dbChainMockFns.returning.mockResolvedValue([row])
  })
  it('authorizes reads against the explicit organization before loading identity', async () => {
    await expect(
      readOrganizationSettings.execute({ principal, input: { organizationId: 'org' } })
    ).resolves.toEqual({ ...row, updatedAt: row.updatedAt.toISOString() })
    expect(mocks.authorize).toHaveBeenCalledWith(principal, organizationSettingsOperations.read, {
      organizationId: 'org',
    })
  })
  it('does not load or mutate when current access has been revoked', async () => {
    mocks.authorize.mockRejectedValue(new Error('revoked'))
    await expect(
      updateOrganizationSettings.execute({
        principal,
        input: { organizationId: 'org', patch: { name: 'New' } },
      })
    ).rejects.toThrow('revoked')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('preserves slug conflicts and does not audit a rejected change', async () => {
    await expect(
      updateOrganizationSettings.execute({
        principal,
        input: { organizationId: 'org', patch: { slug: 'taken' } },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'This slug is already taken' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
