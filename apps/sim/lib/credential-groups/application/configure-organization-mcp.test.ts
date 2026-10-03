import * as audit from '@sim/audit'
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  credentialGroupsOrganizationSetupMock,
  credentialGroupsOrganizationSetupMockFns,
} from '@sim/testing/mocks/credential-groups-organization-setup.mock'
import { credentialGroupsSelfEnrollmentMock } from '@sim/testing/mocks/credential-groups-self-enrollment.mock'
import { credentialGroupsServiceMock } from '@sim/testing/mocks/credential-groups-service.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  clear: vi.fn(),
  evict: vi.fn(),
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
vi.mock('@/lib/credential-groups/organization-setup', () => credentialGroupsOrganizationSetupMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)
vi.mock('@/lib/credential-groups/provider-availability', () => ({
  listConfiguredCredentialGroupProviders: vi.fn(),
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => credentialGroupsSelfEnrollmentMock)
vi.mock('@/lib/credential-groups/managed-mcp-service', () => ({
  loadOrganizationDatabricksSetup: hoisted.read,
  createManagedMcpConnector: hoisted.create,
  updateManagedMcpConnector: hoisted.update,
  ManagedMcpConnectorError: class extends Error {
    constructor(
      message: string,
      public code: string
    ) {
      super(message)
    }
  },
}))
vi.mock('@/lib/credential-groups/mcp-oauth-state', () => ({
  clearCredentialGroupMcpOAuthAttempts: hoisted.clear,
}))
vi.mock('@/lib/mcp/connection-pool', () => ({ evictMcpServerConnections: hoisted.evict }))

import { configureOrganizationMcp } from '@/lib/credential-groups/application/configure-organization-mcp'
import { addOrganizationAccountMcpProvider } from '@/lib/credential-groups/application/organization-account-management'
import { getOrganizationDatabricksSetup } from '@/lib/credential-groups/application/organization-databricks-setup'
import { ManagedMcpConnectorError } from '@/lib/credential-groups/managed-mcp-service'

const mocks = {
  ...hoisted,
  available: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
  group: credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext,
  setup: credentialGroupsOrganizationSetupMockFns.mockRequireOrganizationAccountsSetup,
}

const principal = createSessionPrincipal({ userId: 'admin-user' })
const input = {
  organizationId: 'customer-org',
  connectorId: 'databricks' as const,
  name: 'Databricks',
  url: 'https://tenant.cloud.databricks.com/api/2.0/mcp/sql',
  oauthClientId: 'registered-client',
}
const server = {
  id: 'server-new',
  name: 'Databricks',
  url: input.url,
  oauthClientId: input.oauthClientId,
  hasOauthClientSecret: true,
  enabled: true,
}

describe('organization Databricks setup', () => {
  beforeEach(() => {
    vi.spyOn(audit, 'recordAudit').mockImplementation(() => {})
    resetDbChainMock()
    mocks.available.mockResolvedValue(true)
    mocks.group.mockResolvedValue({ credentialGroupId: 'customer-group' })
    mocks.setup.mockResolvedValue(undefined)
    mocks.read.mockResolvedValue(server)
    mocks.create.mockResolvedValue({
      mcpServer: { id: 'server-new', name: 'Databricks', enabled: true },
      resetMcpServerIds: [],
      retiredMcpConnectionIds: [],
    })
    mocks.update.mockResolvedValue({
      mcpServer: { id: 'server-new', name: 'Databricks' },
      resetMcpServerIds: ['server-old'],
      retiredMcpConnectionIds: ['mcp-cg-old'],
    })
  })

  describe.each([
    ['read', getOrganizationDatabricksSetup],
    ['configure', configureOrganizationMcp],
    ['add', addOrganizationAccountMcpProvider],
  ] as const)('%s authorization', (_name, useCase) => {
    it.each(['member', null])('refuses a %s before reading configuration', async (role) => {
      queueTableRows(schemaMock.member, role ? [{ role }] : [])
      await expect(useCase.execute({ principal, input })).rejects.toThrow()
      expect(mocks.group).not.toHaveBeenCalled()
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it.each(['admin', 'owner'])(
      'allows an organization %s using the routed organization',
      async (role) => {
        queueTableRows(schemaMock.member, [{ role }])
        await useCase.execute({ principal, input })
        expect(eq).toHaveBeenCalledWith(schemaMock.member.userId, 'admin-user')
        expect(eq).toHaveBeenCalledWith(schemaMock.member.organizationId, 'customer-org')
        expect(mocks.group).toHaveBeenCalledWith({
          kind: 'organization',
          organizationId: 'customer-org',
        })
      }
    )

    it('refuses setup when the feature is unavailable', async () => {
      queueTableRows(schemaMock.member, [{ role: 'admin' }])
      mocks.available.mockResolvedValue(false)
      await expect(useCase.execute({ principal, input })).rejects.toMatchObject({
        code: 'not_found',
      })
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it('requires the organization connected accounts group', async () => {
      queueTableRows(schemaMock.member, [{ role: 'admin' }])
      mocks.group.mockResolvedValue(null)
      await expect(useCase.execute({ principal, input })).rejects.toMatchObject({
        code: 'not_found',
      })
      expect(mocks.read).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
    })
  })

  it('loads setup metadata for the organization without returning a client secret', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    const result = await getOrganizationDatabricksSetup.execute({ principal, input })
    expect(mocks.read).toHaveBeenCalledWith('customer-org', 'customer-group')
    expect(result).toEqual({ server })
    expect(result.server).not.toHaveProperty('oauthClientSecret')
  })

  it('updates only the organization provider and invalidates affected connections', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    await configureOrganizationMcp.execute({ principal, input })
    expect(mocks.update).toHaveBeenCalledWith({
      organizationId: 'customer-org',
      credentialGroupId: 'customer-group',
      connectorId: 'databricks',
      input: {
        url: input.url,
        oauthClientId: input.oauthClientId,
        oauthClientSecret: undefined,
        name: 'Databricks',
      },
    })
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-user',
        resourceId: 'customer-group',
        metadata: {
          organizationId: 'customer-org',
          actor: { kind: 'session', userId: 'admin-user' },
          operation: 'organization_accounts.mcp.configure',
        },
      })
    )
    expect(mocks.clear).toHaveBeenCalledWith(['server-old'])
    expect(mocks.evict).toHaveBeenCalledWith('server-old', expect.any(String))
    expect(mocks.evict).toHaveBeenCalledWith('mcp-cg-old', expect.any(String))
  })

  it('surfaces configuration failures without auditing success or evicting connections', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.update.mockRejectedValue(
      new ManagedMcpConnectorError('Databricks has not been added', 'not_found')
    )
    await expect(configureOrganizationMcp.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(audit.recordAudit).not.toHaveBeenCalled()
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(mocks.evict).not.toHaveBeenCalled()
  })

  it('creates the fully configured provider with canonical organization scope in one mutation', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    const result = await addOrganizationAccountMcpProvider.execute({ principal, input })
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'customer-org',
      credentialGroupId: 'customer-group',
      userId: 'admin-user',
      input: {
        connectorId: 'databricks',
        name: 'Databricks',
        url: input.url,
        oauthClientId: input.oauthClientId,
      },
    })
    expect(result.mcpServer.enabled).toBe(true)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-user',
        resourceId: 'customer-group',
        metadata: {
          organizationId: 'customer-org',
          actor: { kind: 'session', userId: 'admin-user' },
          operation: 'organization_accounts.mcp.add',
        },
      })
    )
  })

  it('rejects invalid Databricks creation without auditing success or trying a second mutation', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.create.mockRejectedValue(new ManagedMcpConnectorError('Invalid MCP URL', 'validation'))
    await expect(
      addOrganizationAccountMcpProvider.execute({ principal, input })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Invalid MCP URL',
    })
    expect(audit.recordAudit).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
