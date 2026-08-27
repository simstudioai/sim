/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  listCatalog: vi.fn(),
  resolveTarget: vi.fn(),
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
  })

  it('resolves a provider inside delegated workspace policy', async () => {
    const result = await prepareCredentialConnection.execute({
      principal,
      input: { workspaceId: 'workspace-1', providerName: 'gmail' },
    })

    expect(result).toEqual({ providerId: 'google-email', serviceName: 'Gmail' })
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
})
