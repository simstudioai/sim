/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveSelectorOAuthAccessToken } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveSelectorOAuthAccessToken: vi.fn(),
}))

vi.mock('@/lib/selectors/server/credentials', () => ({
  resolveSelectorOAuthAccessToken: mockResolveSelectorOAuthAccessToken,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { notionSelectorAttachments } from '@/lib/selectors/server/providers/notion'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function detailArgs(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'notion.pages',
    context: { oauthCredential: 'credential-1' },
    request: { kind: 'detail', id: '1234567890abcdef1234567890abcdef' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('Notion server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('hydrates a selected page directly without scanning the capped search listing', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: 'page',
          id: 'page-provider-id',
          properties: {
            title: { title: [{ plain_text: 'Planning' }] },
          },
        }),
        { status: 200 }
      )
    )

    await expect(notionSelectorAttachments['notion.pages'].execute(detailArgs())).resolves.toEqual({
      kind: 'detail',
      item: { id: '1234567890abcdef1234567890abcdef', label: 'Planning' },
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      '/v1/pages/1234567890abcdef1234567890abcdef'
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
