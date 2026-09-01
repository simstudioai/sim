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

const SCOPED_ACCOUNT_ID = 'slack-usr_U12345678-123e4567-e89b-12d3-a456-426614174000'

function args(
  selectorKey: 'slack.channels' | 'slack.users',
  request: ExecuteServerSelectorArgs['request'] = { kind: 'list' },
  authentication: 'bot' | 'oauth' = 'bot',
  signal?: AbortSignal
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: { oauthCredential: 'credential-1' },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential:
      authentication === 'bot'
        ? { suppliedId: 'credential-1', fixedToken: 'xoxb-server-only-token' }
        : {
            suppliedId: 'credential-1',
            access: {
              ok: true,
              credentialOwnerUserId: 'owner-1',
              resolvedCredentialId: 'credential-1',
              credentialType: 'oauth',
            },
          },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal,
  }
}

function queueScopedAccount(): void {
  queueTableRows(account, [{ accountId: SCOPED_ACCOUNT_ID }])
}

function requestedUrl(call: number): URL {
  return new URL(String(mockFetchProviderJson.mock.calls[call]?.[0]))
}

function channel(id: string, name: string, isPrivate = false, isMember?: boolean) {
  return { id, name, is_private: isPrivate, ...(isMember ? { is_member: true } : {}) }
}

function user(id: string, name: string, realName?: string) {
  return { id, name, ...(realName ? { real_name: realName } : {}) }
}

function slackPage<T extends Record<string, unknown>>(body: T, nextCursor?: string) {
  return {
    ok: true,
    ...body,
    ...(nextCursor ? { response_metadata: { next_cursor: nextCursor } } : {}),
  }
}

function execute(
  selectorKey: 'slack.channels' | 'slack.users',
  request: ExecuteServerSelectorArgs['request'] = { kind: 'list' },
  authentication: 'bot' | 'oauth' = 'bot',
  signal?: AbortSignal
) {
  return slackSelectorAttachments[selectorKey].execute(
    args(selectorKey, request, authentication, signal)
  )
}

describe('Slack server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('xoxb-server-only-token')
  })

  it('does not fall back after channel listing is cancelled', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort(abortError)
    mockFetchProviderJson.mockRejectedValue(abortError)

    await expect(
      execute('slack.channels', { kind: 'list' }, 'bot', controller.signal)
    ).rejects.toBe(abortError)

    expect(mockFetchProviderJson).toHaveBeenCalledOnce()
    expect(mockFetchProviderJson.mock.calls[0]?.[0]).toBeInstanceOf(URL)
  })

  it('does not return a public-only fallback when membership lookup is cancelled', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    queueScopedAccount()
    mockFetchProviderJson
      .mockResolvedValueOnce(slackPage({ channels: [channel('C123', 'general')] }))
      .mockImplementationOnce(async () => {
        controller.abort(abortError)
        throw abortError
      })

    await expect(
      execute('slack.channels', { kind: 'list' }, 'oauth', controller.signal)
    ).rejects.toBe(abortError)
    expect(mockFetchProviderJson).toHaveBeenCalledTimes(2)
  })

  it('continues a short users page only when its returned cursor is requested', async () => {
    mockFetchProviderJson
      .mockResolvedValueOnce(
        slackPage({ members: [user('U001', 'first', 'First User')] }, 'users-page-2')
      )
      .mockResolvedValueOnce(slackPage({ members: [user('U002', 'second', 'Second User')] }))

    const first = await execute('slack.users')
    expect(first).toMatchObject({
      kind: 'list',
      items: [{ id: 'U001', label: 'First User' }],
      nextCursor: expect.any(String),
    })
    if (first.kind !== 'list' || !first.nextCursor) throw new Error('Expected a users cursor')

    await expect(
      execute('slack.users', { kind: 'list', cursor: first.nextCursor })
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'U002', label: 'Second User' }],
    })
    expect(requestedUrl(0).searchParams.has('cursor')).toBe(false)
    expect(requestedUrl(1).searchParams.get('cursor')).toBe('users-page-2')
  })

  it('continues public and installing-user private channel streams independently', async () => {
    queueScopedAccount()
    queueScopedAccount()
    mockFetchProviderJson
      .mockResolvedValueOnce(
        slackPage(
          {
            channels: [channel('C001', 'general'), channel('G001', 'bot-only', true, true)],
          },
          'conversations-page-2'
        )
      )
      .mockResolvedValueOnce(slackPage({ channels: [] }, 'memberships-page-2'))
      .mockResolvedValueOnce(slackPage({ channels: [channel('C002', 'announcements')] }))
      .mockResolvedValueOnce(
        slackPage({ channels: [channel('G002', 'installing-user-private', true)] })
      )

    const first = await execute('slack.channels', { kind: 'list' }, 'oauth')
    expect(first).toMatchObject({
      kind: 'list',
      items: [{ id: 'C001', label: '#general' }],
      nextCursor: expect.any(String),
    })
    if (first.kind !== 'list' || !first.nextCursor) throw new Error('Expected a channels cursor')

    await expect(
      execute('slack.channels', { kind: 'list', cursor: first.nextCursor }, 'oauth')
    ).resolves.toEqual({
      kind: 'list',
      items: [
        { id: 'C002', label: '#announcements' },
        { id: 'G002', label: '#installing-user-private' },
      ],
    })
    expect(requestedUrl(2).searchParams.get('cursor')).toBe('conversations-page-2')
    expect(requestedUrl(3).searchParams.get('cursor')).toBe('memberships-page-2')
  })

  it('fails closed for private list and detail results when membership cannot be verified', async () => {
    queueScopedAccount()
    queueScopedAccount()
    mockFetchProviderJson
      .mockResolvedValueOnce(
        slackPage({
          channels: [channel('C001', 'general'), channel('G001', 'private', true, true)],
        })
      )
      .mockRejectedValueOnce(new Error('membership lookup failed'))
      .mockResolvedValueOnce(slackPage({ channel: channel('G001', 'private', true, true) }))
      .mockRejectedValueOnce(new Error('member list failed'))

    await expect(execute('slack.channels', { kind: 'list' }, 'oauth')).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'C001', label: '#general' }],
    })
    await expect(
      execute('slack.channels', { kind: 'detail', id: 'G001' }, 'oauth')
    ).resolves.toEqual({ kind: 'detail', item: null })
  })

  it('preserves bot-only fallback without allowing its cursor under scoped OAuth', async () => {
    mockFetchProviderJson
      .mockRejectedValueOnce(new Error('private scope unavailable'))
      .mockResolvedValueOnce(slackPage({ channels: [channel('C001', 'general')] }, 'public-page-2'))

    const botResult = await execute('slack.channels')
    expect(botResult).toMatchObject({
      kind: 'list',
      items: [{ id: 'C001', label: '#general' }],
      nextCursor: expect.any(String),
    })
    expect(requestedUrl(0).searchParams.get('types')).toBe('public_channel,private_channel')
    expect(requestedUrl(1).searchParams.get('types')).toBe('public_channel')
    if (botResult.kind !== 'list' || !botResult.nextCursor) {
      throw new Error('Expected a public-only bot cursor')
    }

    queueTableRows(account, [])
    mockFetchProviderJson.mockRejectedValueOnce(new Error('OAuth list failed'))
    await expect(execute('slack.channels', { kind: 'list' }, 'oauth')).rejects.toMatchObject({
      name: 'SelectorOptionsUnavailableError',
    })

    queueScopedAccount()
    await expect(
      execute('slack.channels', { kind: 'list', cursor: botResult.nextCursor }, 'oauth')
    ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    expect(mockFetchProviderJson).toHaveBeenCalledTimes(3)
  })

  it('hydrates saved users and installing-user private channels directly by id', async () => {
    mockFetchProviderJson.mockResolvedValueOnce(
      slackPage({ user: user('U999', 'saved', 'Saved User') })
    )
    await expect(execute('slack.users', { kind: 'detail', id: 'U999' })).resolves.toEqual({
      kind: 'detail',
      item: { id: 'U999', label: 'Saved User' },
    })

    queueScopedAccount()
    mockFetchProviderJson
      .mockResolvedValueOnce(slackPage({ channel: channel('G999', 'saved-private', true, true) }))
      .mockResolvedValueOnce(slackPage({ members: ['UOTHER'] }, 'members-page-2'))
      .mockResolvedValueOnce(slackPage({ members: ['U12345678'] }))
    await expect(
      execute('slack.channels', { kind: 'detail', id: 'G999' }, 'oauth')
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: 'G999', label: '#saved-private' },
    })

    expect(
      mockFetchProviderJson.mock.calls.map((_, index) => requestedUrl(index).pathname)
    ).toEqual([
      '/api/users.info',
      '/api/conversations.info',
      '/api/conversations.members',
      '/api/conversations.members',
    ])
    expect(requestedUrl(3).searchParams.get('cursor')).toBe('members-page-2')
  })
})
