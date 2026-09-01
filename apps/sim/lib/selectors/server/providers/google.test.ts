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
  selectorKey: 'google.tasks.lists' | 'google.calendar',
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

  it('returns one task-list page and preserves the continuation token', async () => {
    const items = Array.from({ length: 1_000 }, (_, index) => ({
      id: `task-list-${index}`,
      title: `Task list ${index}`,
    }))
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items, nextPageToken: 'page-1' }), { status: 200 })
    )

    const result = await googleSelectorAttachments['google.tasks.lists'].execute(
      listArgs('google.tasks.lists')
    )

    expect(result).toMatchObject({ kind: 'list', nextCursor: 'page-1' })
    expect(result.kind === 'list' ? result.items : []).toHaveLength(1_000)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('forwards a Google continuation token on demand', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [{ id: 'calendar-2', summary: 'Calendar 2' }],
          nextPageToken: 'page-3',
        }),
        { status: 200 }
      )
    )

    await expect(
      googleSelectorAttachments['google.calendar'].execute(listArgs('google.calendar', 'page-2'))
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'calendar-2', label: 'Calendar 2' }],
      nextCursor: 'page-3',
    })
    expect(new URL(String(mockFetch.mock.calls[0]?.[0])).searchParams.get('pageToken')).toBe(
      'page-2'
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('hydrates a selected calendar without traversing the calendar list', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'team@example.com', summary: 'Team calendar' }), {
        status: 200,
      })
    )

    await expect(
      googleSelectorAttachments['google.calendar'].execute({
        ...listArgs('google.calendar'),
        request: { kind: 'detail', id: 'team@example.com' },
      })
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: 'team@example.com', label: 'Team calendar' },
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/calendars/team%40example.com')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
