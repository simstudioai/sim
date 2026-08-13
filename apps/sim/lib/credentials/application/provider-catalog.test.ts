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

import { listCredentialProviderCatalog } from '@/lib/credentials/application/provider-catalog'

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
    serviceId: 'service-account-only',
    providerId: 'service-account-only',
    name: 'Service account',
    description: 'Not OAuth.',
    baseProvider: 'test',
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
        serviceId: 'trello',
        name: 'Trello',
        description: 'Connect Trello.',
        providerFamily: 'trello',
        available: false,
        supportsReconnect: false,
        authorizationOptions: [{ providerId: 'trello', label: 'Trello' }],
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
