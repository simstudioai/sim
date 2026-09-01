/**
 * @vitest-environment node
 */
import { bindPrincipalExecutionMetadata } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBindExecutorManagedOAuthDelegation, mockResolveCredentialAccessToken } = vi.hoisted(
  () => ({
    mockBindExecutorManagedOAuthDelegation: vi.fn(),
    mockResolveCredentialAccessToken: vi.fn(),
  })
)

vi.mock('@/lib/oauth/token-resolution', () => ({
  resolveCredentialAccessToken: mockResolveCredentialAccessToken,
}))

vi.mock('@/lib/credentials/application/managed-oauth-delegation', () => ({
  bindExecutorManagedOAuthDelegation: mockBindExecutorManagedOAuthDelegation,
}))

import { resolveExecutorCredentialToken } from '@/executor/utils/credential-token'

const PRINCIPAL = bindPrincipalExecutionMetadata(
  { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  {
    executionId: 'exec-1',
    rootWorkflowId: 'wf-1',
    currentWorkflow: { workflowId: 'wf-1', mode: 'draft' },
  }
)

describe('resolveExecutorCredentialToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveCredentialAccessToken.mockResolvedValue({
      ok: true,
      token: { accessToken: 'fresh' },
    })
  })

  it('dispatches with an internal-JWT auth result for the executing user', async () => {
    await resolveExecutorCredentialToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      userId: 'user-1',
      workflowId: 'wf-1',
      toolId: 'gmail_read',
    })

    const input = mockResolveCredentialAccessToken.mock.calls[0][0]
    expect(input).toMatchObject({
      requestId: 'req-1',
      credentialId: 'cred-1',
      workflowId: 'wf-1',
      toolId: 'gmail_read',
    })
    await expect(input.authenticate()).toEqual({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    expect(input.resolveManagedPrincipal).toBeUndefined()
  })

  it('asserts the caller only when the run enforces credential access', async () => {
    await resolveExecutorCredentialToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      userId: 'user-1',
    })
    expect(mockResolveCredentialAccessToken.mock.calls[0][0].callerUserId).toBeUndefined()

    await resolveExecutorCredentialToken({
      requestId: 'req-2',
      credentialId: 'cred-1',
      userId: 'user-1',
      enforceCredentialAccess: true,
    })
    expect(mockResolveCredentialAccessToken.mock.calls[1][0].callerUserId).toBe('user-1')
  })

  it('wires the managed delegation binder only when the run carries a runtime principal', async () => {
    mockBindExecutorManagedOAuthDelegation.mockResolvedValue(PRINCIPAL)

    await resolveExecutorCredentialToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      userId: 'user-1',
      principal: PRINCIPAL,
    })

    const input = mockResolveCredentialAccessToken.mock.calls[0][0]
    expect(input.resolveManagedPrincipal).toBeTypeOf('function')
    await input.resolveManagedPrincipal('managed-1')
    expect(mockBindExecutorManagedOAuthDelegation).toHaveBeenCalledWith(PRINCIPAL, 'managed-1')
  })

  it('passes the runtime principal through without inferring workflow authority', async () => {
    const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

    await resolveExecutorCredentialToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      userId: 'user-1',
      principal,
    })

    const input = mockResolveCredentialAccessToken.mock.calls[0][0]
    await input.resolveManagedPrincipal('managed-1')
    expect(mockBindExecutorManagedOAuthDelegation).toHaveBeenCalledWith(principal, 'managed-1')
  })

  it('throws the executeTool error contract with the tool label on failure', async () => {
    mockResolveCredentialAccessToken.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Failed to refresh access token',
    })

    await expect(
      resolveExecutorCredentialToken({
        requestId: 'req-1',
        credentialId: 'cred-1',
        userId: 'user-1',
        toolLabel: 'Gmail Read',
      })
    ).rejects.toThrow('Failed to obtain credential for Gmail Read: Failed to refresh access token')
  })

  it('returns the full token payload untouched', async () => {
    const token = {
      accessToken: 'fresh',
      idToken: 'id-1',
      instanceUrl: 'https://contoso.crm.dynamics.com',
      apiDomain: 'desk.zoho.com',
      cloudId: 'cloud-1',
      domain: 'example.atlassian.net',
      authStyle: 'x-api-token',
    }
    mockResolveCredentialAccessToken.mockResolvedValue({ ok: true, token })

    await expect(
      resolveExecutorCredentialToken({
        requestId: 'req-1',
        credentialId: 'cred-1',
        userId: 'user-1',
      })
    ).resolves.toEqual(token)
  })
})
