/** @vitest-environment node */
import type { OrganizationDelegatedPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ membership: vi.fn(), config: vi.fn() }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))

import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

const principal: SessionPrincipal = { kind: 'session', userId: 'member', sessionId: 'session' }
const operation = defineOrganizationOperation({
  id: 'search.read',
  minimumRole: 'member',
  principalKinds: ['session', 'personal_api_key', 'organization_delegated'],
  delegationAudience: 'sim:knowledge',
  capability: 'knowledge.use',
})
const delegated: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  organizationId: 'org',
  subjectUserId: 'member',
  serviceId: 'copilot',
  delegationId: 'delegation',
  audience: 'sim:knowledge',
  issuedAt: new Date('2020-01-01'),
  expiresAt: new Date('2099-01-01'),
  resourceScope: { chatId: 'chat' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.membership.mockResolvedValue([{ role: 'member' }])
  mocks.config.mockResolvedValue(null)
  const query = { from: vi.fn(), where: vi.fn(), limit: mocks.membership }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  vi.mocked(db.select).mockReturnValue(query as ReturnType<typeof db.select>)
})

describe('organization operation authorization', () => {
  it('allows a current organization member without a workspace lookup', async () => {
    await expect(
      authorizeOrganizationOperation(principal, operation, { organizationId: 'org' })
    ).resolves.toMatchObject({ userId: 'member', role: 'member' })
    expect(mocks.membership).toHaveBeenCalledOnce()
  })
  it('denies a removed member before reading organization capability settings', async () => {
    mocks.membership.mockResolvedValue([])
    await expect(
      authorizeOrganizationOperation(principal, operation, { organizationId: 'org' })
    ).rejects.toThrow('Organization not found')
    expect(mocks.config).not.toHaveBeenCalled()
  })
  it('requires an administrator for source configuration', async () => {
    const configure = defineOrganizationOperation({
      id: 'source.configure',
      minimumRole: 'admin',
      principalKinds: ['session'],
      capability: 'knowledge.use',
    })
    await expect(
      authorizeOrganizationOperation(principal, configure, { organizationId: 'org' })
    ).rejects.toThrow('administrator')
  })
  it('never accepts a workspace key as organization authority', async () => {
    await expect(
      authorizeOrganizationOperation(
        { kind: 'workspace_api_key', keyId: 'key', workspaceId: 'org' },
        operation,
        { organizationId: 'org' }
      )
    ).rejects.toThrow('Principal kind')
    expect(mocks.membership).not.toHaveBeenCalled()
  })
  it.each([
    { organizationId: 'other' },
    { audience: 'sim:files' },
    { expiresAt: new Date('2020-01-01') },
    { issuedAt: new Date('2099-01-01') },
  ])('rejects invalid delegated scope before loading member grants', async (override) => {
    await expect(
      authorizeOrganizationOperation({ ...delegated, ...override }, operation, {
        organizationId: 'org',
      })
    ).rejects.toThrow('delegation')
    expect(mocks.membership).not.toHaveBeenCalled()
  })
  it('rechecks the original subject on every delegated read', async () => {
    await authorizeOrganizationOperation(delegated, operation, { organizationId: 'org' })
    mocks.membership.mockResolvedValue([])
    await expect(
      authorizeOrganizationOperation(delegated, operation, { organizationId: 'org' })
    ).rejects.toThrow('Organization not found')
  })
})
