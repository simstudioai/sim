import { jsonResponse } from '@sim/testing/helpers/http'
import {
  selectorCredentialBundleMock,
  selectorCredentialBundleMockFns,
} from '@sim/testing/mocks/selector-credential-bundle.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { SelectorContextUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { gaugeSelectorAttachments } from '@/lib/selectors/server/providers/gauge'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import type { SelectorContext, SelectorRequest } from '@/lib/selectors/types'

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => selectorCredentialBundleMock)

function args(
  selectorKey: ServerSelectorKey,
  request: SelectorRequest,
  context: SelectorContext = {}
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: { oauthCredential: 'credential-example', ...context },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace-example' },
    workspaceId: 'workspace-example',
    principal: { kind: 'session', userId: 'user-example', sessionId: 'session-example' },
    requesterUserId: 'user-example',
    credential: { suppliedId: 'credential-example' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('Gauge server resource selectors', () => {
  beforeEach(() => {
    selectorCredentialBundleMockFns.mockResolveSelectorCredentialBundle.mockResolvedValue({
      accessToken: 'server-only-token',
    })
  })

  it('preserves opaque provider cursors without eagerly reading all tracked prompts', async () => {
    const cursor = 'previous/page&trackingType=visibility é'
    const nextCursor = 'next/page'.repeat(512)
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'prm_example', text: 'Example question' }],
        nextCursor,
      })
    )
    vi.stubGlobal('fetch', fetch)

    const result = await gaugeSelectorAttachments['gauge.prompts'].execute(
      args(
        'gauge.prompts',
        { kind: 'list', cursor },
        { organization: 'example', category: 'category' }
      )
    )

    expect(result).toEqual({
      kind: 'list',
      items: [{ id: 'prm_example', label: 'Example question' }],
      nextCursor,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    const requested = new URL(String(fetch.mock.calls[0]?.[0]))
    expect(requested.searchParams.get('cursor')).toBe(cursor)
    expect(requested.searchParams.get('trackingType')).toBe('all')
  })

  it('loads answer options when the provider rejects pages larger than 100', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const limit = Number(new URL(String(input)).searchParams.get('limit'))
        if (limit > 100) {
          return jsonResponse(
            {
              error: {
                code: 'invalid_request',
                message: 'limit must be between 1 and 100',
                field: 'limit',
              },
            },
            400
          )
        }
        return jsonResponse({
          data: [
            {
              id: 'answer-example',
              text: 'Example answer',
              promptId: 'prm_example',
              model: 'example-model',
              day: '2026-11-01',
            },
          ],
          nextCursor: null,
        })
      })
    )

    const result = await gaugeSelectorAttachments['gauge.answers'].execute(
      args('gauge.answers', { kind: 'list' }, { organization: 'example', category: 'category' })
    )

    expect(result).toMatchObject({ kind: 'list', items: [{ id: 'answer-example' }] })
  })

  it('excludes organizations without Chat and projects only resource option fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              id: 'org-chat',
              name: 'Chat workspace',
              products: { chat: true },
              private: 'discard',
            },
            { id: 'org-agents', name: 'Agents workspace', products: { chat: false } },
          ],
        })
      )
    )

    const result = await gaugeSelectorAttachments['gauge.organizations'].execute(
      args('gauge.organizations', { kind: 'list' })
    )

    expect(result).toEqual({ kind: 'list', items: [{ id: 'org-chat', label: 'Chat workspace' }] })
  })

  it('rejects traversal in organization or category before contacting Gauge', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(
      gaugeSelectorAttachments['gauge.topics'].execute(
        args('gauge.topics', { kind: 'list' }, { organization: '..', category: 'category' })
      )
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    await expect(
      gaugeSelectorAttachments['gauge.topics'].execute(
        args('gauge.topics', { kind: 'list' }, { organization: 'example', category: 'a/b' })
      )
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    expect(fetch).not.toHaveBeenCalled()
  })
})
