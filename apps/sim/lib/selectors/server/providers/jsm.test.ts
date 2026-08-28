/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveJsmAuth, mockResolveCloudId } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveJsmAuth: vi.fn(),
  mockResolveCloudId: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mockResolveJsmAuth,
}))

vi.mock('@/lib/selectors/server/providers/atlassian', () => ({
  resolveSelectorAtlassianCloudId: mockResolveCloudId,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { jsmSelectorAttachments } from '@/lib/selectors/server/providers/jsm'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function serviceDeskArgs(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'jsm.serviceDesks',
    context: { oauthCredential: 'credential-1', domain: 'example.atlassian.net' },
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

function providerResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('JSM server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveJsmAuth.mockResolvedValue({ accessToken: 'server-only-token' })
    mockResolveCloudId.mockResolvedValue('cloud-1')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('advances short pages by their returned row count and normalizes every option', async () => {
    mockFetch
      .mockResolvedValueOnce(
        providerResponse({
          values: [{ id: '1', projectName: 'One' }],
          _links: { next: 'next' },
        })
      )
      .mockResolvedValueOnce(
        providerResponse({
          values: [{ id: '2', projectName: 'Two' }],
          isLastPage: true,
        })
      )

    await expect(
      jsmSelectorAttachments['jsm.serviceDesks'].execute(serviceDeskArgs())
    ).resolves.toEqual({
      kind: 'list',
      items: [
        { id: '1', label: 'One' },
        { id: '2', label: 'Two' },
      ],
    })

    const firstUrl = new URL(String(mockFetch.mock.calls[0]?.[0]))
    const secondUrl = new URL(String(mockFetch.mock.calls[1]?.[0]))
    expect(firstUrl.search).toBe('?start=0&limit=100')
    expect(secondUrl.search).toBe('?start=1&limit=100')
  })
})
