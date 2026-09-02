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
