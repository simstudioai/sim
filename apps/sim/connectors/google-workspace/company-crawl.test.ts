import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleApiError } from '@/connectors/google-workspace/api-errors'
import {
  getGoogleWorkspaceDocument,
  InvalidGoogleWorkspaceCursor,
  listGoogleWorkspaceDocuments,
  validateGoogleWorkspaceConfig,
} from '@/connectors/google-workspace/company-crawl'
import type { ConnectorConfig, ExternalDocument } from '@/connectors/types'
import { memberDocumentId } from '@/connectors/utils'

const mockFetch = vi.fn()
const USER = (
  id: string,
  primaryEmail = `${id}@corp.com`,
  extra: Record<string, unknown> = {}
) => ({
  id,
  primaryEmail,
  customerId: 'customer-1',
  suspended: false,
  ...extra,
})
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function directory(users = [USER('alice'), USER('bob')]) {
  mockFetch.mockImplementation(async (address: string) => {
    const url = new URL(address)
    if (url.pathname.endsWith('/users')) return json({ users })
    const key = decodeURIComponent(url.pathname.split('/').at(-1)!)
    const user =
      key === 'admin@corp.com'
        ? USER('admin')
        : users.find((item) => item.id === key || item.primaryEmail === key)
    return user ? json(user) : json({ error: { errors: [{ reason: 'notFound' }] } }, 404)
  })
}
function context() {
  return {
    mirrorsSourceAcls: true,
    getDelegatedAccessToken: vi.fn(async (email: string) => `delegated:${email}`),
  }
}
const CONFIG = { adminEmail: 'admin@corp.com' }
function document(ctx?: Record<string, unknown>, id = 'shared-provider-id'): ExternalDocument {
  return {
    externalId: memberDocumentId(id, ctx),
    title: 'Title',
    content: '',
    contentHash: 'revision-1',
    contentDeferred: true,
    mimeType: 'text/plain',
    acl: ['pub'],
  }
}
const listUserDocuments = vi.fn<ConnectorConfig['listDocuments']>()
function list(
  syncContext: Record<string, unknown>,
  cursor?: string,
  sourceConfig = CONFIG,
  provider: 'gmail' | 'google_calendar' = 'gmail'
) {
  return listGoogleWorkspaceDocuments({
    provider,
    accessToken: 'directory-token',
    sourceConfig,
    syncContext,
    cursor,
    listUserDocuments,
  })
}

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  directory()
  listUserDocuments.mockReset().mockImplementation(async (_token, _config, _cursor, ctx) => ({
    documents: [document(ctx)],
    hasMore: false,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Google Workspace per-user central crawl', () => {
  it('isolates same-ID content and caches for each user, with only that user in its ACL', async () => {
    const ctx = context()
    listUserDocuments.mockImplementation(async (_token, _config, _cursor, child) => {
      expect(child?.cachedLabels).toBeUndefined()
      expect(child?.getDelegatedAccessToken).toBeUndefined()
      expect(child?.mirrorsSourceAcls).toBeUndefined()
      if (child) child.cachedLabels = ['Private mailbox cache']
      return { documents: [document(child)], hasMore: false }
    })
    const alice = await list(ctx)
    const bob = await list(ctx, alice.nextCursor)
    expect(alice.documents[0].externalId).not.toBe(bob.documents[0].externalId)
    expect(alice.documents[0].acl).toEqual(['u:alice@corp.com'])
    expect(bob.documents[0].acl).toEqual(['u:bob@corp.com'])
    expect(bob.hasMore).toBe(false)
    expect(listUserDocuments.mock.calls.map(([token]) => token)).toEqual([
      'delegated:alice@corp.com',
      'delegated:bob@corp.com',
    ])
    expect(alice.currentCursor).not.toContain('delegated')
  })

  it('replays the pinned provider page in a fresh process before advancing its nested cursor', async () => {
    listUserDocuments.mockImplementation(async (_token, _config, cursor, child) => ({
      documents: [document(child)],
      currentCursor: cursor ?? 'fixed-window:first',
      nextCursor: 'fixed-window:second',
      hasMore: true,
    }))
    const first = await list(context())
    mockFetch.mockClear()
    const replay = await list(context(), first.currentCursor)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('/users/alice?')
    expect(listUserDocuments.mock.calls[1][2]).toBe('fixed-window:first')
    expect(replay.documents).toEqual(first.documents)
    expect(replay.currentCursor).toBe(first.currentCursor)
    expect(replay.nextCursor).toBe(first.nextCursor)
  })

  it('clears old hydration authority before a failed subsequent list', async () => {
    const ctx = context()
    const first = await list(ctx)
    listUserDocuments.mockRejectedValueOnce(new Error('Provider quota exhausted'))
    await expect(list(ctx, first.nextCursor)).rejects.toThrow('quota')
    await expect(
      getGoogleWorkspaceDocument({
        provider: 'gmail',
        sourceConfig: CONFIG,
        externalId: first.documents[0].externalId,
        syncContext: ctx,
        getUserDocument: vi.fn(),
      })
    ).rejects.toThrow('verified delegated listing identity')
  })

  it.each([
    USER('different-id'),
    USER('alice', 'alice@corp.com', { customerId: 'other-customer' }),
  ])('fails closed on changed immutable identity or customer', async (changed) => {
    const first = await list(context())
    mockFetch.mockResolvedValueOnce(json(changed))
    const ctx = context()
    await expect(list(ctx, first.currentCursor)).rejects.toThrow('expected customer')
    expect(ctx.getDelegatedAccessToken).not.toHaveBeenCalled()
  })

  it('rejects missing, looping or oversized provider cursors before publishing page authority', async () => {
    for (const page of [
      { hasMore: true },
      { hasMore: true, currentCursor: 'same', nextCursor: 'same' },
      { hasMore: true, nextCursor: 'x'.repeat(256 * 1024 + 1) },
    ]) {
      listUserDocuments.mockImplementationOnce(async (_token, _config, _cursor, child) => ({
        documents: [document(child)],
        ...page,
      }))
      await expect(list(context())).rejects.toThrow()
    }
  })

  it('rejects oversized, malformed, and cross-provider durable cursors', async () => {
    const first = await list(context())
    for (const cursor of ['invalid', 'google-workspace:v1:invalid', 'x'.repeat(384 * 1024 + 1)]) {
      await expect(list(context(), cursor)).rejects.toBeInstanceOf(InvalidGoogleWorkspaceCursor)
    }
    await expect(
      listGoogleWorkspaceDocuments({
        provider: 'google_calendar',
        accessToken: 'directory-token',
        sourceConfig: CONFIG,
        syncContext: context(),
        cursor: first.currentCursor,
        listUserDocuments,
      })
    ).rejects.toBeInstanceOf(InvalidGoogleWorkspaceCursor)
  })

  it('refuses an unscoped provider document or a mismatched hydration result', async () => {
    listUserDocuments.mockResolvedValueOnce({ documents: [document()], hasMore: false })
    await expect(list(context())).rejects.toThrow('verified listing user')
    const ctx = context()
    const first = await list(ctx)
    await expect(
      getGoogleWorkspaceDocument({
        provider: 'gmail',
        sourceConfig: CONFIG,
        externalId: first.documents[0].externalId,
        syncContext: ctx,
        getUserDocument: vi.fn().mockResolvedValue(document()),
      })
    ).rejects.toThrow('different document')
  })

  it('never falls back to an administrator token or accepts source-config delegation', async () => {
    await expect(list({})).rejects.toThrow('delegated Google Workspace')
    await expect(list({ getDelegatedAccessToken: vi.fn() })).rejects.toThrow(
      'delegated Google Workspace'
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([401, 403])(
    'propagates Directory authorization failure %s without declaring completion',
    async (status) => {
      mockFetch.mockResolvedValueOnce(
        json({ error: { errors: [{ reason: 'forbidden' }] } }, status)
      )
      const ctx = context()
      await expect(list(ctx)).rejects.toThrow()
      expect(ctx.getDelegatedAccessToken).not.toHaveBeenCalled()
      expect(listUserDocuments).not.toHaveBeenCalled()
    }
  )

  it('propagates provider truncation so partial results cannot reconcile deletions', async () => {
    listUserDocuments.mockImplementation(async (_token, _config, _cursor, child) => {
      if (child) child.listingCapped = true
      return { documents: [], hasMore: false }
    })
    const ctx: Record<string, unknown> = context()
    await list(ctx)
    expect(ctx.listingCapped).toBe(true)
  })

  it('continues after an unavailable Gmail mailbox and persists the failure across fresh workers', async () => {
    listUserDocuments.mockRejectedValueOnce(
      new GoogleApiError('gmail.threads.list', 400, ['failedPrecondition'])
    )
    const first = await list(context())
    expect(first).toMatchObject({
      documents: [],
      hasMore: true,
      reconciliationSafe: false,
      listingFailures: {
        count: 1,
        samples: [
          {
            scope: 'alice@corp.com',
            operation: 'gmail.threads.list',
            status: 400,
            reasons: ['failedPrecondition'],
          },
        ],
      },
    })
    const second = await list(context(), first.nextCursor)
    expect(second.documents[0].acl).toEqual(['u:bob@corp.com'])
    expect(second).toMatchObject({
      hasMore: false,
      reconciliationSafe: false,
      listingFailures: first.listingFailures,
    })
    expect(listUserDocuments.mock.calls[1][0]).toBe('delegated:bob@corp.com')
  })

  it('revokes the prior page hydration authority when the next user fails', async () => {
    const ctx = context()
    const first = await list(ctx)
    listUserDocuments.mockRejectedValueOnce(
      new GoogleApiError('gmail.threads.list', 400, ['failedPrecondition'])
    )
    await list(ctx, first.nextCursor)
    const hydrate = vi.fn()
    await expect(
      getGoogleWorkspaceDocument({
        provider: 'gmail',
        sourceConfig: CONFIG,
        externalId: first.documents[0].externalId,
        syncContext: ctx,
        getUserDocument: hydrate,
      })
    ).rejects.toThrow('verified delegated listing identity')
    expect(hydrate).not.toHaveBeenCalled()
  })
})

describe('Google Workspace central validation', () => {
  it.each([
    USER('bob', 'primary@corp.com'),
    USER('bob', 'bob@corp.com', { customerId: 'other' }),
    USER('bob', 'bob@corp.com', { suspended: true }),
  ])('rejects aliases, other customers and inactive selected users', async (user) => {
    mockFetch.mockResolvedValueOnce(json(USER('admin'))).mockResolvedValueOnce(json(user))
    const ctx = context()
    await expect(
      validateGoogleWorkspaceConfig({
        provider: 'gmail',
        accessToken: 'directory-token',
        sourceConfig: { ...CONFIG, userEmails: 'bob@corp.com' },
        syncContext: ctx,
      })
    ).rejects.toThrow()
    expect(ctx.getDelegatedAccessToken).not.toHaveBeenCalled()
  })
})
