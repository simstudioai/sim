/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolveSlackCredential: vi.fn(),
}))

vi.mock('@/lib/selectors/server/resolve-authorized-context', () => ({
  authenticateSelectorRequest: mocks.authenticate,
}))

vi.mock('@/lib/selectors/server/slack-credential', () => ({
  resolveSlackSelectorCredential: mocks.resolveSlackCredential,
}))

import { POST as listChannels } from '@/app/api/tools/slack/channels/route'
import { POST as listUsers } from '@/app/api/tools/slack/users/route'

function request(path: string, body: unknown) {
  return createMockRequest('POST', body, {}, `http://localhost:3000${path}`)
}

describe('server-resolved Slack selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue({
      ok: true,
      principal: { kind: 'session', userId: 'viewer-1', sessionId: 'session-1' },
    })
    mocks.resolveSlackCredential.mockResolvedValue({
      ok: true,
      accessToken: 'xoxb-resolved',
      isBotToken: true,
    })
  })

  it('authenticates before parsing malformed requests', async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })

    const response = await listChannels(request('/api/tools/slack/channels', {}))

    expect(response.status).toBe(401)
    expect(mocks.resolveSlackCredential).not.toHaveBeenCalled()
  })

  it('passes raw references to the authorized credential resolver and short-circuits denial', async () => {
    mocks.resolveSlackCredential.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Unable to resolve selector configuration',
    })
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)

    const response = await listChannels(
      request('/api/tools/slack/channels', {
        credential: '{{INACCESSIBLE_TOKEN}}',
        workflowId: 'workflow-1',
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.resolveSlackCredential).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        credential: '{{INACCESSIBLE_TOKEN}}',
        workflowId: 'workflow-1',
      })
    )
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['channels', listChannels, '/api/tools/slack/channels'],
    ['users', listUsers, '/api/tools/slack/users'],
  ])(
    'preserves the reauthorization marker from the %s credential resolver',
    async (_name, handler, path) => {
      mocks.resolveSlackCredential.mockResolvedValue({
        ok: false,
        status: 401,
        error: 'Could not retrieve access token',
        authRequired: true,
      })
      const providerFetch = vi.fn()
      vi.stubGlobal('fetch', providerFetch)

      const response = await handler(request(path, { credential: 'credential-1' }))

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: 'Could not retrieve access token',
        authRequired: true,
      })
      expect(providerFetch).not.toHaveBeenCalled()
    }
  )

  it('supports a workflowless stored credential through the route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: true,
          channels: [{ id: 'C111', name: 'general', is_private: false, is_archived: false }],
          response_metadata: { next_cursor: '' },
        })
      )
    )

    const response = await listChannels(
      request('/api/tools/slack/channels', { credential: 'credential-1' })
    )

    expect(response.status).toBe(200)
    expect(mocks.resolveSlackCredential).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credential: 'credential-1', workflowId: undefined })
    )
  })

  it('paginates channels and preserves bot-token private-channel filtering', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            ok: true,
            channels: [
              {
                id: 'C111',
                name: 'general',
                is_private: false,
                is_archived: false,
                is_member: false,
              },
              {
                id: 'G222',
                name: 'private-member',
                is_private: true,
                is_archived: false,
                is_member: true,
              },
              {
                id: 'G333',
                name: 'private-not-member',
                is_private: true,
                is_archived: false,
                is_member: false,
              },
            ],
            response_metadata: { next_cursor: 'page-2' },
          })
        )
        .mockResolvedValueOnce(
          Response.json({
            ok: true,
            channels: [
              {
                id: 'C444',
                name: 'announcements',
                is_private: false,
                is_archived: false,
                is_member: false,
              },
            ],
            response_metadata: { next_cursor: '' },
          })
        )
    )

    const response = await listChannels(
      request('/api/tools/slack/channels', {
        credential: 'xoxb-literal-secret',
        workflowId: 'workflow-1',
      })
    )

    expect(await response.json()).toEqual({
      channels: [
        { id: 'C111', name: 'general', isPrivate: false },
        { id: 'G222', name: 'private-member', isPrivate: true },
        { id: 'C444', name: 'announcements', isPrivate: false },
      ],
    })
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('cursor=page-2')
  })

  it('maps users and filters deleted users and bots', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: true,
          members: [
            { id: 'U111', name: 'bill', real_name: 'Bill', deleted: false, is_bot: false },
            { id: 'U222', name: 'bot', real_name: 'Bot', deleted: false, is_bot: true },
            { id: 'U333', name: 'old', real_name: 'Old', deleted: true, is_bot: false },
          ],
          response_metadata: { next_cursor: '' },
        })
      )
    )

    const response = await listUsers(
      request('/api/tools/slack/users', {
        credential: '{{SLACK_BOT_TOKEN}}',
        workflowId: 'workflow-1',
      })
    )

    expect(await response.json()).toEqual({
      users: [{ id: 'U111', name: 'bill', real_name: 'Bill' }],
    })
  })
})
