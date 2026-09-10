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
  selectorKey: 'google.tasks.lists' | 'google.calendar' | 'google.drive',
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
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it.each(['google-drive', 'google-service-account'])(
    'uses read-only Drive scopes for %s selectors and forwards the delegated subject',
    async (providerId) => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      const args = listArgs('google.drive')
      args.credential = { suppliedId: 'credential-1', providerId }
      args.context.impersonateUserEmail = 'admin@example.com'

      await googleSelectorAttachments['google.drive'].execute(args)

      expect(mockResolveSelectorOAuthAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: 'google-drive',
          scopes: ['https://www.googleapis.com/auth/drive.readonly'],
          impersonateEmail: 'admin@example.com',
        })
      )
    }
  )

  it.each([
    {
      selectorKey: 'gmail.labels' as const,
      body: { labels: [] },
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    },
    {
      selectorKey: 'google.calendar' as const,
      body: { items: [] },
      scopes: ['https://www.googleapis.com/auth/calendar'],
    },
  ])(
    'does not require identity or unrelated workflow grants to browse $selectorKey',
    async ({ selectorKey, body, scopes }) => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body)))
      await googleSelectorAttachments[selectorKey].execute({
        ...listArgs('google.calendar'),
        selectorKey,
      })
      expect(mockResolveSelectorOAuthAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ scopes })
      )
    }
  )

  it('searches shared-drive roots before continuing to matching folders', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ drives: [{ id: 'drive-1', name: "Team's notes" }] }))
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ files: [{ id: 'folder-1', name: "Team's notes folder" }] }))
      )
    const args = listArgs('google.drive')
    args.context.mimeType = 'application/vnd.google-apps.folder'
    args.request = { kind: 'list', search: "Team's notes" }

    await expect(googleSelectorAttachments['google.drive'].execute(args)).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'drive-1', label: "Team's notes" }],
      nextCursor: 'f:',
    })
    args.request = { ...args.request, cursor: 'f:' }
    await expect(googleSelectorAttachments['google.drive'].execute(args)).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'folder-1', label: "Team's notes folder" }],
    })

    const [driveUrl, fileUrl] = mockFetch.mock.calls.map(([url]) => new URL(String(url)))
    expect(driveUrl.pathname).toBe('/drive/v3/drives')
    expect(driveUrl.searchParams.get('q')).toBe("name contains 'Team\\'s notes'")
    expect(fileUrl.pathname).toBe('/drive/v3/files')
    expect(fileUrl.searchParams.get('q')).toContain("name contains 'Team\\'s notes'")
  })

  it('continues a shared-drive search on demand', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ drives: [{ id: 'drive-2', name: 'Engineering' }], nextPageToken: 'next' })
      )
    )
    const args = listArgs('google.drive')
    args.context.mimeType = 'application/vnd.google-apps.folder'
    args.request = { kind: 'list', search: 'Engineering', cursor: 'd:previous' }

    await expect(googleSelectorAttachments['google.drive'].execute(args)).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'drive-2', label: 'Engineering' }],
      nextCursor: 'd:next',
    })
    const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
    expect(url.searchParams.get('pageToken')).toBe('previous')
    expect(url.searchParams.get('q')).toBe("name contains 'Engineering'")
  })

  it('still lists personal folders when the account has no shared drives', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ drives: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ files: [{ id: 'folder-1', name: 'My notes' }] }))
      )
    const args = listArgs('google.drive')
    args.context.mimeType = 'application/vnd.google-apps.folder'

    await expect(googleSelectorAttachments['google.drive'].execute(args)).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'folder-1', label: 'My notes' }],
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockResolveSelectorOAuthAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ impersonateEmail: undefined })
    )
  })

  it('keeps searches inside a selected folder scoped to that folder', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ files: [{ id: 'child-1', name: 'Notes' }] }))
    )
    const args = listArgs('google.drive')
    args.context.mimeType = 'application/vnd.google-apps.folder'
    args.context.fileId = 'parent-1'
    args.request = { kind: 'list', search: 'Notes' }

    await expect(googleSelectorAttachments['google.drive'].execute(args)).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'child-1', label: 'Notes' }],
    })
    const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
    expect(url.pathname).toBe('/drive/v3/files')
    expect(url.searchParams.get('q')).toContain("'parent-1' in parents")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403, 429, 503])(
    'surfaces HTTP %s from shared-drive listing instead of showing an incomplete list',
    async (status) => {
      mockFetch
        .mockResolvedValueOnce(new Response('private provider error', { status }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] })))
      const args = listArgs('google.drive')
      args.context.mimeType = 'application/vnd.google-apps.folder'

      await expect(googleSelectorAttachments['google.drive'].execute(args)).rejects.toMatchObject({
        status: status === 503 ? 502 : status,
      })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    }
  )

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
