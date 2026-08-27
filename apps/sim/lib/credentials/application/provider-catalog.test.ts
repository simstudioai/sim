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

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
}))

vi.mock('@/lib/permission-groups/integration-allowlist', () => ({
  intersectIntegrationAllowlists: (
    permissionGroup: readonly string[] | null,
    deployment: readonly string[] | null
  ) => {
    if (!permissionGroup) return deployment
    if (!deployment) return permissionGroup
    return permissionGroup.filter((type) => deployment.includes(type))
  },
}))

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
    mocks.getAllowedIntegrationsFromEnv.mockReturnValue(['salesforce'])
    mocks.getUserPermissionConfig.mockResolvedValue({
      allowedIntegrations: ['salesforce', 'trello'],
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
    expect(mocks.createVisibility).toHaveBeenCalledWith(
      expect.objectContaining({ allowedIntegrationTypes: new Set(['salesforce']) })
    )
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
