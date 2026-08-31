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
import { microsoftSelectorAttachments } from '@/lib/selectors/server/providers/microsoft'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function listArgs(
  selectorKey: 'microsoft.chats' | 'onedrive.files',
  cursor?: string
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: { oauthCredential: 'credential-1' },
    request: { kind: 'list', ...(cursor ? { cursor } : {}) },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('Microsoft server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('bounds chat label enrichment concurrency', async () => {
    let activeEnrichments = 0
    let maxActiveEnrichments = 0
    mockFetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/me/chats')) {
        return new Response(
          JSON.stringify({
            value: Array.from({ length: 25 }, (_, index) => ({ id: `chat-${index}` })),
          }),
          { status: 200 }
        )
      }
      if (url.includes('/members')) {
        activeEnrichments += 1
        maxActiveEnrichments = Math.max(maxActiveEnrichments, activeEnrichments)
        await Promise.resolve()
        activeEnrichments -= 1
        return new Response(JSON.stringify({ value: [{ displayName: 'Member' }] }), {
          status: 200,
        })
      }
      throw new Error(`Unexpected Microsoft Graph request: ${url}`)
    })

    const result = await microsoftSelectorAttachments['microsoft.chats'].execute(
      listArgs('microsoft.chats')
    )

    expect(result.kind === 'list' ? result.items : []).toHaveLength(25)
    expect(maxActiveEnrichments).toBeLessThanOrEqual(10)
  })

  it('returns one Graph page and follows the continuation URL only on demand', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = new URL(String(input))
      const page = Number(url.searchParams.get('page') ?? '0')
      const value = Array.from({ length: 999 }, (_, index) => ({
        id: `file-${page}-${index}`,
        name: `File ${page}-${index}`,
        file: {},
      }))
      return new Response(
        JSON.stringify({
          value,
          '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/drive/root/children?page=${page + 1}`,
        }),
        { status: 200 }
      )
    })

    const first = await microsoftSelectorAttachments['onedrive.files'].execute(
      listArgs('onedrive.files')
    )

    expect(first).toMatchObject({
      kind: 'list',
      nextCursor: 'https://graph.microsoft.com/v1.0/me/drive/root/children?page=1',
    })
    expect(first.kind === 'list' ? first.items : []).toHaveLength(999)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const second = await microsoftSelectorAttachments['onedrive.files'].execute(
      listArgs('onedrive.files', 'https://graph.microsoft.com/v1.0/me/drive/root/children?page=1')
    )

    expect(second.kind === 'list' ? second.items[0]?.id : undefined).toBe('file-1-0')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('rejects a Graph cursor for another operation', async () => {
    await expect(
      microsoftSelectorAttachments['onedrive.files'].execute(
        listArgs('onedrive.files', 'https://graph.microsoft.com/v1.0/me/chats?$skiptoken=1')
      )
    ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('hydrates a selected drive item without listing its siblings', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'file-1', name: 'Quarterly report.xlsx' }), {
        status: 200,
      })
    )

    await expect(
      microsoftSelectorAttachments['onedrive.files'].execute({
        ...listArgs('onedrive.files'),
        request: { kind: 'detail', id: 'file-1' },
      })
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: 'file-1', label: 'Quarterly report.xlsx' },
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/me/drive/items/file-1')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
