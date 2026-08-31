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
import { mondaySelectorAttachments } from '@/lib/selectors/server/providers/monday'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function listArgs(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'monday.boards',
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

describe('Monday server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('falls back to the provider ID when a board name is empty', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { boards: [{ id: 'board-1', name: '' }] } }), {
        status: 200,
      })
    )

    await expect(mondaySelectorAttachments['monday.boards'].execute(listArgs())).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'board-1', label: 'board-1' }],
    })
  })
})
