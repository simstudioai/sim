/** @vitest-environment node */
import type {
  OAuthAccessTokenPrincipal,
  OrganizationDelegatedPrincipal,
  SessionPrincipal,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ membership: vi.fn(), config: vi.fn() }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))

import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const principal: SessionPrincipal = { kind: 'session', userId: 'member', sessionId: 'session' }
const operation = defineOrganizationOperation({
  id: 'search.read',
  minimumRole: 'member',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'organization_delegated'],
  oauthScope: 'api:read',
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
const oauth: OAuthAccessTokenPrincipal = {
  kind: 'oauth_access_token',
  userId: 'member',
  tokenId: 'token',
  clientId: 'client',
  scopes: ['api:read'],
  expiresAt: new Date('2099-01-01'),
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
  it('requires consent and current membership for OAuth organization reads', async () => {
    await expect(
      authorizeOrganizationOperation(oauth, operation, { organizationId: 'org' })
    ).resolves.toMatchObject({ userId: 'member', role: 'member' })
    mocks.membership.mockResolvedValue([])
    await expect(
      authorizeOrganizationOperation(oauth, operation, { organizationId: 'org' })
    ).rejects.toThrow('Organization not found')
  })
  it.each([{ scopes: [] }, { expiresAt: new Date('2020-01-01') }])(
    'refuses insufficient or expired OAuth grants before membership lookup',
    async (override) => {
      await expect(
        authorizeOrganizationOperation({ ...oauth, ...override }, operation, {
          organizationId: 'org',
        })
      ).rejects.toThrow()
      expect(mocks.membership).not.toHaveBeenCalled()
    }
  )
  it('applies the organization personal-key policy to OAuth clients too', async () => {
    mocks.config.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })
    await expect(
      authorizeOrganizationOperation(oauth, operation, { organizationId: 'org' })
    ).rejects.toThrow()
  })
  it('applies the CLI restriction to CLI tokens without refusing unrelated OAuth clients', async () => {
    mocks.config.mockResolvedValue({ ...DEFAULT_PERMISSION_GROUP_CONFIG, disableCliAccess: true })
    await expect(
      authorizeOrganizationOperation({ ...oauth, clientId: SIM_CLI_CLIENT_ID }, operation, {
        organizationId: 'org',
      })
    ).rejects.toThrow()
    await expect(
      authorizeOrganizationOperation(oauth, operation, { organizationId: 'org' })
    ).resolves.toMatchObject({ userId: 'member' })
  })
  it.each(['client', SIM_CLI_CLIENT_ID])(
    'rechecks OAuth app access for existing %s grants on organization reads',
    async (clientId) => {
      await expect(
        authorizeOrganizationOperation({ ...oauth, clientId }, operation, { organizationId: 'org' })
      ).resolves.toMatchObject({ userId: 'member' })
      mocks.config.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        disableOAuthAppAccess: true,
      })
      await expect(
        authorizeOrganizationOperation({ ...oauth, clientId }, operation, { organizationId: 'org' })
      ).rejects.toThrow('OAuth app access')
    }
  )
  it.each([
    principal,
    { kind: 'personal_api_key' as const, userId: 'member', keyId: 'key' },
    delegated,
  ])('keeps $kind access independent of the OAuth app restriction', async (caller) => {
    mocks.config.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableOAuthAppAccess: true,
    })
    await expect(
      authorizeOrganizationOperation(caller, operation, { organizationId: 'org' })
    ).resolves.toMatchObject({ userId: 'member' })
  })
  it('does not let read-only OAuth consent perform an administrator write', async () => {
    mocks.membership.mockResolvedValue([{ role: 'admin' }])
    const write = defineOrganizationOperation({
      ...operation,
      oauthScope: 'api:write',
      minimumRole: 'admin',
    })
    await expect(
      authorizeOrganizationOperation(oauth, write, { organizationId: 'org' })
    ).rejects.toThrow('api:write')
    expect(mocks.membership).not.toHaveBeenCalled()
  })
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
