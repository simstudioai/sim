/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  providerMatches: vi.fn(),
  refreshToken: vi.fn(),
  resolveContext: vi.fn(),
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  refreshAccessTokenIfNeeded: mocks.refreshToken,
}))
vi.mock('@/lib/selectors/application/credential-provider', () => ({
  selectorCredentialMatchesService: mocks.providerMatches,
}))
vi.mock('@/lib/selectors/server/resolve-authorized-context', () => ({
  resolveAuthorizedSelectorContext: mocks.resolveContext,
}))

import { resolveSlackSelectorCredential } from '@/lib/selectors/server/slack-credential'

const principal = { kind: 'session', userId: 'viewer-1', sessionId: 'session-1' } as const

describe('resolveSlackSelectorCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.providerMatches.mockResolvedValue(true)
    mocks.refreshToken.mockResolvedValue('xoxp-oauth-token')
    mocks.resolveContext.mockResolvedValue({
      ok: true,
      context: {},
      requesterUserId: 'viewer-1',
      workspaceId: 'workspace-1',
      credentialAccess: {
        ok: true,
        workspaceId: 'workspace-1',
        credentialOwnerUserId: 'owner-1',
        credentialType: 'oauth',
      },
    })
  })

  it.each([
    ['literal', 'xoxb-literal-secret'],
    ['referenced', '{{SLACK_BOT_TOKEN}}'],
  ])('workflow-authorizes a %s direct bot token', async (_label, credential) => {
    mocks.resolveContext.mockResolvedValue({
      ok: true,
      context: { credential: 'xoxb-resolved-secret' },
      requesterUserId: 'viewer-1',
      workspaceId: 'workspace-1',
    })

    const result = await resolveSlackSelectorCredential(principal, {
      credential,
      workflowId: 'workflow-1',
      requestId: 'request-1',
    })

    expect(result).toEqual({
      ok: true,
      accessToken: 'xoxb-resolved-secret',
      isBotToken: true,
    })
    expect(mocks.resolveContext).toHaveBeenCalledWith(principal, {
      workflowId: 'workflow-1',
      context: { credential },
    })
    expect(mocks.providerMatches).not.toHaveBeenCalled()
    expect(mocks.refreshToken).not.toHaveBeenCalled()
  })

  it('retains canonical credential authorization for workflowless OAuth connectors', async () => {
    const result = await resolveSlackSelectorCredential(principal, {
      credential: 'credential-1',
      requestId: 'request-1',
    })

    expect(mocks.resolveContext).toHaveBeenCalledWith(principal, {
      workflowId: undefined,
      credentialId: 'credential-1',
      context: {},
    })
    expect(mocks.providerMatches).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      credentialOwnerUserId: 'owner-1',
      serviceId: 'slack',
    })
    expect(mocks.refreshToken).toHaveBeenCalledWith('credential-1', 'owner-1', 'request-1')
    expect(result).toMatchObject({ ok: true, accessToken: 'xoxp-oauth-token', isBotToken: false })
  })

  it('supports provider-bound custom-bot service accounts', async () => {
    mocks.resolveContext.mockResolvedValue({
      ok: true,
      context: {},
      requesterUserId: 'viewer-1',
      workspaceId: 'workspace-1',
      credentialAccess: {
        ok: true,
        workspaceId: 'workspace-1',
        credentialOwnerUserId: 'owner-1',
        credentialType: 'service_account',
      },
    })
    mocks.refreshToken.mockResolvedValue('xoxb-custom-bot-token')

    const result = await resolveSlackSelectorCredential(principal, {
      credential: 'custom-bot-credential',
      requestId: 'request-1',
    })

    expect(mocks.providerMatches).toHaveBeenCalledWith({
      credentialId: 'custom-bot-credential',
      credentialOwnerUserId: 'owner-1',
      serviceId: 'slack',
    })
    expect(result).toMatchObject({
      ok: true,
      accessToken: 'xoxb-custom-bot-token',
      isBotToken: true,
    })
  })

  it('rejects a provider mismatch before token refresh or provider access', async () => {
    mocks.providerMatches.mockResolvedValue(false)

    const result = await resolveSlackSelectorCredential(principal, {
      credential: 'credential-1',
      requestId: 'request-1',
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'Select a Slack credential.' })
    expect(mocks.refreshToken).not.toHaveBeenCalled()
  })

  it('requires workflow scope for a direct bot token', async () => {
    const result = await resolveSlackSelectorCredential(principal, {
      credential: 'xoxb-literal-secret',
      requestId: 'request-1',
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })
    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })

  it('does not reinterpret a referenced non-bot value as an OAuth credential id', async () => {
    mocks.resolveContext.mockResolvedValue({
      ok: true,
      context: { credential: 'not-a-bot-token' },
      requesterUserId: 'viewer-1',
      workspaceId: 'workspace-1',
    })

    const result = await resolveSlackSelectorCredential(principal, {
      credential: '{{SLACK_BOT_TOKEN}}',
      workflowId: 'workflow-1',
      requestId: 'request-1',
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })
    expect(mocks.providerMatches).not.toHaveBeenCalled()
    expect(mocks.refreshToken).not.toHaveBeenCalled()
  })

  it('does not attempt Slack access when a reference is inaccessible', async () => {
    mocks.resolveContext.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })

    const result = await resolveSlackSelectorCredential(principal, {
      credential: '{{INACCESSIBLE_TOKEN}}',
      workflowId: 'workflow-1',
      requestId: 'request-1',
    })

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })
    expect(mocks.providerMatches).not.toHaveBeenCalled()
    expect(mocks.refreshToken).not.toHaveBeenCalled()
  })
})
