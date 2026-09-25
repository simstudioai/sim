import {
  selectorCredentialBundleMock,
  selectorCredentialBundleMockFns,
} from '@sim/testing/mocks/selector-credential-bundle.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => selectorCredentialBundleMock)

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { pipedriveSelectorAttachments } from '@/lib/selectors/server/providers/pipedrive'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const mockResolveSelectorCredentialBundle =
  selectorCredentialBundleMockFns.mockResolveSelectorCredentialBundle

function args(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'pipedrive.pipelines',
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

describe('Pipedrive server selector adapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorCredentialBundle.mockResolvedValue({ accessToken: 'server-only-token' })
  })

  afterAll(() => vi.unstubAllGlobals())

  it('rejects a semantic failure instead of returning an empty pipeline list', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: 'Requested service is not available',
          error_info: 'Please check developers.pipedrive.com',
          data: null,
          additional_data: null,
        }),
        { status: 200 }
      )
    )

    await expect(
      pipedriveSelectorAttachments['pipedrive.pipelines'].execute(args())
    ).rejects.toMatchObject({ name: 'SelectorOptionsUnavailableError' })
  })
})
