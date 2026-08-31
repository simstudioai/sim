/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveSelectorAtlassianCloudId, mockResolveSelectorCredentialBundle } =
  vi.hoisted(() => ({
    mockFetch: vi.fn(),
    mockResolveSelectorAtlassianCloudId: vi.fn(),
    mockResolveSelectorCredentialBundle: vi.fn(),
  }))

vi.mock('@/lib/selectors/server/providers/atlassian', () => ({
  resolveSelectorAtlassianCloudId: mockResolveSelectorAtlassianCloudId,
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mockResolveSelectorCredentialBundle,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { jiraSelectorAttachments } from '@/lib/selectors/server/providers/jira'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'jira.projects',
    context: { oauthCredential: 'credential-1', domain: 'acme.atlassian.net' },
    request: { kind: 'list', search: 'payments', cursor: '50' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('Jira server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorCredentialBundle.mockResolvedValue({ accessToken: 'server-only-token' })
    mockResolveSelectorAtlassianCloudId.mockResolvedValue('cloud-1')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('returns one project page and preserves provider search and continuation', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          values: Array.from({ length: 50 }, (_, index) => ({
            id: `project-${index + 1}`,
            name: `Payments ${index + 1}`,
          })),
          maxResults: 50,
          isLast: false,
        }),
        { status: 200 }
      )
    )

    await expect(jiraSelectorAttachments['jira.projects'].execute(args())).resolves.toEqual({
      kind: 'list',
      items: Array.from({ length: 50 }, (_, index) => ({
        id: `project-${index + 1}`,
        label: `Payments ${index + 1}`,
      })),
      nextCursor: '100',
    })
    const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
    expect(url.searchParams.get('query')).toBe('payments')
    expect(url.searchParams.get('startAt')).toBe('50')
    expect(url.searchParams.get('maxResults')).toBe('50')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
