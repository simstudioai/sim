/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findViewerSlackCredentialId: vi.fn(),
  resolveManagedOAuthToken: vi.fn(),
  searchSlack: vi.fn(),
}))

vi.mock('@/lib/slack-search/credentials', () => ({
  findViewerSlackCredentialId: mocks.findViewerSlackCredentialId,
}))
vi.mock('@/lib/slack-search/client', () => ({
  searchSlack: mocks.searchSlack,
}))
vi.mock('@/lib/credentials/managed-oauth', async () => {
  const actual = await import('@/lib/credentials/managed-oauth')
  return { ...actual, resolveManagedOAuthToken: mocks.resolveManagedOAuthToken }
})

import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import { searchSlackForViewer } from '@/lib/slack-search/search'

const RESULT = {
  channelId: 'C1',
  messageTs: '1700000200.000100',
  channelName: 'general',
  authorName: 'Ada',
  text: 'green',
  permalink: 'https://example.slack.com/archives/C1/p1',
  sentAt: null,
  isAuthorBot: false,
}

const params = { workspaceId: 'ws-1', userId: 'user-1', query: 'deploy' }

beforeEach(() => {
  mocks.findViewerSlackCredentialId.mockReset().mockResolvedValue('cred-1')
  mocks.resolveManagedOAuthToken
    .mockReset()
    .mockResolvedValue({ accessToken: 'xoxp', refreshed: false })
  mocks.searchSlack.mockReset().mockResolvedValue([RESULT])
})

describe('searchSlackForViewer', () => {
  it('searches Slack under the asking person’s own token', async () => {
    await expect(searchSlackForViewer(params)).resolves.toEqual({
      status: 'ok',
      results: [RESULT],
    })
    expect(mocks.searchSlack).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'xoxp', query: 'deploy' })
    )
  })

  it('only ever asks for the search scopes', async () => {
    await searchSlackForViewer(params)
    const { requiredScopes } = mocks.resolveManagedOAuthToken.mock.calls[0][0]
    expect(requiredScopes).toEqual([
      'search:read.public',
      'search:read.private',
      'search:read.im',
      'search:read.mpim',
    ])
  })

  it('reports a person who has not connected Slack, without calling Slack', async () => {
    mocks.findViewerSlackCredentialId.mockResolvedValue(null)
    await expect(searchSlackForViewer(params)).resolves.toEqual({ status: 'not_connected' })
    expect(mocks.resolveManagedOAuthToken).not.toHaveBeenCalled()
    expect(mocks.searchSlack).not.toHaveBeenCalled()
  })

  it.each([
    ['MANAGED_CREDENTIAL_NEEDS_REAUTH', 'needs_reauth'],
    ['MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE', 'needs_reauth'],
    ['MANAGED_CREDENTIAL_REVOKED', 'needs_reauth'],
    ['MANAGED_CREDENTIAL_NOT_FOUND', 'not_connected'],
    ['MANAGED_CREDENTIAL_REFRESH_FAILED', 'unavailable'],
  ] as const)('turns %s into %s', async (code, status) => {
    mocks.resolveManagedOAuthToken.mockRejectedValue(
      new ManagedOAuthCredentialError(code, 'nope', 401)
    )
    await expect(searchSlackForViewer(params)).resolves.toEqual({ status })
  })

  it('absorbs a Slack failure rather than taking the search down with it', async () => {
    mocks.searchSlack.mockRejectedValue(new Error('ratelimited'))
    await expect(searchSlackForViewer(params)).resolves.toEqual({ status: 'unavailable' })
  })

  it('absorbs an unexpected credential failure', async () => {
    mocks.resolveManagedOAuthToken.mockRejectedValue(new Error('pool exhausted'))
    await expect(searchSlackForViewer(params)).resolves.toEqual({ status: 'unavailable' })
  })
})
