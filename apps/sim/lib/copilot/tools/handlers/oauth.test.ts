/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getBaseUrl: vi.fn(),
}))

const useCases = vi.hoisted(() => ({
  prepare: { operation: { id: 'credentials.connections.prepare' } },
}))

vi.mock('@/lib/copilot/application/execute-credential-use-case', () => ({
  executeCopilotCredentialUseCase: mocks.execute,
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: mocks.getBaseUrl }))
vi.mock('@/lib/credentials/application/prepare-credential-connection', () => ({
  prepareCredentialConnection: useCases.prepare,
}))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeOAuthGetAuthLink } from '@/lib/copilot/tools/handlers/oauth'

const context: ExecutionContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  chatId: 'chat-1',
  toolCallId: 'call-1',
  copilotToolExecution: true,
  userPermission: 'write',
}

describe('executeOAuthGetAuthLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBaseUrl.mockReturnValue('https://sim.test')
    mocks.execute.mockResolvedValue({
      serviceName: 'Gmail',
      providerId: 'google-email',
      workspaceId: 'workspace-1',
    })
  })

  it('uses the credential application adapter for a new connection', async () => {
    const result = await executeOAuthGetAuthLink({ providerName: 'gmail' }, context)

    expect(result.success).toBe(true)
    expect(mocks.execute).toHaveBeenCalledWith(context, useCases.prepare, {
      workspaceId: 'workspace-1',
      providerName: 'gmail',
      credentialId: undefined,
    })
    const url = new URL((result.output as { oauth_url: string }).oauth_url)
    expect(url.pathname).toBe('/api/auth/oauth2/authorize')
    expect(url.searchParams.get('providerId')).toBe('google-email')
    expect(url.searchParams.get('workspaceId')).toBe('workspace-1')
    expect(url.searchParams.has('credentialId')).toBe(false)
  })

  it('preserves the canonical credential ID for reconnect', async () => {
    mocks.execute.mockResolvedValue({
      serviceName: 'Gmail',
      providerId: 'google-email',
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
    })

    const result = await executeOAuthGetAuthLink(
      { providerName: 'gmail', credentialId: 'credential-1' },
      context
    )

    const output = result.output as { oauth_url: string; message: string }
    expect(new URL(output.oauth_url).searchParams.get('credentialId')).toBe('credential-1')
    expect(output.message).toContain('re-authorizes credential credential-1 in place')
  })

  it('returns application validation errors without exposing infrastructure failures', async () => {
    mocks.execute.mockRejectedValue(new OrchestrationError('not_found', 'Provider not found'))

    const result = await executeOAuthGetAuthLink({ providerName: 'missing' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Provider not found')
  })

  it('fails fast without trusted workspace context', async () => {
    const result = await executeOAuthGetAuthLink(
      { providerName: 'gmail' },
      { ...context, workspaceId: undefined }
    )

    expect(result).toEqual({ success: false, error: 'workspaceId is required' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects service-account providers before OAuth resolution', async () => {
    const result = await executeOAuthGetAuthLink({ providerName: 'slack custom bot' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('service account, not an OAuth provider')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('does not confuse integrations that also offer service accounts', async () => {
    const result = await executeOAuthGetAuthLink({ providerName: 'slack' }, context)

    expect(result.success).toBe(true)
    expect(mocks.execute).toHaveBeenCalledOnce()
  })

  it('requires personal credentials from trusted mode, ignoring model-supplied policy', async () => {
    const assistant = { ...context, requestMode: 'assistant' }
    const result = await executeOAuthGetAuthLink(
      { providerName: 'gmail', personalOnly: false },
      assistant
    )
    expect(result.success).toBe(true)
    expect(mocks.execute).toHaveBeenCalledWith(assistant, useCases.prepare, {
      workspaceId: 'workspace-1',
      providerName: 'gmail',
      credentialId: undefined,
      personalOnly: true,
    })
  })

  it.each([
    { kind: 'personal_token', providerId: 'gitlab', serviceName: 'GitLab' },
    { kind: 'managed_oauth', providerId: 'slack', serviceName: 'Slack' },
    { kind: 'oauth', providerId: 'confluence', serviceName: 'Confluence' },
  ])('offers a provider-only personal connection card for $serviceName', async (provider) => {
    mocks.execute.mockResolvedValue(provider)
    const result = await executeOAuthGetAuthLink(
      { providerName: provider.providerId },
      { ...context, requestMode: 'assistant' }
    )
    expect(result.success).toBe(true)
    expect(result.output).not.toHaveProperty('oauth_url')
    expect(result.output).toMatchObject({
      providerId: provider.providerId,
      instructions: expect.stringContaining(
        `<credential>{"type":"link","provider":"${provider.providerId}"}</credential>`
      ),
    })
  })

  it('does not offer a service-account card or fallback link in Assistant', async () => {
    const result = await executeOAuthGetAuthLink(
      { providerName: 'slack custom bot' },
      { ...context, requestMode: 'assistant' }
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('your own connected accounts')
    expect(result.output).not.toHaveProperty('oauth_url')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('does not attach a reconnect URL after rejecting another person’s credential', async () => {
    mocks.execute.mockRejectedValue(
      new OrchestrationError('forbidden', 'Assistant can only reconnect your own account.')
    )
    const result = await executeOAuthGetAuthLink(
      { providerName: 'gmail', credentialId: 'other-account' },
      { ...context, requestMode: 'assistant' }
    )
    expect(result.success).toBe(false)
    expect(result.output).not.toHaveProperty('oauth_url')
    expect(result.error).toContain('own account')
  })
})
