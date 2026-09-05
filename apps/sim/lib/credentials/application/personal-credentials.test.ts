/**
 * @vitest-environment node
 */
import type { DelegatedPrincipal, Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  listPersonal: vi.fn(),
  listTokens: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/credentials/personal', () => ({
  getPersonalOAuthCredentials: mocks.listPersonal,
}))

vi.mock('@/lib/credentials/personal-tokens', () => ({
  getPersonalTokenCredentials: mocks.listTokens,
}))

import {
  authorizePersonalCredential,
  listPersonalCredentials,
} from '@/lib/credentials/application/personal-credentials'

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}
const principal: Principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const personalCredential = {
  id: 'credential-1',
  providerId: 'google-drive',
  displayName: 'My Drive account',
  type: 'oauth' as const,
}
const authorizationInput = {
  workspaceId: 'workspace-1',
  credentialId: personalCredential.id,
  expectedProviderId: 'google-drive',
}

function delegatedPrincipal(overrides: Partial<DelegatedPrincipal> = {}): DelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'assistant-turn-1',
    audience: 'sim:credentials',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

describe('personal credential application access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.listPersonal.mockResolvedValue([personalCredential])
    mocks.listTokens.mockResolvedValue([])
  })

  it('discovers only the acting user account without substituting the billing owner', async () => {
    const result = await listPersonalCredentials.execute({
      principal,
      input: { workspaceId: 'workspace-1' },
    })

    expect(result).toEqual({ credentials: [personalCredential] })
    expect(mocks.listPersonal).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mocks.listTokens).toHaveBeenCalledWith('workspace-1', 'user-1')
  })

  it('carries the delegated person through discovery and token authorization', async () => {
    const delegated = delegatedPrincipal()
    await listPersonalCredentials.execute({
      principal: delegated,
      input: { workspaceId: 'workspace-1' },
    })
    await authorizePersonalCredential.execute({ principal: delegated, input: authorizationInput })

    expect(mocks.listPersonal).toHaveBeenCalledTimes(2)
    expect(mocks.listPersonal).toHaveBeenNthCalledWith(1, 'workspace-1', 'user-1')
    expect(mocks.listPersonal).toHaveBeenNthCalledWith(
      2,
      'workspace-1',
      'user-1',
      personalCredential.id
    )
  })

  it('includes only owner-scoped personal token metadata in account discovery', async () => {
    const token = {
      id: 'gitlab-personal',
      providerId: 'gitlab',
      type: 'personal_token',
      displayName: 'My GitLab',
      instanceUrl: 'https://gitlab.example.com',
    }
    mocks.listTokens.mockResolvedValue([token])
    const result = await listPersonalCredentials.execute({
      principal,
      input: { workspaceId: 'workspace-1' },
    })
    expect(result.credentials).toEqual([personalCredential, token])
    expect(mocks.listTokens).toHaveBeenCalledWith('workspace-1', 'user-1')
  })

  it('accepts an alternate authorization server for the same OAuth service', async () => {
    const sandbox = { ...personalCredential, providerId: 'salesforce-sandbox' }
    mocks.listPersonal.mockResolvedValue([sandbox])
    await expect(
      authorizePersonalCredential.execute({
        principal,
        input: { ...authorizationInput, expectedProviderId: 'salesforce' },
      })
    ).resolves.toEqual(sandbox)
  })

  it('authorizes a managed account returned by the same personal policy', async () => {
    const managed = { ...personalCredential, providerId: 'slack', type: 'managed_oauth' as const }
    mocks.listPersonal.mockResolvedValue([managed])

    const result = await authorizePersonalCredential.execute({
      principal,
      input: { ...authorizationInput, expectedProviderId: 'slack' },
    })

    expect(result).toEqual(managed)
  })

  it('refuses a different person account even when the caller is a workspace administrator', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')

    await expect(
      authorizePersonalCredential.execute({
        principal,
        input: { ...authorizationInput, credentialId: 'another-person-account' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a service account absent from the personal credential set', async () => {
    await expect(
      authorizePersonalCredential.execute({
        principal,
        input: { ...authorizationInput, credentialId: 'workspace-service-account' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a personal account belonging to a different provider', async () => {
    await expect(
      authorizePersonalCredential.execute({
        principal,
        input: { ...authorizationInput, expectedProviderId: 'slack' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('rechecks after discovery so a disconnected account cannot authorize a pending action', async () => {
    await listPersonalCredentials.execute({ principal, input: { workspaceId: 'workspace-1' } })
    mocks.listPersonal.mockResolvedValue([])

    await expect(
      authorizePersonalCredential.execute({ principal, input: authorizationInput })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.listPersonal).toHaveBeenCalledTimes(2)
  })

  it('refuses missing workspaces before looking up personal accounts', async () => {
    mocks.loadWorkspace.mockResolvedValue(null)

    await expect(
      listPersonalCredentials.execute({ principal, input: { workspaceId: 'missing-workspace' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.listPersonal).not.toHaveBeenCalled()
  })

  it('refuses removed workspace membership before looking up personal accounts', async () => {
    mocks.resolvePermission.mockResolvedValue(null)

    await expect(
      authorizePersonalCredential.execute({ principal, input: authorizationInput })
    ).rejects.toThrow()
    expect(mocks.listPersonal).not.toHaveBeenCalled()
  })

  it('refuses actorless workspace keys before loading protected data', async () => {
    await expect(
      listPersonalCredentials.execute({
        principal: {
          kind: 'workspace_api_key',
          keyId: 'workspace-key',
          workspaceId: 'workspace-1',
        },
        input: { workspaceId: 'workspace-1' },
      })
    ).rejects.toThrow()
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.listPersonal).not.toHaveBeenCalled()
  })

  it.each([
    ['another workspace', { workspaceId: 'workspace-2' }],
    ['another service', { serviceId: 'executor' }],
    ['another audience', { audience: 'sim:knowledge' }],
    ['expired delegation', { expiresAt: new Date(0) }],
    ['no person', { subjectUserId: undefined }],
  ] satisfies Array<[string, Partial<DelegatedPrincipal>]>)(
    'refuses %s delegations',
    async (_, overrides) => {
      await expect(
        authorizePersonalCredential.execute({
          principal: delegatedPrincipal(overrides),
          input: authorizationInput,
        })
      ).rejects.toThrow()
      expect(mocks.listPersonal).not.toHaveBeenCalled()
    }
  )
})
