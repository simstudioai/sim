/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
function list(syncContext: Record<string, unknown>, cursor?: string, sourceConfig = CONFIG) {
  return listGoogleWorkspaceDocuments({
    provider: 'gmail',
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

  it('preserves only the active user cache across provider pages', async () => {
    listUserDocuments
      .mockImplementationOnce(async (_token, _config, _cursor, child) => {
        if (child) child.labels = ['Alice label']
        return { documents: [document(child)], nextCursor: 'page-2', hasMore: true }
      })
      .mockImplementationOnce(async (_token, _config, cursor, child) => {
        expect(cursor).toBe('page-2')
        expect(child?.labels).toEqual(['Alice label'])
        return { documents: [document(child, 'second')], hasMore: false }
      })
    const ctx = context()
    const first = await list(ctx)
    await list(ctx, first.nextCursor)
    expect(ctx.getDelegatedAccessToken).toHaveBeenCalledTimes(2)
  })

  it('hydrates only the active page using its token and preserves the provider revision', async () => {
    const ctx = context()
    const first = await list(ctx)
    const externalId = first.documents[0].externalId
    const hydrate = vi
      .fn<ConnectorConfig['getDocument']>()
      .mockImplementation(async (_token, _config, id, child) => ({
        ...document(child),
        externalId: id,
        content: 'Private body',
        contentHash: 'revision-2',
        contentDeferred: false,
      }))
    const input = {
      provider: 'gmail' as const,
      sourceConfig: CONFIG,
      externalId,
      syncContext: ctx,
      getUserDocument: hydrate,
    }
    await expect(getGoogleWorkspaceDocument(input)).resolves.toMatchObject({
      content: 'Private body',
      contentHash: 'revision-2',
      acl: ['u:alice@corp.com'],
    })
    expect(hydrate.mock.calls[0][0]).toBe('delegated:alice@corp.com')
    await expect(getGoogleWorkspaceDocument({ ...input, externalId: 'arbitrary' })).rejects.toThrow(
      'verified delegated listing identity'
    )
    await expect(
      getGoogleWorkspaceDocument({ ...input, provider: 'google_calendar' })
    ).rejects.toThrow('verified delegated listing identity')
    await expect(getGoogleWorkspaceDocument({ ...input, syncContext: context() })).rejects.toThrow(
      'verified delegated listing identity'
    )
    await list(ctx, first.nextCursor)
    await expect(getGoogleWorkspaceDocument(input)).rejects.toThrow(
      'verified delegated listing identity'
    )
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
    ['suspended', USER('alice', 'alice@corp.com', { suspended: true })],
    ['archived', USER('alice', 'alice@corp.com', { archived: true })],
    ['guest', USER('alice', 'alice@corp.com', { isGuestUser: true })],
    ['deleted', null],
  ])('advances past a user now %s without delegation', async (_status, replacement) => {
    const first = await list(context())
    const ctx = context()
    mockFetch.mockResolvedValueOnce(replacement ? json(replacement) : json({ error: {} }, 404))
    const skipped = await list(ctx, first.currentCursor)
    expect(skipped.documents).toEqual([])
    expect(skipped.hasMore).toBe(true)
    expect(ctx.getDelegatedAccessToken).not.toHaveBeenCalled()
    const next = await list(ctx, skipped.nextCursor)
    expect(next.documents[0].acl).toEqual(['u:bob@corp.com'])
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

  it('uses the current primary email after a rename without changing its stable document ID', async () => {
    const first = await list(context())
    mockFetch.mockResolvedValueOnce(json(USER('alice', 'renamed@corp.com')))
    const ctx = context()
    const renamed = await list(ctx, first.currentCursor)
    expect(renamed.documents[0].externalId).toBe(first.documents[0].externalId)
    expect(renamed.documents[0].acl).toEqual(['u:renamed@corp.com'])
    expect(ctx.getDelegatedAccessToken).toHaveBeenCalledWith('renamed@corp.com')
  })

  it('applies primary-user filters both to discovery and to resumed identities', async () => {
    const config = { ...CONFIG, userEmails: ['ALICE@corp.com'] }
    const first = await list(context(), undefined, config)
    expect(first.hasMore).toBe(false)
    mockFetch.mockResolvedValueOnce(json(USER('alice', 'renamed@corp.com')))
    const ctx = context()
    const next = await list(ctx, first.currentCursor, config)
    expect(next.documents).toEqual([])
    expect(next.hasMore).toBe(false)
    expect(ctx.getDelegatedAccessToken).not.toHaveBeenCalled()
  })

  it('preserves an empty intermediate Directory page and visits secondary domains', async () => {
    mockFetch.mockResolvedValueOnce(json({ users: [], nextPageToken: 'users-2' }))
    const ctx = context()
    const empty = await list(ctx)
    expect(empty.hasMore).toBe(true)
    mockFetch
      .mockResolvedValueOnce(json({ users: [USER('secondary', 'person@secondary.com')] }))
      .mockResolvedValueOnce(json(USER('secondary', 'person@secondary.com')))
    const next = await list(ctx, empty.nextCursor)
    expect(next.documents[0].acl).toEqual(['u:person@secondary.com'])
    expect(new URL(mockFetch.mock.calls[1][0]).searchParams.get('pageToken')).toBe('users-2')
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

  it('forwards cancellation and stops before delegation after Directory cancellation', async () => {
    const controller = new AbortController()
    const ctx = { ...context(), signal: controller.signal }
    controller.abort()
    await expect(list(ctx)).rejects.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(ctx.getDelegatedAccessToken).not.toHaveBeenCalled()
  })

  it('stops when cancellation arrives after the Directory read or delegated token mint', async () => {
    const first = await list(context())
    const controller = new AbortController()
    const ctx = { ...context(), signal: controller.signal }
    mockFetch.mockImplementationOnce(async () => {
      controller.abort()
      return json(USER('alice'))
    })
    await expect(list(ctx, first.currentCursor)).rejects.toThrow()
    expect(ctx.getDelegatedAccessToken).not.toHaveBeenCalled()

    const controller2 = new AbortController()
    const ctx2 = {
      mirrorsSourceAcls: true,
      signal: controller2.signal,
      getDelegatedAccessToken: vi.fn(async () => {
        controller2.abort()
        return 'delegated-token'
      }),
    }
    const calls = listUserDocuments.mock.calls.length
    await expect(list(ctx2, first.currentCursor)).rejects.toThrow()
    expect(listUserDocuments).toHaveBeenCalledTimes(calls)
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

  it('bounds the saved Directory page and retains only the remaining users', async () => {
    const users = Array.from({ length: 100 }, (_, i) => USER(`employee-${i}`))
    directory(users)
    const first = await list(context())
    const decoded = JSON.parse(
      Buffer.from(first.nextCursor!.split(':').at(-1)!, 'base64url').toString()
    )
    expect(decoded.users).toHaveLength(99)
    expect(decoded.users[0].id).toBe('employee-1')
    expect(JSON.stringify(decoded)).not.toContain('delegated')
    expect(JSON.stringify(decoded)).not.toContain('directory-token')
    const url = new URL(mockFetch.mock.calls[0][0])
    expect(url.searchParams.get('maxResults')).toBe('100')
    expect(url.searchParams.get('fields')).toBe(
      'kind,nextPageToken,users(id,primaryEmail,customerId,suspended,archived,isGuestUser)'
    )
  })

  it('preserves null for a document deleted before hydration', async () => {
    const ctx = context()
    const first = await list(ctx)
    const input = {
      provider: 'gmail' as const,
      sourceConfig: CONFIG,
      externalId: first.documents[0].externalId,
      syncContext: ctx,
      getUserDocument: vi.fn().mockResolvedValue(null),
    }
    await expect(getGoogleWorkspaceDocument(input)).resolves.toBeNull()
  })

  it('requests restart for an expired Directory continuation without hiding initial request errors', async () => {
    mockFetch.mockResolvedValueOnce(json({ users: [], nextPageToken: 'expired-users' }))
    const first = await list(context())
    mockFetch.mockResolvedValueOnce(json({ error: { errors: [{ reason: 'invalid' }] } }, 400))
    await expect(list(context(), first.nextCursor)).rejects.toBeInstanceOf(
      InvalidGoogleWorkspaceCursor
    )
    mockFetch.mockResolvedValueOnce(json({ error: { errors: [{ reason: 'invalid' }] } }, 400))
    await expect(list(context())).rejects.not.toBeInstanceOf(InvalidGoogleWorkspaceCursor)
  })

  it('propagates provider truncation so partial results cannot reconcile deletions', async () => {
    listUserDocuments.mockImplementation(async (_token, _config, _cursor, child) => {
      if (child) child.listingCapped = true
      return { documents: [], hasMore: false }
    })
    const ctx: Record<string, unknown> = context()
    await list(ctx)
    expect(ctx.listingCapped).toBe(true)
  })
})

describe('Google Workspace central validation', () => {
  it('validates selected primary users and rechecks the sample immutable ID before delegation', async () => {
    const ctx = context()
    const validated = await validateGoogleWorkspaceConfig({
      provider: 'gmail',
      accessToken: 'directory-token',
      sourceConfig: { ...CONFIG, userEmails: 'bob@corp.com' },
      syncContext: ctx,
    })
    expect(validated.user.id).toBe('bob')
    expect(validated.accessToken).toBe('delegated:bob@corp.com')
    expect(validated.syncContext.memberId).toBe('google-workspace:customer-1:bob')
    expect(mockFetch.mock.calls.map(([url]) => new URL(url).pathname.split('/').at(-1))).toEqual([
      'admin%40corp.com',
      'bob%40corp.com',
      'bob',
    ])
  })

  it('selects a bounded active sample when Users is blank', async () => {
    const validated = await validateGoogleWorkspaceConfig({
      provider: 'google_calendar',
      accessToken: 'directory-token',
      sourceConfig: CONFIG,
      syncContext: context(),
    })
    expect(validated.user.email).toBe('alice@corp.com')
    const url = new URL(mockFetch.mock.calls[1][0])
    expect(url.searchParams.get('maxResults')).toBe('1')
    expect(url.searchParams.get('customer')).toBe('my_customer')
  })

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
