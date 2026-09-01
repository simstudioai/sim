/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listCatalog: vi.fn(),
  getWorkspaceCredential: vi.fn(),
  getCredentialActorContext: vi.fn(),
  assertWorkspaceCapability: vi.fn(),
}))

vi.mock('@/lib/permission-groups/capability-assertions', () => ({
  assertWorkspaceCapability: mocks.assertWorkspaceCapability,
}))

vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: mocks.listCatalog,
  requireAvailableOAuthCredentialProvider: (
    catalog: Array<{
      available: boolean
      authorizationOptions: Array<{ providerId: string }>
    }>,
    providerId: string
  ) => {
    const provider = catalog.find((entry) =>
      entry.authorizationOptions.some((option) => option.providerId === providerId)
    )
    if (!provider) throw Object.assign(new Error('Unknown OAuth provider'), { code: 'validation' })
    if (!provider.available)
      throw Object.assign(new Error('OAuth provider is unavailable'), { code: 'conflict' })
    return provider
  },
}))

vi.mock('@/lib/credentials/queries', () => ({
  getWorkspaceCredential: mocks.getWorkspaceCredential,
}))

vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mocks.getCredentialActorContext,
}))

vi.mock('@/lib/oauth/utils', () => ({
  credentialProviderMatchesService: (
    credentialProviderId: string,
    service: { providerId: string; additionalProviderIds?: readonly string[] }
  ) =>
    credentialProviderId === service.providerId ||
    (service.additionalProviderIds?.includes(credentialProviderId) ?? false),
}))

import { resolveCredentialConnectionTarget } from '@/lib/credentials/application/connection-target'

const principal = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'key-1',
}
const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const salesforceProvider = {
  type: 'oauth' as const,
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
}
const credential = {
  id: 'credential-1',
  workspaceId: 'workspace-1',
  type: 'oauth',
  providerId: 'salesforce-sandbox',
  displayName: 'Sandbox CRM',
}

describe('resolveCredentialConnectionTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listCatalog.mockResolvedValue([salesforceProvider])
    mocks.getWorkspaceCredential.mockResolvedValue(credential)
    mocks.getCredentialActorContext.mockResolvedValue({ credential, isAdmin: true })
    mocks.assertWorkspaceCapability.mockResolvedValue(undefined)
  })

  /**
   * `disablePersonalCredentials` leaves members "only workspace-shared ones", so
   * it withholds connecting an account and not re-authorizing a credential the
   * workspace already holds. Declaring it on the operation refused both.
   */
  it('asserts the personal-credential capability only when connecting an account', async () => {
    await resolveCredentialConnectionTarget({ principal, context, providerId: 'salesforce' })

    expect(mocks.assertWorkspaceCapability).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'credentials.personal',
      null
    )

    mocks.assertWorkspaceCapability.mockClear()
    await resolveCredentialConnectionTarget({ principal, context, credentialId: 'credential-1' })

    expect(mocks.assertWorkspaceCapability).not.toHaveBeenCalled()
  })

  it('accepts an exact authorization option for a new connection', async () => {
    const result = await resolveCredentialConnectionTarget({
      principal,
      context,
      providerId: 'salesforce-sandbox',
    })

    expect(result).toEqual({
      provider: salesforceProvider,
      providerId: 'salesforce-sandbox',
    })
    expect(mocks.getWorkspaceCredential).not.toHaveBeenCalled()
  })

  it('loads reconnect credentials through the asserted workspace and requires admin access', async () => {
    mocks.getCredentialActorContext.mockResolvedValue({ credential, isAdmin: false })

    await expect(
      resolveCredentialConnectionTarget({
        principal,
        context,
        credentialId: 'credential-1',
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
    })

    expect(mocks.getWorkspaceCredential).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
    })
    expect(mocks.getCredentialActorContext).toHaveBeenCalledWith('credential-1', 'user-1')
  })

  it('preserves the credential authorization-server ID on reconnect', async () => {
    const result = await resolveCredentialConnectionTarget({
      principal,
      context,
      credentialId: 'credential-1',
    })

    expect(result).toEqual({
      provider: salesforceProvider,
      providerId: 'salesforce-sandbox',
      credentialId: 'credential-1',
      displayName: 'Sandbox CRM',
    })
  })

  it('uses the legacy execution actor for an actorless reconnect', async () => {
    const actorlessPrincipal = {
      kind: 'delegated' as const,
      serviceId: 'executor' as const,
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: 'sim:credentials',
      issuedAt: new Date('2026-08-28T00:00:00.000Z'),
      expiresAt: new Date('2099-08-28T00:00:00.000Z'),
      delegationContext: {
        kind: 'workflow_execution' as const,
        workflowId: 'workflow-1',
        currentWorkflow: {
          workflowId: 'workflow-1',
          mode: 'deployment' as const,
          deploymentVersionId: 'deployment-1',
        },
        compatibilityActor: {
          kind: 'legacy_execution_user' as const,
          userId: 'execution-actor',
        },
      },
    }

    await resolveCredentialConnectionTarget({
      principal: actorlessPrincipal,
      context,
      credentialId: 'credential-1',
    })

    expect(mocks.getCredentialActorContext).toHaveBeenCalledWith('credential-1', 'execution-actor')
  })

  it('rejects providers whose custom flow cannot reconnect', async () => {
    mocks.listCatalog.mockResolvedValue([{ ...salesforceProvider, supportsReconnect: false }])

    await expect(
      resolveCredentialConnectionTarget({
        principal,
        context,
        credentialId: 'credential-1',
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})
