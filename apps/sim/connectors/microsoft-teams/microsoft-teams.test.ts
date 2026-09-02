/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ MicrosoftTeamsIcon: () => null }))

import { microsoftTeamsConnector } from '@/connectors/microsoft-teams/microsoft-teams'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const TEAM_ID = 'team-1'
const CHANNELS_URL = `${GRAPH}/teams/${TEAM_ID}/channels?$select=id,displayName,description`

interface GraphRoute {
  status?: number
  body?: unknown
}

/** Installs a URL-keyed fake Graph; unrouted URLs reply 404. */
function mockGraph(routes: Record<string, GraphRoute>) {
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    const route = routes[url] ?? { status: 404 }
    const status = route.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body,
      text: async () => JSON.stringify(route.body ?? {}),
    } as unknown as Response
  })
}

async function listingError(): Promise<unknown> {
  return microsoftTeamsConnector
    .listDocuments('token', { teamId: TEAM_ID, channel: 'General' })
    .catch((error: unknown) => error)
}

describe('microsoft teams listing scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([403, 404])(
    'reads a %s on the configured team as a scope the caller cannot reach',
    async (status) => {
      mockGraph({ [CHANNELS_URL]: { status, body: {} } })

      const error = await listingError()

      expect(error).toBeInstanceOf(Error)
      expect(microsoftTeamsConnector.isListingScopeUnavailableError!(error)).toBe(true)
    }
  )

  it('reads a channel the caller cannot see as a scope they cannot reach', async () => {
    mockGraph({
      [CHANNELS_URL]: { body: { value: [{ id: 'c1', displayName: 'Announcements' }] } },
    })

    const error = await listingError()

    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toMatch(/Channel not found: General/)
    expect(microsoftTeamsConnector.isListingScopeUnavailableError!(error)).toBe(true)
  })

  it('keeps any other listing failure retryable', async () => {
    mockGraph({ [CHANNELS_URL]: { status: 500, body: {} } })

    const error = await listingError()

    expect(error).toBeInstanceOf(Error)
    expect(microsoftTeamsConnector.isListingScopeUnavailableError!(error)).toBe(false)
  })
})

describe('microsoft teams per-member listing of several channels', () => {
  const messagesUrl = (channelId: string) =>
    `${GRAPH}/teams/${TEAM_ID}/channels/${channelId}/messages?$top=50&$expand=replies`

  function teamsMessage(id: string) {
    return {
      id,
      messageType: 'message',
      createdDateTime: '2026-01-01T00:00:00Z',
      from: { user: { id: 'u1', displayName: 'Ada' } },
      body: { contentType: 'text', content: `hello from ${id}` },
    }
  }

  /** General is readable, Private answers 403 on its messages, Secret is not listed at all. */
  function mockChannels() {
    mockGraph({
      [CHANNELS_URL]: {
        body: {
          value: [
            { id: 'c1', displayName: 'General' },
            { id: 'c2', displayName: 'Private' },
          ],
        },
      },
      [messagesUrl('c1')]: { body: { value: [teamsMessage('m1')] } },
      [messagesUrl('c2')]: { status: 403, body: {} },
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips the channels the member cannot reach and keeps the rest', async () => {
    mockChannels()

    const result = await microsoftTeamsConnector.listDocuments(
      'token',
      { teamId: TEAM_ID, channel: ['General', 'Private', 'Secret'] },
      undefined,
      { ...PER_MEMBER_LISTING_CONTEXT }
    )

    expect(result.documents.map((doc) => doc.externalId)).toEqual(['c1'])
    expect(result.hasMore).toBe(false)
  })

  it('still fails a shared listing when one of several channels is unreachable', async () => {
    mockChannels()

    const error = await microsoftTeamsConnector
      .listDocuments('token', { teamId: TEAM_ID, channel: ['General', 'Private'] }, undefined, {})
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(microsoftTeamsConnector.isListingScopeUnavailableError!(error)).toBe(true)
  })

  it('reads a sole unreachable channel as the whole scope', async () => {
    mockChannels()

    const error = await microsoftTeamsConnector
      .listDocuments('token', { teamId: TEAM_ID, channel: 'Private' }, undefined, {
        ...PER_MEMBER_LISTING_CONTEXT,
      })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(microsoftTeamsConnector.isListingScopeUnavailableError!(error)).toBe(true)
  })
})
