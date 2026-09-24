/** @vitest-environment node */
import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), audit: vi.fn() }))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorize,
}))
vi.mock('@/lib/core/application/authorized-workspace-use-case', () => ({
  recordProjectedUseCaseAuditEntries: mocks.audit,
}))

import { organizationSettingsOperations } from '@/lib/organizations/application/operations'
import {
  readOrganizationSettings,
  updateOrganizationSettings,
} from '@/lib/organizations/application/settings'

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
    vi.clearAllMocks()
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
  it('rejects empty patches before mutation', async () => {
    await expect(
      updateOrganizationSettings.execute({ principal, input: { organizationId: 'org', patch: {} } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
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
  it('projects the authoritative changed identity and acting principal into audit', async () => {
    const result = await updateOrganizationSettings.execute({
      principal,
      input: { organizationId: 'org', patch: { name: ' Company ', logo: null } },
    })
    expect(result).toEqual({ ...row, updatedAt: row.updatedAt.toISOString() })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Company', logo: null })
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      organizationSettingsOperations.update,
      null,
      principal,
      undefined,
      expect.arrayContaining([
        expect.objectContaining({ resourceId: 'org', resourceName: 'Company' }),
      ]),
      'org'
    )
  })
})
