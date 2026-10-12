import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { blockVisibilityMock } from '@sim/testing/mocks/block-visibility.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  allowedIntegrationTypes: vi.fn(),
}))

vi.mock('@/lib/core/config/block-visibility', () => blockVisibilityMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/integrations/principal-scope.server', () => ({
  principalUserId: () => 'user-1',
  allowedIntegrationTypes: hoisted.allowedIntegrationTypes,
  allowedOrganizationIntegrationTypes: hoisted.allowedIntegrationTypes,
}))

import { v2ListCredentialProvidersContract } from '@/lib/api/contracts/v2/credentials'
import { listCredentialProviders } from '@/lib/credentials/application/list-credential-providers'
import { listCredentialProviderCatalog } from '@/lib/credentials/application/provider-catalog'

const CLAUDE_PROVIDER_ID = 'claude-platform-service-account'
const GITHUB_INSTALLATION_PROVIDER_ID = 'github-app-installation'
const context = { workspaceId: 'workspace-1', workspaceOrganizationId: null }
const responseSchema = v2ListCredentialProvidersContract.response.schema

async function listProviders(search?: string) {
  const { providers } = await listCredentialProviders.execute({
    principal: createSessionPrincipal(),
    input: { workspaceId: 'workspace-1', ...(search ? { search } : {}) },
  })
  return providers
}

describe('v2 credential provider catalog contract', () => {
  beforeEach(() => {
    hoisted.allowedIntegrationTypes.mockResolvedValue(null)
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue({
      ...context,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
  })

  it('presents the full unfiltered catalog as a valid response', async () => {
    const providers = await listProviders()

    const parsed = responseSchema.safeParse({ data: providers, nextCursor: null })
    expect(parsed.success ? [] : parsed.error.issues).toEqual([])
    expect(
      providers.some(
        (provider) =>
          provider.type === 'service_account' &&
          provider.providerId === GITHUB_INSTALLATION_PROVIDER_ID
      )
    ).toBe(false)
  })

  it('keeps the field-less GitHub installation in the internal catalog for existing credentials', async () => {
    const catalog = await listCredentialProviderCatalog(createSessionPrincipal(), context)
    const installation = catalog.find(
      (provider) =>
        provider.type === 'service_account' &&
        provider.providerId === GITHUB_INSTALLATION_PROVIDER_ID
    )

    expect(installation?.fields).toEqual([])
    expect(responseSchema.safeParse({ data: catalog, nextCursor: null }).success).toBe(false)
  })

  it('lists the native Claude Platform provider when filtered', async () => {
    const providers = await listProviders('claude')

    expect(responseSchema.safeParse({ data: providers, nextCursor: null }).success).toBe(true)
    expect(providers).toContainEqual(
      expect.objectContaining({
        type: 'service_account',
        serviceId: CLAUDE_PROVIDER_ID,
        providerId: CLAUDE_PROVIDER_ID,
        available: true,
        requiresClientGeneratedCredentialId: false,
        fields: [expect.objectContaining({ id: 'apiToken', required: true, secret: true })],
      })
    )
  })

  it('reports Claude as unavailable, not missing, when integration policy disables it', async () => {
    hoisted.allowedIntegrationTypes.mockResolvedValue(new Set(['slack']))

    const providers = await listProviders()

    expect(responseSchema.safeParse({ data: providers, nextCursor: null }).success).toBe(true)
    expect(providers).toContainEqual(
      expect.objectContaining({ providerId: CLAUDE_PROVIDER_ID, available: false })
    )
  })
})
