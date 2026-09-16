/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutorDelegationOrigin } from '@/executor/types'

const {
  mockBindExecutorManagedOAuthDelegation,
  mockCreateCopilotManagedOAuthPrincipal,
  mockResolveCredentialAccessToken,
  mockPersonalCredentialUseCase,
} = vi.hoisted(() => ({
  mockBindExecutorManagedOAuthDelegation: vi.fn(),
  mockCreateCopilotManagedOAuthPrincipal: vi.fn(),
  mockResolveCredentialAccessToken: vi.fn(),
  mockPersonalCredentialUseCase: vi.fn(),
}))

vi.mock('@/lib/credentials/application/copilot-managed-oauth-delegation', () => ({
  createCopilotManagedOAuthPrincipal: mockCreateCopilotManagedOAuthPrincipal,
}))

vi.mock('@/lib/copilot/application/execute-credential-use-case', () => ({
  executeCopilotCredentialUseCase: mockPersonalCredentialUseCase,
}))
vi.mock('@/tools/metadata', () => ({
  getToolMetadata: (id: string) =>
    id === 'gmail_read' ? { oauth: { required: true, provider: 'google-email' } } : undefined,
}))

vi.mock('@/lib/oauth/token-resolution', () => ({
  resolveCredentialAccessToken: mockResolveCredentialAccessToken,
}))

vi.mock('@/lib/credentials/application/managed-oauth-delegation', () => ({
  bindExecutorManagedOAuthDelegation: mockBindExecutorManagedOAuthDelegation,
}))

import { resolveExecutorCredentialToken } from '@/executor/utils/credential-token'

const ORIGIN: ExecutorDelegationOrigin = {
  subjectUserId: 'user-1',
  workflowId: 'wf-1',
  executionId: 'exec-1',
  currentWorkflow: { workflowId: 'wf-1' },
} as ExecutorDelegationOrigin

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

  it('wires the managed delegation binder only when the run carries an origin', async () => {
    mockBindExecutorManagedOAuthDelegation.mockResolvedValue({ kind: 'delegated' })

    await resolveExecutorCredentialToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      userId: 'user-1',
      executorDelegationOrigin: ORIGIN,
    })

    const input = mockResolveCredentialAccessToken.mock.calls[0][0]
    expect(input.resolveManagedPrincipal).toBeTypeOf('function')
    await input.resolveManagedPrincipal('managed-1')
    expect(mockBindExecutorManagedOAuthDelegation).toHaveBeenCalledWith(ORIGIN, 'managed-1')
  })

  it('proves a Chat turn through the copilot principal when there is no workflow run', async () => {
    mockCreateCopilotManagedOAuthPrincipal.mockReturnValue({ kind: 'delegated' })
    const copilotExecutionContext = {
      userId: 'user-1',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      toolCallId: 'call-1',
      copilotToolExecution: true as const,
    }

    await resolveExecutorCredentialToken({
      requestId: 'req-1',
      credentialId: 'cred-1',
      userId: 'user-1',
      copilotExecutionContext,
    })

    const input = mockResolveCredentialAccessToken.mock.calls[0][0]
    await input.resolveManagedPrincipal('managed-1')
    expect(mockCreateCopilotManagedOAuthPrincipal).toHaveBeenCalledWith(
      copilotExecutionContext,
      'managed-1'
    )
    expect(mockBindExecutorManagedOAuthDelegation).not.toHaveBeenCalled()
  })

  it('leaves managed credentials unproven for a context that is not a trusted Chat call', async () => {
    for (const copilotExecutionContext of [
      { userId: 'user-1', workspaceId: 'ws-1' },
      { userId: 'user-1', workspaceId: 'ws-1', copilotToolExecution: true as const },
    ]) {
      mockResolveCredentialAccessToken.mockClear()
      await resolveExecutorCredentialToken({
        requestId: 'req-1',
        credentialId: 'cred-1',
        userId: 'user-1',
        copilotExecutionContext,
      })

      expect(
        mockResolveCredentialAccessToken.mock.calls[0][0].resolveManagedPrincipal
      ).toBeUndefined()
    }
  })

  it('fails before dispatch when the origin lacks current workflow authority', async () => {
    await expect(
      resolveExecutorCredentialToken({
        requestId: 'req-1',
        credentialId: 'cred-1',
        userId: 'user-1',
        executorDelegationOrigin: { ...ORIGIN, currentWorkflow: undefined },
      })
    ).rejects.toThrow('Managed credential delegation is missing current workflow authority')
    expect(mockResolveCredentialAccessToken).not.toHaveBeenCalled()
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

describe('Assistant token boundary', () => {
  const context = {
    userId: 'user-1',
    workspaceId: 'ws-1',
    chatId: 'chat-1',
    toolCallId: 'tool-1',
    copilotToolExecution: true,
    requestMode: 'assistant',
  }
  const params = {
    requestId: 'req-1',
    credentialId: 'mine',
    userId: 'user-1',
    toolId: 'gmail_read',
    copilotExecutionContext: context,
  }
  beforeEach(() => {
    vi.clearAllMocks()
    mockPersonalCredentialUseCase.mockResolvedValue({ id: 'mine' })
    mockResolveCredentialAccessToken.mockResolvedValue({
      ok: true,
      token: { accessToken: 'fresh' },
    })
  })
  it('checks the current personal account before using the shared refresh/audit resolver', async () => {
    await expect(resolveExecutorCredentialToken(params)).resolves.toEqual({ accessToken: 'fresh' })
    expect(mockPersonalCredentialUseCase).toHaveBeenCalledWith(context, expect.anything(), {
      workspaceId: 'ws-1',
      credentialId: 'mine',
      expectedProviderId: 'google-email',
    })
    expect(mockPersonalCredentialUseCase.mock.invocationCallOrder[0]).toBeLessThan(
      mockResolveCredentialAccessToken.mock.invocationCallOrder[0]
    )
  })
  it('refuses revocation after discovery or approval without resolving a token', async () => {
    mockPersonalCredentialUseCase.mockRejectedValue(new Error('Account disconnected'))
    await expect(resolveExecutorCredentialToken(params)).rejects.toThrow('Account disconnected')
    expect(mockResolveCredentialAccessToken).not.toHaveBeenCalled()
  })
  it.each([
    { userId: 'other-user' },
    { impersonateEmail: 'other@example.com' },
    { toolId: 'http_request' },
    { copilotExecutionContext: { ...context, workspaceId: undefined } },
    { executorDelegationOrigin: ORIGIN },
  ])('refuses invalid Assistant authority before token resolution', async (override) => {
    await expect(resolveExecutorCredentialToken({ ...params, ...override })).rejects.toThrow()
    expect(mockResolveCredentialAccessToken).not.toHaveBeenCalled()
  })
})
