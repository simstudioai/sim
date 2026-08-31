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

import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { googleSelectorAttachments } from '@/lib/selectors/server/providers/google'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function driveDetailArgs(signal?: AbortSignal): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'google.drive',
    context: { oauthCredential: 'credential-1' },
    request: { kind: 'detail', id: 'drive-item-1' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal,
  }
}

function listArgs(
  selectorKey: 'google.tasks.lists' | 'google.calendar'
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: { oauthCredential: 'credential-1' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('Google server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('uses the bounded 404 path before hydrating a shared drive', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('not forwarded', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'drive-item-1', name: 'Shared drive' }), {
          status: 200,
        })
      )

    await expect(
      googleSelectorAttachments['google.drive'].execute(driveDetailArgs())
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: 'drive-item-1', label: 'Shared drive' },
    })

    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/drive/v3/files/drive-item-1')
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain('/drive/v3/drives/drive-item-1')
  })

  it('preserves caller cancellation during detail hydration', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort()
    mockFetch.mockRejectedValueOnce(abortError)

    await expect(
      googleSelectorAttachments['google.drive'].execute(driveDetailArgs(controller.signal))
    ).rejects.toBe(abortError)
  })

  it('stops draining task lists as soon as the selector option budget is full', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = new URL(String(input))
      const page = Number(url.searchParams.get('pageToken')?.replace('page-', '') ?? '0')
      const items = Array.from({ length: 1_000 }, (_, index) => ({
        id: `task-list-${page}-${index}`,
        title: `Task list ${page}-${index}`,
      }))
      return new Response(JSON.stringify({ items, nextPageToken: `page-${page + 1}` }), {
        status: 200,
      })
    })

    const result = await googleSelectorAttachments['google.tasks.lists'].execute(
      listArgs('google.tasks.lists')
    )

    expect(result).toMatchObject({
      kind: 'list',
      diagnostics: {
        truncated: { reason: 'provider-cap', limit: MAX_SELECTOR_OPTIONS, pages: 10 },
      },
    })
    expect(result.kind === 'list' ? result.items : []).toHaveLength(MAX_SELECTOR_OPTIONS)
    expect(mockFetch).toHaveBeenCalledTimes(10)
  })

  it('reports a residual Google token when the page cap is reached', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = new URL(String(input))
      const page = Number(url.searchParams.get('pageToken')?.replace('page-', '') ?? '0')
      return new Response(
        JSON.stringify({
          items: [{ id: `calendar-${page}`, summary: `Calendar ${page}` }],
          nextPageToken: `page-${page + 1}`,
        }),
        { status: 200 }
      )
    })

    await expect(
      googleSelectorAttachments['google.calendar'].execute(listArgs('google.calendar'))
    ).resolves.toMatchObject({
      kind: 'list',
      diagnostics: {
        truncated: { reason: 'provider-cap', limit: MAX_SELECTOR_OPTIONS, pages: 20 },
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(20)
  })
})
