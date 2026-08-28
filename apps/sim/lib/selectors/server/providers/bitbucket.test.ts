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

import { SelectorContextUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { bitbucketSelectorAttachments } from '@/lib/selectors/server/providers/bitbucket'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function repositoryArgs(
  overrides: Partial<ExecuteServerSelectorArgs> = {}
): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'bitbucket.repositories',
    context: { oauthCredential: 'credential-1', workspaceSlug: 'acme-platform' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}

function providerResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Bitbucket server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('keeps a referenced workspace server-only while returning an origin-bound page cursor', async () => {
    mockFetch.mockResolvedValueOnce(
      providerResponse({
        values: [
          {
            slug: 'payments-api',
            uuid: '{repository-uuid}',
            name: 'Payments API',
            full_name: 'acme-platform/payments-api',
          },
        ],
        next: 'https://api.bitbucket.org/2.0/repositories/acme-platform?page=2&pagelen=100',
      })
    )

    const result = await bitbucketSelectorAttachments['bitbucket.repositories'].execute(
      repositoryArgs({
        references: new Map([
          [
            'workspaceSlug',
            {
              field: 'workspaceSlug',
              name: 'BITBUCKET_WORKSPACE',
              scope: 'workspace',
              visible: false,
            },
          ],
        ]),
      })
    )

    expect(result).toEqual({
      kind: 'list',
      items: [
        {
          id: 'payments-api',
          label: 'Payments API',
          meta: { slug: 'payments-api', uuid: '{repository-uuid}' },
        },
      ],
      nextCursor: 'page=2',
    })
    const requestUrl = new URL(String(mockFetch.mock.calls[0]?.[0]))
    expect(requestUrl.origin).toBe('https://api.bitbucket.org')
    expect(requestUrl.pathname).toBe('/2.0/repositories/acme-platform')
    expect(new Headers(mockFetch.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer server-only-token'
    )
  })

  it('rejects a cursor that attempts to select another destination before resolving a token', async () => {
    await expect(
      bitbucketSelectorAttachments['bitbucket.repositories'].execute(
        repositoryArgs({
          request: {
            kind: 'list',
            cursor: 'https://evil.example/2.0/repositories/acme-platform?page=2',
          },
        })
      )
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)

    expect(mockResolveSelectorOAuthAccessToken).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
