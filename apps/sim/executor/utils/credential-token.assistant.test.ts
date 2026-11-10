/**
 * Drives the Assistant's GitHub token resolution through the real token resolver
 * (`lib/oauth/token-resolution`), so the tool policy it binds against is the one the
 * resolver actually reads, not a mock's.
 */
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { authOAuthUtilsMock, authOAuthUtilsMockFns } from '@sim/testing/mocks/auth-oauth-utils.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeCredentialUseForAuth, mockPersonalCredentialUseCase } = vi.hoisted(() => ({
  mockAuthorizeCredentialUseForAuth: vi.fn(),
  mockPersonalCredentialUseCase: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUseForAuth: mockAuthorizeCredentialUseForAuth,
}))
vi.mock('@/lib/mothership/application/execute-credential-use-case', () => ({
  executeCopilotCredentialUseCase: mockPersonalCredentialUseCase,
}))
vi.unmock('@/lib/oauth/utils')

import { resolveExecutorCredentialToken } from '@/executor/utils/credential-token'
import { getToolMetadata } from '@/tools/metadata'

const { mockGetCredential, mockRefreshTokenIfNeeded, mockResolveOAuthAccountId } =
  authOAuthUtilsMockFns

const ASSISTANT = {
  userId: 'person',
  workspaceId: 'ws-1',
  chatId: 'chat-1',
  toolCallId: 'call-1',
  copilotToolExecution: true,
  requestMode: 'assistant' as const,
}

function resolve(overrides: Partial<Parameters<typeof resolveExecutorCredentialToken>[0]> = {}) {
  return resolveExecutorCredentialToken({
    requestId: 'req-1',
    credentialId: 'own-account',
    userId: 'person',
    toolId: 'github_search_users_v2',
    copilotExecutionContext: ASSISTANT,
    ...overrides,
  })
}

describe('Assistant GitHub calls through the real token resolver', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('@/tools/metadata')>('@/tools/metadata')
    vi.mocked(getToolMetadata).mockImplementation(actual.getToolMetadata)
    mockPersonalCredentialUseCase.mockResolvedValue({ id: 'own-account' })
    mockAuthorizeCredentialUseForAuth.mockResolvedValue({
      ok: true,
      requesterUserId: 'person',
      credentialOwnerUserId: 'person',
      workspaceId: 'ws-1',
      resolvedCredentialId: 'own-account',
    })
    mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'personal-github-oauth' })
  })

  it("resolves the person's own GitHub account for a GitHub tool", async () => {
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'oauth',
      credentialId: 'own-account',
      providerId: 'github-repositories',
      accountId: 'account-1',
      workspaceId: 'ws-1',
      usedCredentialTable: true,
    })
    mockGetCredential.mockResolvedValue({ providerId: 'github-repositories', scope: 'repo' })

    await expect(resolve()).resolves.toMatchObject({ accessToken: 'personal-github-oauth' })
  })

  it('never hands the Assistant a saved workspace GitHub token', async () => {
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      credentialId: 'workspace-token',
      providerId: 'github-service-account',
      accountId: '',
      workspaceId: 'ws-1',
      usedCredentialTable: true,
    })

    await expect(resolve({ credentialId: 'workspace-token' })).rejects.toThrow(
      'The selected credential type is not supported by this tool'
    )
    expect(authOAuthUtilsMockFns.mockResolveServiceAccountToken).not.toHaveBeenCalled()
  })

  it("does not let a workflow run bind GitHub tools to a person's GitHub account", async () => {
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'oauth',
      credentialId: 'own-account',
      providerId: 'github-repositories',
      accountId: 'account-1',
      workspaceId: 'ws-1',
      usedCredentialTable: true,
    })
    mockGetCredential.mockResolvedValue({ providerId: 'github-repositories', scope: 'repo' })

    await expect(resolve({ copilotExecutionContext: undefined })).rejects.toThrow(
      'The selected credential type is not supported by this tool'
    )
    expect(mockRefreshTokenIfNeeded).not.toHaveBeenCalled()
  })
})
