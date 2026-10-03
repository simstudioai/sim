import {
  selectorCredentialsMock,
  selectorCredentialsMockFns,
} from '@sim/testing/mocks/selector-credentials.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/selectors/server/credentials', () => selectorCredentialsMock)

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { mondaySelectorAttachments } from '@/lib/selectors/server/providers/monday'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const mockResolveSelectorOAuthAccessToken =
  selectorCredentialsMockFns.mockResolveSelectorOAuthAccessToken

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
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('hydrates a selected board through a direct ID lookup', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { boards: [{ id: '9001', name: 'Direct board' }] } }), {
        status: 200,
      })
    )

    await expect(
      mondaySelectorAttachments['monday.boards'].execute({
        ...listArgs(),
        request: { kind: 'detail', id: '9001' },
      })
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: '9001', label: 'Direct board' },
    })
    const body = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body)) as { query: string }
    expect(body.query).toContain('boards(ids: [9001])')
    expect(body.query).not.toContain('limit:')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
