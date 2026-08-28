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
})
