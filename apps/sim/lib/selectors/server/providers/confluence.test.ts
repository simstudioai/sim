/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveCredentialBundle, mockResolveCloudId } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveCredentialBundle: vi.fn(),
  mockResolveCloudId: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mockResolveCredentialBundle,
}))

vi.mock('@/lib/selectors/server/providers/atlassian', () => ({
  resolveSelectorAtlassianCloudId: mockResolveCloudId,
}))

import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { confluenceSelectorAttachments } from '@/lib/selectors/server/providers/confluence'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function pageDetailArgs(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'confluence.pages',
    context: { oauthCredential: 'credential-1', domain: 'acme.atlassian.net' },
    request: { kind: 'detail', id: 'page-1' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('Confluence server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveCredentialBundle.mockResolvedValue({ accessToken: 'server-only-token' })
    mockResolveCloudId.mockResolvedValue('cloud-1')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('hydrates page details through the bounded provider reader without requesting page bodies', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'page-1', title: 'Architecture' }), { status: 200 })
    )

    await expect(
      confluenceSelectorAttachments['confluence.pages'].execute(pageDetailArgs())
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: 'page-1', label: 'Architecture' },
    })

    const requestedUrl = String(mockFetch.mock.calls[0]?.[0])
    expect(requestedUrl).toBe(
      'https://api.atlassian.com/ex/confluence/cloud-1/wiki/api/v2/pages/page-1'
    )
    expect(requestedUrl).not.toContain('body-format')
  })

  it('rejects an oversized page detail response before parsing it', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
      })
    )

    await expect(
      confluenceSelectorAttachments['confluence.pages'].execute(pageDetailArgs())
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
  })
})
