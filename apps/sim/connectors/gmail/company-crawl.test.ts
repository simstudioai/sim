/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchProvider, listUsers, getUser } = vi.hoisted(() => ({
  fetchProvider: vi.fn(),
  listUsers: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: fetchProvider,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ GmailIcon: () => null }))
vi.mock('@/connectors/google-workspace/users', () => ({
  GOOGLE_WORKSPACE_USERS_PAGE_SIZE: 100,
  listGoogleWorkspaceUsers: listUsers,
  getGoogleWorkspaceUser: getUser,
  selectedGoogleWorkspaceUsers: (value: unknown) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((email) => email.trim())
          .filter(Boolean)
      : [],
}))

import { gmailConnector } from '@/connectors/gmail/gmail'
import { gmailConnectorMeta } from '@/connectors/gmail/meta'

const ALICE = {
  id: 'directory-alice',
  email: 'alice@example.com',
  customerId: 'customer-1',
  active: true,
}
const BOB = {
  id: 'directory-bob',
  email: 'bob@example.com',
  customerId: 'customer-1',
  active: true,
}
const ADMIN = {
  id: 'directory-admin',
  email: 'admin@example.com',
  customerId: 'customer-1',
  active: true,
}
const CONFIG = { adminEmail: ADMIN.email, dateRange: '6m' }

function centralContext() {
  return {
    mirrorsSourceAcls: true,
    getDelegatedAccessToken: vi.fn(async (email: string) => `delegated:${email}`),
  }
}

function providerResponse(url: string, init?: RequestInit): Response {
  const parsed = new URL(url)
  const token = new Headers(init?.headers).get('Authorization')
  const mailbox = token?.includes(BOB.email) ? 'Bob' : 'Alice'
  if (parsed.pathname.endsWith('/profile')) return Response.json({ emailAddress: ALICE.email })
  if (parsed.pathname.endsWith('/labels')) {
    return Response.json({ labels: [{ id: 'Label_7', name: `${mailbox} label` }] })
  }
  if (parsed.pathname.endsWith('/threads')) {
    return Response.json({ threads: [{ id: 'same-thread', historyId: '10' }] })
  }
  return Response.json({
    id: 'same-thread',
    historyId: '10',
    messages: [
      {
        id: 'message-1',
        threadId: 'same-thread',
        labelIds: ['Label_7'],
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'Subject', value: `${mailbox} private thread` },
            { name: 'From', value: 'someone-else@example.com' },
            { name: 'To', value: 'entire-company@example.com' },
          ],
          body: { data: Buffer.from(`${mailbox} private body`).toString('base64url') },
        },
      },
    ],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  listUsers.mockResolvedValue({ users: [ALICE, BOB] })
  getUser.mockImplementation(
    async (_token: string, key: string) =>
      [ALICE, BOB, ADMIN].find((user) => user.id === key || user.email === key) ?? null
  )
  fetchProvider.mockImplementation(async (url: string, init?: RequestInit) =>
    providerResponse(url, init)
  )
})

afterEach(() => vi.useRealTimers())

describe('company-wide Gmail indexing', () => {
  it('forwards cancellation to mailbox listing and refuses follow-up metadata requests', async () => {
    const controller = new AbortController()
    const context = { ...centralContext(), signal: controller.signal }
    fetchProvider.mockImplementation(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort()
      return Response.json({ threads: [{ id: 'same-thread' }] })
    })
    await expect(
      gmailConnector.listDocuments('directory-token', CONFIG, undefined, context)
    ).rejects.toThrow()
    expect(fetchProvider).toHaveBeenCalledOnce()
  })

  it('cancels label resolution without caching the cancellation as an unavailable label index', async () => {
    const controller = new AbortController()
    const context = { ...centralContext(), signal: controller.signal }
    fetchProvider.mockImplementation(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort()
      throw new DOMException('Cancelled', 'AbortError')
    })
    await expect(
      gmailConnector.listDocuments(
        'directory-token',
        { ...CONFIG, label: 'Engineering' },
        undefined,
        context
      )
    ).rejects.toThrow('abort')
    expect(fetchProvider).toHaveBeenCalledOnce()
  })

  it('forwards the page signal to thread hydration, label reads, and separately stored MIME bodies', async () => {
    const controller = new AbortController()
    const context = { ...centralContext(), signal: controller.signal }
    const page = await gmailConnector.listDocuments('directory-token', CONFIG, undefined, context)
    fetchProvider.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      if (url.includes('/attachments/'))
        return Response.json({ data: Buffer.from('Private body').toString('base64url'), size: 12 })
      if (url.endsWith('/labels')) return providerResponse(url, init)
      return Response.json({
        id: 'same-thread',
        historyId: '10',
        messages: [
          {
            id: 'message-1',
            threadId: 'same-thread',
            labelIds: ['Label_7'],
            payload: {
              mimeType: 'text/plain',
              headers: [{ name: 'Subject', value: 'Private subject' }],
              body: { attachmentId: 'body-1', size: 12 },
            },
          },
        ],
      })
    })
    const hydrated = await gmailConnector.getDocument(
      'directory-token',
      CONFIG,
      page.documents[0].externalId,
      context
    )
    expect(hydrated?.content).toContain('Private body')
    expect(hydrated?.acl).toEqual([`u:${ALICE.email}`])
  })

  it('passes the signal into the delegated validation probe', async () => {
    const controller = new AbortController()
    const context = { ...centralContext(), signal: controller.signal }
    await expect(
      gmailConnector.validateConfig('directory-token', CONFIG, context)
    ).resolves.toEqual({ valid: true })
    expect(fetchProvider).toHaveBeenCalledWith(
      expect.stringContaining('/profile'),
      expect.objectContaining({ signal: controller.signal }),
      expect.any(Object)
    )
  })

  it('bounds thread-list response bytes and page length instead of accepting a truncated corpus', async () => {
    fetchProvider.mockResolvedValueOnce(
      new Response('untrusted', { headers: { 'Content-Length': String(9 * 1024 * 1024) } })
    )
    await expect(
      gmailConnector.listDocuments('directory-token', CONFIG, undefined, centralContext())
    ).rejects.toThrow('maximum size')
    fetchProvider.mockResolvedValueOnce(
      Response.json({
        threads: Array.from({ length: 101 }, (_, index) => ({
          id: `thread-${index}`,
          historyId: '10',
        })),
      })
    )
    await expect(
      gmailConnector.listDocuments('directory-token', CONFIG, undefined, centralContext())
    ).rejects.toThrow('malformed thread listing')
  })

  it('requires a service account with separate read-only directory and mailbox scopes', () => {
    expect(gmailConnectorMeta.auth).toEqual({
      mode: 'oauth',
      provider: 'google-email',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
      adminCredentialType: 'service_account',
      serviceAccountScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      adminServiceAccountScopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
      serviceAccountDelegationScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      serviceAccountSubjectFieldId: 'adminEmail',
    })
    expect(gmailConnectorMeta.supportsSeparateContentCredential).toBeUndefined()
    expect(gmailConnectorMeta.searchDefaultSourceConfig).toEqual({ dateRange: '6m' })
    expect(
      gmailConnectorMeta.configFields.find((field) => field.id === 'labelSelector')
    ).toMatchObject({
      hideInMemberMode: true,
      hideInAdminMode: true,
    })
  })

  it('keeps identical thread IDs, bodies, label caches, and owner ACLs separate', async () => {
    const context = centralContext()
    const first = await gmailConnector.listDocuments('directory-token', CONFIG, undefined, context)
    const alice = first.documents[0]
    const aliceBody = await gmailConnector.getDocument(
      'directory-token',
      CONFIG,
      alice.externalId,
      context
    )
    const second = await gmailConnector.listDocuments(
      'directory-token',
      CONFIG,
      first.nextCursor,
      context
    )
    const bob = second.documents[0]
    const bobBody = await gmailConnector.getDocument(
      'directory-token',
      CONFIG,
      bob.externalId,
      context
    )

    expect(first.hasMore).toBe(true)
    expect(second.hasMore).toBe(false)
    expect(alice.externalId).not.toBe(bob.externalId)
    expect(alice.externalId).toContain(encodeURIComponent(ALICE.id))
    expect(bob.externalId).toContain(encodeURIComponent(BOB.id))
    expect(alice.acl).toEqual([`u:${ALICE.email}`])
    expect(bob.acl).toEqual([`u:${BOB.email}`])
    expect(aliceBody).toMatchObject({
      acl: [`u:${ALICE.email}`],
      contentHash: alice.contentHash,
      metadata: { labels: ['Alice label'] },
    })
    expect(bobBody).toMatchObject({
      acl: [`u:${BOB.email}`],
      contentHash: bob.contentHash,
      metadata: { labels: ['Bob label'] },
    })
    expect(aliceBody?.content).toContain('Alice private body')
    expect(bobBody?.content).toContain('Bob private body')
    expect(context.getDelegatedAccessToken.mock.calls.map(([email]) => email)).toEqual([
      ALICE.email,
      BOB.email,
    ])
    for (const [, init] of fetchProvider.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).not.toBe('Bearer directory-token')
    }
  })

  it('rejects hydration without its listed page and after advancing to another mailbox', async () => {
    const context = centralContext()
    const first = await gmailConnector.listDocuments('directory-token', CONFIG, undefined, context)
    const externalId = first.documents[0].externalId
    const callsBefore = fetchProvider.mock.calls.length
    await expect(
      gmailConnector.getDocument('directory-token', CONFIG, externalId, centralContext())
    ).rejects.toThrow()
    expect(fetchProvider).toHaveBeenCalledTimes(callsBefore)
    await gmailConnector.listDocuments('directory-token', CONFIG, first.nextCursor, context)
    const callsAfter = fetchProvider.mock.calls.length
    await expect(
      gmailConnector.getDocument('directory-token', CONFIG, externalId, context)
    ).rejects.toThrow()
    await expect(
      gmailConnector.getDocument('directory-token', CONFIG, 'same-thread', context)
    ).rejects.toThrow()
    expect(fetchProvider).toHaveBeenCalledTimes(callsAfter)
  })

  it('replays a page with the same query, mailbox namespace, and ACL in a fresh context', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'))
    const first = await gmailConnector.listDocuments(
      'directory-token',
      CONFIG,
      undefined,
      centralContext()
    )
    const firstQuery = new URL(fetchProvider.mock.calls[0][0]).searchParams.get('q')
    expect(first.currentCursor).toBeDefined()
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'))
    const resumedContext = centralContext()
    const resumed = await gmailConnector.listDocuments(
      'directory-token',
      CONFIG,
      first.currentCursor,
      resumedContext
    )
    expect(resumed.documents).toEqual(first.documents)
    expect(new URL(fetchProvider.mock.calls[1][0]).searchParams.get('q')).toBe(firstQuery)
    const body = await gmailConnector.getDocument(
      'directory-token',
      CONFIG,
      resumed.documents[0].externalId,
      resumedContext
    )
    expect(body?.content).toContain('Alice private body')
  })

  it('does not advance to the next mailbox until all thread pages are exhausted', async () => {
    fetchProvider.mockImplementation(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      const token = new Headers(init?.headers).get('Authorization')
      if (
        parsed.pathname.endsWith('/threads') &&
        token?.includes(ALICE.email) &&
        !parsed.searchParams.has('pageToken')
      ) {
        return Response.json({ threads: [], nextPageToken: 'alice-next' })
      }
      return providerResponse(url, init)
    })
    const context = centralContext()
    const first = await gmailConnector.listDocuments('directory-token', CONFIG, undefined, context)
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    const next = await gmailConnector.listDocuments(
      'directory-token',
      CONFIG,
      first.nextCursor,
      context
    )
    expect(next.documents[0].acl).toEqual([`u:${ALICE.email}`])
    expect(new URL(fetchProvider.mock.calls[1][0]).searchParams.get('pageToken')).toBe('alice-next')
    const last = await gmailConnector.listDocuments(
      'directory-token',
      CONFIG,
      next.nextCursor,
      context
    )
    expect(last.documents[0].acl).toEqual([`u:${BOB.email}`])
  })

  it('excludes a user suspended between directory discovery and crawl', async () => {
    getUser.mockImplementation(async (_token: string, key: string) =>
      key === ALICE.id ? { ...ALICE, active: false } : BOB
    )
    const context = centralContext()
    const first = await gmailConnector.listDocuments('directory-token', CONFIG, undefined, context)
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    expect(context.getDelegatedAccessToken).not.toHaveBeenCalled()
    const next = await gmailConnector.listDocuments(
      'directory-token',
      CONFIG,
      first.nextCursor,
      context
    )
    expect(next.documents[0].acl).toEqual([`u:${BOB.email}`])
  })

  it('does not fall back to the administrator when delegation is revoked', async () => {
    const context = centralContext()
    context.getDelegatedAccessToken.mockRejectedValue(new Error('Delegation revoked'))
    await expect(
      gmailConnector.listDocuments('directory-token', CONFIG, undefined, context)
    ).rejects.toThrow('Delegation revoked')
    expect(fetchProvider).not.toHaveBeenCalled()
  })

  it('fails an unreadable mailbox instead of reporting a complete empty corpus', async () => {
    fetchProvider.mockResolvedValue(new Response(null, { status: 403 }))
    await expect(
      gmailConnector.listDocuments('directory-token', CONFIG, undefined, centralContext())
    ).rejects.toThrow('403')
  })

  it('invalidates previous hydration authority when the next mailbox fails', async () => {
    const context = centralContext()
    const first = await gmailConnector.listDocuments('directory-token', CONFIG, undefined, context)
    fetchProvider.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(
      gmailConnector.listDocuments('directory-token', CONFIG, first.nextCursor, context)
    ).rejects.toThrow('503')
    const calls = fetchProvider.mock.calls.length
    await expect(
      gmailConnector.getDocument('directory-token', CONFIG, first.documents[0].externalId, context)
    ).rejects.toThrow()
    expect(fetchProvider).toHaveBeenCalledTimes(calls)
  })

  it('continues directory pagination when the first page has no selected mailboxes', async () => {
    listUsers
      .mockResolvedValueOnce({ users: [ALICE], nextPageToken: 'directory-next' })
      .mockResolvedValueOnce({ users: [BOB] })
    const context = centralContext()
    const config = { ...CONFIG, userEmails: BOB.email }
    const first = await gmailConnector.listDocuments('directory-token', config, undefined, context)
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    expect(fetchProvider).not.toHaveBeenCalled()
    const next = await gmailConnector.listDocuments(
      'directory-token',
      config,
      first.nextCursor,
      context
    )
    expect(next.documents[0].acl).toEqual([`u:${BOB.email}`])
    expect(listUsers.mock.calls[1][1]).toBe('directory-next')
    expect(next.hasMore).toBe(false)
  })

  it('retains the hydrated revision when a thread changes after listing', async () => {
    const context = centralContext()
    const page = await gmailConnector.listDocuments('directory-token', CONFIG, undefined, context)
    fetchProvider.mockImplementation(async (url: string, init?: RequestInit) => {
      const response = providerResponse(url, init)
      if (!new URL(url).pathname.endsWith('/threads/same-thread')) return response
      const body = await response.json()
      return Response.json({ ...body, historyId: '20' })
    })
    const body = await gmailConnector.getDocument(
      'directory-token',
      CONFIG,
      page.documents[0].externalId,
      context
    )
    expect(page.documents[0].contentHash).toBe('gmail:same-thread:10:body-v2')
    expect(body?.contentHash).toBe('gmail:same-thread:20:body-v2')
    expect(body?.acl).toEqual([`u:${ALICE.email}`])
  })

  it('rejects an OAuth-only context and an invalid company cursor before Gmail reads', async () => {
    await expect(
      gmailConnector.listDocuments('oauth-token', CONFIG, undefined, { mirrorsSourceAcls: true })
    ).rejects.toThrow('service account')
    let failure: unknown
    try {
      await gmailConnector.listDocuments(
        'directory-token',
        CONFIG,
        'other-mailbox-cursor',
        centralContext()
      )
    } catch (error) {
      failure = error
    }
    expect(gmailConnector.isListingCursorInvalidError?.(failure)).toBe(true)
    expect(fetchProvider).not.toHaveBeenCalled()
  })

  it.each([{ maxThreads: 25 }, { label: ['Label_7'] }])(
    'rejects unsafe central settings before provider reads: %o',
    async (extra) => {
      await expect(
        gmailConnector.listDocuments(
          'directory-token',
          { ...CONFIG, ...extra },
          undefined,
          centralContext()
        )
      ).rejects.toThrow()
      expect(listUsers).not.toHaveBeenCalled()
      expect(fetchProvider).not.toHaveBeenCalled()
    }
  )

  it('validates delegated Gmail access without requiring a label in every mailbox', async () => {
    const context = centralContext()
    const result = await gmailConnector.validateConfig(
      'directory-token',
      { ...CONFIG, userEmails: ALICE.email, label: ['Engineering'] },
      context
    )
    expect(result).toEqual({ valid: true })
    expect(context.getDelegatedAccessToken).toHaveBeenCalledWith(ALICE.email)
    expect(
      fetchProvider.mock.calls.some(([url]) => new URL(url).pathname.endsWith('/labels'))
    ).toBe(false)
  })

  it('never reuses one mailbox history cursor for a company crawl', async () => {
    const context = centralContext()
    await expect(
      gmailConnector.getChangeCursor!('directory-token', CONFIG, context)
    ).rejects.toThrow('complete mailbox listings')
    await expect(
      gmailConnector.listChanges!('directory-token', CONFIG, '{"historyId":"10"}', context)
    ).rejects.toThrow('complete mailbox listings')
    expect(fetchProvider).not.toHaveBeenCalled()
  })
})
