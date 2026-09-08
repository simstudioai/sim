/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  listCatalog: vi.fn(),
  resolveTarget: vi.fn(),
  personalCredentials: vi.fn(),
  personalTokens: vi.fn(),
  credentialVisible: vi.fn(),
  allowedIntegrations: vi.fn(),
  blockVisibility: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: mocks.listCatalog,
}))
vi.mock('@/lib/credentials/application/connection-target', () => ({
  resolveCredentialConnectionTarget: mocks.resolveTarget,
}))
vi.mock('@/lib/credentials/personal', () => ({
  getPersonalOAuthCredentials: mocks.personalCredentials,
}))

vi.mock('@/lib/credentials/personal-tokens', () => ({
  getPersonalTokenCredentials: mocks.personalTokens,
}))
vi.mock('@/lib/core/config/block-visibility', () => ({
  getBlockVisibility: mocks.blockVisibility,
}))
vi.mock('@/lib/integrations/principal-scope.server', () => ({
  allowedIntegrationTypes: mocks.allowedIntegrations,
}))
vi.mock('@/lib/integrations/credential-visibility.server', () => ({
  createIntegrationCredentialVisibility: () => ({ isCredentialVisible: mocks.credentialVisible }),
}))

import { prepareCredentialConnection } from '@/lib/credentials/application/prepare-credential-connection'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:credentials',
  issuedAt: new Date('2026-08-14T12:00:00.000Z'),
  expiresAt: new Date('2030-08-14T12:05:00.000Z'),
}
const gmailProvider = {
  type: 'oauth' as const,
  serviceId: 'gmail',
  name: 'Gmail',
  description: 'Gmail OAuth',
  providerFamily: 'google',
  available: true,
  supportsReconnect: true,
  authorizationOptions: [{ providerId: 'google-email', label: 'Gmail' }],
}

describe('prepareCredentialConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.listCatalog.mockResolvedValue([gmailProvider])
    mocks.personalCredentials.mockResolvedValue([])
    mocks.personalTokens.mockResolvedValue([])
    mocks.credentialVisible.mockReturnValue(true)
    mocks.allowedIntegrations.mockResolvedValue(null)
    mocks.blockVisibility.mockResolvedValue({
      revealed: new Set(),
      disabled: new Set(),
      previewTagged: new Set(),
    })
  })

  it('prepares personal GitLab setup without inventing an OAuth provider', async () => {
    const result = await prepareCredentialConnection.execute({
      principal,
      input: { workspaceId: 'workspace-1', providerName: ' GitLab ', personalOnly: true },
    })
    expect(result).toEqual({ kind: 'personal_token', providerId: 'gitlab', serviceName: 'GitLab' })
    expect(mocks.listCatalog).not.toHaveBeenCalled()
    expect(mocks.credentialVisible).toHaveBeenCalledWith({
      providerId: 'gitlab',
      type: 'personal_token',
    })
    expect(mocks.allowedIntegrations).toHaveBeenCalledWith(principal, 'workspace-1')
    expect(mocks.blockVisibility).toHaveBeenCalledWith({ userId: 'user-1' })
  })

  it('rejects unavailable personal GitLab connections', async () => {
    mocks.credentialVisible.mockReturnValue(false)
    await expect(
      prepareCredentialConnection.execute({
        principal,
        input: { workspaceId: 'workspace-1', providerName: 'gitlab', personalOnly: true },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('cannot reconnect someone else’s GitLab token even as workspace admin', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.personalTokens.mockResolvedValue([{ id: 'mine', providerId: 'gitlab' }])
    await expect(
      prepareCredentialConnection.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          providerName: 'gitlab',
          credentialId: 'other-person',
          personalOnly: true,
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.personalTokens).toHaveBeenCalledWith('workspace-1', 'user-1', 'other-person')
    expect(mocks.resolveTarget).not.toHaveBeenCalled()
  })

  it('prepares reconnect for the caller’s personal GitLab token', async () => {
    mocks.personalTokens.mockResolvedValue([{ id: 'mine', providerId: 'gitlab' }])
    const result = await prepareCredentialConnection.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        providerName: 'gitlab',
        credentialId: 'mine',
        personalOnly: true,
      },
    })
    expect(result.kind).toBe('personal_token')
    expect(mocks.resolveTarget).not.toHaveBeenCalled()
  })

  it('resolves a provider inside delegated workspace policy', async () => {
    const result = await prepareCredentialConnection.execute({
      principal,
      input: { workspaceId: 'workspace-1', providerName: 'gmail' },
    })

    expect(result).toEqual({ kind: 'oauth', providerId: 'google-email', serviceName: 'Gmail' })
  })

  it('uses the credential target as the reconnect authority', async () => {
    mocks.resolveTarget.mockResolvedValue({
      providerId: 'google-email',
      credentialId: 'credential-1',
    })

    const result = await prepareCredentialConnection.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        providerName: 'gmail',
        credentialId: 'credential-1',
      },
    })

    expect(result).toEqual({
      kind: 'oauth',
      providerId: 'google-email',
      serviceName: 'Gmail',
      credentialId: 'credential-1',
    })
    expect(mocks.resolveTarget).toHaveBeenCalledWith({
      principal,
      context: workspace,
      credentialId: 'credential-1',
    })
  })

  it('rejects a reconnect whose requested provider does not match the credential', async () => {
    mocks.resolveTarget.mockResolvedValue({
      providerId: 'slack',
      credentialId: 'credential-1',
    })

    await expect(
      prepareCredentialConnection.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          providerName: 'gmail',
          credentialId: 'credential-1',
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('rejects another person’s account before shared-credential reconnect authorization', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    await expect(
      prepareCredentialConnection.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          providerName: 'gmail',
          credentialId: 'shared-account',
          personalOnly: true,
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.personalCredentials).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      'shared-account'
    )
    expect(mocks.resolveTarget).not.toHaveBeenCalled()
  })

  it('connects an ordinary personal account through canonical enrollment in Assistant', async () => {
    mocks.personalCredentials.mockResolvedValue([
      { id: 'own-account', providerId: 'google-email', type: 'oauth' },
    ])
    mocks.resolveTarget.mockResolvedValue({
      providerId: 'google-email',
      credentialId: 'own-account',
    })
    const result = await prepareCredentialConnection.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        providerName: 'gmail',
        credentialId: 'own-account',
        personalOnly: true,
      },
    })
    expect(result).toEqual({
      kind: 'managed_oauth',
      providerId: 'google-email',
      serviceName: 'Gmail',
    })
    expect(mocks.resolveTarget).not.toHaveBeenCalled()
  })

  it('uses the enrollment flow for an owned managed account', async () => {
    mocks.personalCredentials.mockResolvedValue([
      { id: 'managed-account', providerId: 'google-email', type: 'managed_oauth' },
    ])
    const result = await prepareCredentialConnection.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        providerName: 'gmail',
        credentialId: 'managed-account',
        personalOnly: true,
      },
    })
    expect(result).toEqual({
      kind: 'managed_oauth',
      providerId: 'google-email',
      serviceName: 'Gmail',
    })
    expect(mocks.resolveTarget).not.toHaveBeenCalled()
  })

  it('does not offer Slack bot OAuth when connecting a personal Slack account', async () => {
    mocks.listCatalog.mockResolvedValue([
      {
        ...gmailProvider,
        serviceId: 'slack',
        name: 'Slack',
        authorizationOptions: [{ providerId: 'slack', label: 'Slack' }],
      },
    ])
    const result = await prepareCredentialConnection.execute({
      principal,
      input: { workspaceId: 'workspace-1', providerName: 'slack', personalOnly: true },
    })
    expect(result).toEqual({ kind: 'managed_oauth', providerId: 'slack', serviceName: 'Slack' })
    expect(mocks.resolveTarget).not.toHaveBeenCalled()
  })

  it('rejects personal credentials from a different provider', async () => {
    mocks.personalCredentials.mockResolvedValue([
      { id: 'own-account', providerId: 'slack', type: 'managed_oauth' },
    ])
    await expect(
      prepareCredentialConnection.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          providerName: 'gmail',
          credentialId: 'own-account',
          personalOnly: true,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.resolveTarget).not.toHaveBeenCalled()
  })

  it('rejects service-account aliases before fuzzy provider matching in personal mode', async () => {
    await expect(
      prepareCredentialConnection.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          providerName: 'google service account',
          personalOnly: true,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.listCatalog).not.toHaveBeenCalled()
  })
})
