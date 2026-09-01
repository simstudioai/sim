/**
 * @vitest-environment node
 */
import { account } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchProviderJson, mockResolveSelectorOAuthAccessToken } = vi.hoisted(() => ({
  mockFetchProviderJson: vi.fn(),
  mockResolveSelectorOAuthAccessToken: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/provider-http', () => ({
  fetchProviderJson: mockFetchProviderJson,
}))

vi.mock('@/lib/selectors/server/credentials', () => ({
  resolveSelectorOAuthAccessToken: mockResolveSelectorOAuthAccessToken,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { slackSelectorAttachments } from '@/lib/selectors/server/providers/slack'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function channelArgs(signal?: AbortSignal): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'slack.channels',
    context: { oauthCredential: 'credential-1' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1', fixedToken: 'xoxb-server-only-token' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal,
  }
}

describe('Slack server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('xoxb-server-only-token')
  })

  it('uses the bounded provider reader and does not fall back after caller cancellation', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort(abortError)
    mockFetchProviderJson.mockRejectedValue(abortError)

    await expect(
      slackSelectorAttachments['slack.channels'].execute(channelArgs(controller.signal))
    ).rejects.toBe(abortError)

    expect(mockFetchProviderJson).toHaveBeenCalledOnce()
    expect(mockFetchProviderJson.mock.calls[0]?.[0]).toBeInstanceOf(URL)
  })

  it('does not return a public-only fallback when membership lookup is cancelled', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    queueTableRows(account, [
      { accountId: 'slack-usr_U12345678-123e4567-e89b-12d3-a456-426614174000' },
    ])
    mockFetchProviderJson
      .mockResolvedValueOnce({
        ok: true,
        channels: [{ id: 'C123', name: 'general', is_private: false }],
      })
      .mockImplementationOnce(async () => {
        controller.abort(abortError)
        throw abortError
      })
    const args = channelArgs(controller.signal)
    args.credential = {
      suppliedId: 'credential-1',
      access: {
        ok: true,
        credentialOwnerUserId: 'owner-1',
        resolvedCredentialId: 'credential-1',
        credentialType: 'oauth',
      },
    }

    await expect(slackSelectorAttachments['slack.channels'].execute(args)).rejects.toBe(abortError)
    expect(mockFetchProviderJson).toHaveBeenCalledTimes(2)
  })
})
