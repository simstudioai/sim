/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBlockVisibility: vi.fn(),
  getAllowedIntegrationsFromEnv: vi.fn(),
  getUserPermissionConfig: vi.fn(),
  createVisibility: vi.fn(),
  getAllOAuthServices: vi.fn(),
  getServiceConfigByServiceId: vi.fn(),
}))

vi.mock('@/lib/core/config/block-visibility', () => ({
  getBlockVisibility: mocks.getBlockVisibility,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  getAllowedIntegrationsFromEnv: mocks.getAllowedIntegrationsFromEnv,
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
}))

/**
 * The real helpers canonicalize each side through the generated successor map;
 * this stub keeps the intersection semantics without the map, because the ids
 * used here are fixtures rather than real block types.
 */
vi.mock('@/lib/permission-groups/integration-allowlist', () => {
  const intersect = (
    permissionGroup: readonly string[] | null,
    deployment: readonly string[] | null
  ) => {
    if (!permissionGroup) return deployment
    if (!deployment) return permissionGroup
    return permissionGroup.filter((type) => deployment.includes(type))
  }
  return {
    intersectIntegrationAllowlists: intersect,
    intersectAccessControlAllowlists: (
      permissionGroup: readonly string[] | null,
      deployment: readonly string[] | null
    ) => {
      const result = intersect(permissionGroup, deployment)
      return result === null ? null : new Set(result)
    },
    resolveAccessControlBlockType: (blockType: string) => blockType,
    toAccessControlAllowlist: (allowlist: readonly string[] | null) =>
      allowlist ? new Set(allowlist) : null,
  }
})

vi.mock('@/lib/integrations/credential-visibility.server', () => ({
  createIntegrationCredentialVisibility: mocks.createVisibility,
}))

vi.mock('@/lib/oauth/utils', () => ({
  getAllOAuthServices: mocks.getAllOAuthServices,
  getServiceConfigByServiceId: mocks.getServiceConfigByServiceId,
}))

import {
  listCredentialProviderCatalog,
  requireAvailableServiceAccountCredentialProvider,
  type ServiceAccountCredentialProviderCatalogEntry,
} from '@/lib/credentials/application/provider-catalog'

const personalPrincipal = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'key-1',
}
const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
}
const services = [
  {
    serviceId: 'salesforce',
    providerId: 'salesforce',
    additionalProviderIds: ['salesforce-sandbox'],
    name: 'Salesforce',
    description: 'Connect Salesforce.',
    baseProvider: 'salesforce',
    authType: 'oauth' as const,
  },
  {
    serviceId: 'trello',
    providerId: 'trello',
    name: 'Trello',
    description: 'Connect Trello.',
    baseProvider: 'trello',
    authType: 'oauth' as const,
  },
  {
    serviceId: 'claude-platform',
    providerId: 'claude-platform-service-account',
    serviceAccountProviderId: 'claude-platform-service-account',
    name: 'Claude Platform',
    description: 'Run Claude Platform Managed Agents from your workflows.',
    baseProvider: 'claude-platform',
    authType: 'service_account' as const,
  },
]

describe('listCredentialProviderCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllOAuthServices.mockReturnValue(services)
    /**
     * The permission group is the NARROWER half on purpose. With the deployment
     * allowlist narrower, the intersection is the same set whether or not the
     * group is read at all, and every assertion below passes against a catalog
     * that never consulted it — which is what this fixture used to look like.
     */
    mocks.getAllowedIntegrationsFromEnv.mockReturnValue(['salesforce', 'trello'])
    mocks.getUserPermissionConfig.mockResolvedValue({
      allowedIntegrations: ['salesforce'],
    })
    mocks.getBlockVisibility.mockResolvedValue({
      revealed: new Set(),
      disabled: new Set(),
      previewTagged: new Set(),
    })
    mocks.createVisibility.mockReturnValue({
      isOAuthServiceVisible: (service: { serviceId: string }) => service.serviceId === 'salesforce',
      isCredentialVisible: ({ providerId }: { providerId: string }) =>
        providerId === 'claude-platform-service-account',
    })
    mocks.getServiceConfigByServiceId.mockImplementation((serviceId: string) => {
      if (serviceId === 'salesforce') {
        return {
          providerIdLabels: {
            salesforce: 'Production',
            'salesforce-sandbox': 'Sandbox',
          },
        }
      }
      if (serviceId === 'trello') return {}
      if (serviceId === 'quickbooks') return {}
      return null
    })
  })

  it('projects OAuth services, authorization options, and reconnect capability', async () => {
    const catalog = await listCredentialProviderCatalog(personalPrincipal, context)

    expect(catalog).toEqual([
      {
        type: 'oauth',
        serviceId: 'salesforce',
        name: 'Salesforce',
        description: 'Connect Salesforce.',
        providerFamily: 'salesforce',
        available: true,
        supportsReconnect: true,
        fields: [],
        authorizationOptions: [
          { providerId: 'salesforce', label: 'Production' },
          { providerId: 'salesforce-sandbox', label: 'Sandbox' },
        ],
      },
      {
        type: 'oauth',
        serviceId: 'trello',
        name: 'Trello',
        description: 'Connect Trello.',
        providerFamily: 'trello',
        available: false,
        supportsReconnect: true,
        fields: [],
        authorizationOptions: [{ providerId: 'trello', label: 'Trello' }],
      },
      {
        type: 'service_account',
        serviceId: 'claude-platform-service-account',
        providerId: 'claude-platform-service-account',
        name: 'Claude Platform API key',
        description: 'Connect Claude Platform with a API key.',
        providerFamily: 'claude-platform',
        available: true,
        docsUrl: 'https://docs.sim.ai/integrations/managed-agent',
        requiresClientGeneratedCredentialId: false,
        fields: [
          {
            id: 'apiToken',
            label: 'API key',
            placeholder: 'sk-ant-...',
            required: true,
            secret: true,
            multiline: false,
            hint: 'Claude Platform API keys usually start with sk-ant-.',
          },
        ],
      },
    ])
    expect(mocks.createVisibility).toHaveBeenCalledWith(
      expect.objectContaining({ allowedIntegrationTypes: new Set(['salesforce']) })
    )
  })

  it('uses enrollment app visibility for managed OAuth without changing ordinary OAuth', async () => {
    const isCredentialVisible = vi.fn(({ type }) => type === 'managed_oauth')
    mocks.createVisibility.mockReturnValue({
      isOAuthServiceVisible: () => false,
      isCredentialVisible,
    })
    const ordinary = await listCredentialProviderCatalog(personalPrincipal, context)
    expect(ordinary.find((provider) => provider.serviceId === 'salesforce')?.available).toBe(false)
    const enrolled = await listCredentialProviderCatalog(
      personalPrincipal,
      context,
      'managed_oauth'
    )
    expect(enrolled.find((provider) => provider.serviceId === 'salesforce')?.available).toBe(true)
    expect(isCredentialVisible).toHaveBeenCalledWith({
      providerId: 'salesforce',
      type: 'managed_oauth',
    })
  })

  it('exposes an explicit Confluence verification target to service-account API clients', async () => {
    mocks.getServiceConfigByServiceId.mockReturnValue({
      providerId: 'confluence',
      name: 'Confluence',
    })
    mocks.getAllOAuthServices.mockReturnValue([
      {
        serviceId: 'confluence',
        providerId: 'confluence',
        serviceAccountProviderId: 'atlassian-service-account',
        name: 'Confluence',
        description: 'Connect Confluence.',
        baseProvider: 'atlassian',
        authType: 'oauth',
      },
    ])
    const catalog = await listCredentialProviderCatalog(personalPrincipal, context)
    const atlassian = catalog.find(
      (provider) =>
        provider.type === 'service_account' && provider.providerId === 'atlassian-service-account'
    )
    expect(atlassian?.type).toBe('service_account')
    if (atlassian?.type !== 'service_account') throw new Error('Missing Atlassian catalog entry')
    expect(atlassian.fields).toContainEqual(
      expect.objectContaining({
        id: 'atlassianProduct',
        required: false,
        secret: false,
        options: [
          { value: 'jira', label: 'Jira' },
          { value: 'confluence', label: 'Confluence' },
        ],
      })
    )
  })

  it('does not borrow a human permission group for workspace API keys', async () => {
    await listCredentialProviderCatalog(
      {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'workspace-key-1',
      },
      context
    )

    expect(mocks.getUserPermissionConfig).not.toHaveBeenCalled()
    /**
     * The deployment allowlist alone, not the personal caller's narrower group:
     * a workspace API key has no user and therefore no group, and borrowing the
     * key creator's would hide Trello from every caller of a shared credential.
     */
    expect(mocks.createVisibility).toHaveBeenCalledWith(
      expect.objectContaining({ allowedIntegrationTypes: new Set(['salesforce', 'trello']) })
    )
  })

  it('projects QuickBooks app credentials as write-only OAuth setup fields', async () => {
    mocks.getAllOAuthServices.mockReturnValue([
      {
        serviceId: 'quickbooks',
        providerId: 'quickbooks',
        name: 'QuickBooks',
        description: 'Connect QuickBooks.',
        baseProvider: 'quickbooks',
        authType: 'oauth',
        clientConfiguration: {
          fields: [
            {
              id: 'clientId',
              label: 'Client ID',
              placeholder: 'Enter client ID',
              secret: false,
            },
            {
              id: 'clientSecret',
              label: 'Client secret',
              placeholder: 'Enter client secret',
              secret: true,
            },
            {
              id: 'environment',
              label: 'Environment',
              placeholder: 'Select environment',
              secret: false,
              options: [
                { label: 'Sandbox', value: 'sandbox' },
                { label: 'Production', value: 'production' },
              ],
            },
          ],
        },
      },
    ])
    mocks.createVisibility.mockReturnValue({
      isOAuthServiceVisible: () => true,
      isCredentialVisible: () => false,
    })

    const catalog = await listCredentialProviderCatalog(personalPrincipal, context)

    expect(catalog[0]).toMatchObject({
      type: 'oauth',
      serviceId: 'quickbooks',
      available: true,
      fields: [
        { id: 'clientId', required: true, secret: false },
        { id: 'clientSecret', required: true, secret: true },
        {
          id: 'environment',
          required: true,
          secret: false,
          options: [
            { label: 'Sandbox', value: 'sandbox' },
            { label: 'Production', value: 'production' },
          ],
        },
      ],
    })
  })

  it('fails fast when a multi-server provider lacks complete labels', async () => {
    mocks.getServiceConfigByServiceId.mockImplementation((serviceId: string) => {
      if (serviceId === 'salesforce') {
        return { providerIdLabels: { salesforce: 'Production' } }
      }
      if (serviceId === 'trello') return {}
      return null
    })

    await expect(listCredentialProviderCatalog(personalPrincipal, context)).rejects.toThrow(
      'OAuth provider salesforce-sandbox is missing its authorization option label'
    )
  })
})

describe('requireAvailableServiceAccountCredentialProvider', () => {
  const provider: ServiceAccountCredentialProviderCatalogEntry = {
    type: 'service_account',
    serviceId: 'zoom-service-account',
    providerId: 'zoom-service-account',
    name: 'Zoom server-to-server app',
    description: 'Connect Zoom with a server-to-server app.',
    providerFamily: 'zoom',
    available: true,
    docsUrl: 'https://docs.sim.ai/integrations/zoom-service-account',
    requiresClientGeneratedCredentialId: false,
    fields: [],
  }

  it('returns an available service-account provider', () => {
    expect(requireAvailableServiceAccountCredentialProvider([provider], provider.providerId)).toBe(
      provider
    )
  })

  it('rejects a service-account provider hidden by workspace policy', () => {
    expect(() =>
      requireAvailableServiceAccountCredentialProvider(
        [{ ...provider, available: false }],
        provider.providerId
      )
    ).toThrow('Service-account provider is unavailable: zoom-service-account')
  })
})
