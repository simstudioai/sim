/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveCredentialBundle } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveCredentialBundle: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mockResolveCredentialBundle,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { harmonicSelectorAttachments } from '@/lib/selectors/server/providers/harmonic'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function detailArgs(id: string): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'harmonic.savedSearches',
    context: { oauthCredential: 'credential-1' },
    request: { kind: 'detail', id },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('Harmonic server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveCredentialBundle.mockResolvedValue({ accessToken: 'server-only-token' })
  })

  afterAll(() => vi.unstubAllGlobals())

  it('hydrates a selected saved search after the list projection cap', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      entity_urn: `urn:harmonic:saved_search:${index + 1}`,
      name: `Search ${index + 1}`,
      type: 'PERSONS',
    }))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(rows), { status: 200 }))

    await expect(
      harmonicSelectorAttachments['harmonic.savedSearches'].execute(detailArgs('501'))
    ).resolves.toMatchObject({
      kind: 'detail',
      item: {
        id: '501',
        label: 'Search 501',
        meta: {
          id: '501',
          urn: 'urn:harmonic:saved_search:501',
          name: 'Search 501',
        },
      },
      diagnostics: { truncated: { reason: 'provider-cap', limit: 500 } },
    })
  })
})
