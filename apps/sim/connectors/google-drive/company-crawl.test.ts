import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateGoogleCompanyConfig } from '@/connectors/google-drive/company-crawl'
import { googleDriveConnector as drive } from '@/connectors/google-drive/google-drive'
import { GoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'
import { listGoogleWorkspaceUsers } from '@/connectors/google-workspace/users'

const mockFetch = vi.fn()
const CONFIG = { adminEmail: 'admin@corp.com' }
const USER = (email: string, extra: Record<string, unknown> = {}) => ({
  id: email,
  primaryEmail: email,
  customerId: 'customer-1',
  suspended: false,
  ...extra,
})
const FILE = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  mimeType: 'text/plain',
  modifiedTime: '2026-09-01T00:00:00Z',
  permissions: [{ type: 'user', emailAddress: email, role: 'owner' }],
  ...extra,
})
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

function context() {
  return {
    mirrorsSourceAcls: true,
    getDelegatedAccessToken: vi.fn(async (email: string) => `delegated:${email}`),
  }
}

function fixture(input: {
  users?: ReturnType<typeof USER>[]
  files?: Record<string, ReturnType<typeof FILE>[]>
  permissions?: Record<string, unknown[]>
}) {
  const users = input.users ?? [USER('alice@corp.com'), USER('bob@corp.com')]
  const files = input.files ?? {
    'alice@corp.com': [FILE('private-alice', 'alice@corp.com')],
    'bob@corp.com': [FILE('private-bob', 'bob@corp.com')],
  }
  mockFetch.mockImplementation(async (address: string, init?: RequestInit) => {
    const url = new URL(address)
    if (url.hostname === 'admin.googleapis.com') {
      if (url.pathname.endsWith('/users')) return json({ users })
      const key = decodeURIComponent(url.pathname.split('/').at(-1)!)
      return json(users.find((user) => user.id === key) ?? USER(key))
    }
    const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer delegated:', '')
    const visible = files[token ?? ''] ?? []
    if (url.pathname.endsWith('/drives')) return json({ drives: [] })
    if (url.pathname.endsWith('/files')) return json({ files: visible })
    const fileId = decodeURIComponent(url.pathname.split('/')[4])
    if (url.pathname.endsWith('/permissions'))
      return json({ permissions: input.permissions?.[fileId] ?? [] })
    const file = visible.find((candidate) => candidate.id === fileId)
    if (!file) return json({ error: { errors: [{ reason: 'notFound' }] } }, 404)
    if (url.searchParams.get('alt') === 'media') return new Response(`Body: ${file.id}`)
    return json(file)
  })
}

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

describe('Google Drive company-wide crawl', () => {
  it('indexes private files for multiple users without granting either user access to the other', async () => {
    fixture({})
    const ctx = context()
    const alice = await drive.listDocuments('directory-token', CONFIG, undefined, ctx, new Date())
    expect(alice.documents.map((doc) => [doc.externalId, doc.acl])).toEqual([
      ['private-alice', ['u:alice@corp.com']],
    ])
    const body = await drive.getDocument('directory-token', CONFIG, 'private-alice', ctx)
    expect(body?.content).toBe('Body: private-alice')
    expect(body?.metadata).not.toHaveProperty('googleDrivePageSubjects')
    const bob = await drive.listDocuments('directory-token', CONFIG, alice.nextCursor, ctx)
    expect(bob.documents.map((doc) => [doc.externalId, doc.acl])).toEqual([
      ['private-bob', ['u:bob@corp.com']],
    ])
    expect(bob.hasMore).toBe(false)
    expect(ctx.getDelegatedAccessToken.mock.calls.map(([email]) => email)).toEqual([
      'alice@corp.com',
      'bob@corp.com',
    ])
    for (const [address, init] of mockFetch.mock.calls) {
      const url = new URL(address)
      const token = new Headers(init.headers).get('Authorization')
      expect(token).toEqual(
        url.hostname === 'admin.googleapis.com'
          ? 'Bearer directory-token'
          : expect.stringContaining('Bearer delegated:')
      )
      if (url.pathname.endsWith('/files')) {
        expect(url.searchParams.get('corpora')).toBe('user')
        expect(url.searchParams.get('q')).not.toContain('modifiedTime >')
      }
    }
  })

  it('lets a downloadable owner index a shared file after an earlier reader cannot download it', async () => {
    fixture({
      files: {
        'alice@corp.com': [
          FILE('shared', 'bob@corp.com', { capabilities: { canDownload: false } }),
        ],
        'bob@corp.com': [FILE('shared', 'bob@corp.com', { capabilities: { canDownload: true } })],
      },
    })
    const ctx = context()
    const reader = await drive.listDocuments('directory-token', CONFIG, undefined, ctx)
    expect(reader.documents).toEqual([])
    const owner = await drive.listDocuments('directory-token', CONFIG, reader.nextCursor, ctx)
    expect(owner.documents.map((file) => file.externalId)).toEqual(['shared'])
    expect((await drive.getDocument('directory-token', CONFIG, 'shared', ctx))?.content).toBe(
      'Body: shared'
    )
    const fieldMasks = mockFetch.mock.calls
      .filter(([address]) => new URL(address).pathname.endsWith('/files'))
      .map(([address]) => new URL(address).searchParams.get('fields'))
    expect(fieldMasks.every((fields) => fields?.includes('capabilities(canDownload)'))).toBe(true)
  })

  it('omits a file when no selected user can download it', async () => {
    fixture({
      files: {
        'alice@corp.com': [
          FILE('shared', 'bob@corp.com', { capabilities: { canDownload: false } }),
        ],
        'bob@corp.com': [FILE('shared', 'bob@corp.com', { capabilities: { canDownload: false } })],
      },
    })
    const first = await drive.listDocuments('directory-token', CONFIG, undefined, context())
    const second = await drive.listDocuments('directory-token', CONFIG, first.nextCursor, context())
    expect([...first.documents, ...second.documents]).toEqual([])
    expect(second.hasMore).toBe(false)
  })

  it('checks the shortcut target download capability rather than the shortcut capability', async () => {
    fixture({
      files: {
        'alice@corp.com': [
          FILE('shortcut', 'alice@corp.com', {
            mimeType: 'application/vnd.google-apps.shortcut',
            capabilities: { canDownload: true },
            shortcutDetails: { targetId: 'target' },
          }),
        ],
      },
    })
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
      const url = new URL(address)
      if (url.pathname.endsWith('/files/target')) {
        expect(url.searchParams.get('fields')).toContain('capabilities(canDownload)')
        return json(FILE('target', 'alice@corp.com', { capabilities: { canDownload: false } }))
      }
      return route(address, init)
    })
    const page = await drive.listDocuments('directory-token', CONFIG, undefined, context())
    expect(page.documents).toEqual([])
  })

  it('checkpoints nested Drive pagination and resumes the exact user page with a fresh context', async () => {
    fixture({})
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
      const url = new URL(address)
      if (
        url.pathname.endsWith('/files') &&
        new Headers(init.headers).get('Authorization') === 'Bearer delegated:alice@corp.com'
      ) {
        const second = url.searchParams.get('pageToken') === 'file-page-2'
        return json({
          files: [FILE(second ? 'alice-2' : 'alice-1', 'alice@corp.com')],
          ...(!second ? { nextPageToken: 'file-page-2' } : {}),
        })
      }
      return route(address, init)
    })
    const first = await drive.listDocuments('directory-token', CONFIG, undefined, context())
    const second = await drive.listDocuments('directory-token', CONFIG, first.nextCursor, context())
    expect(second.documents[0].externalId).toBe('alice-2')
    const replayContext = context()
    const replay = await drive.listDocuments(
      'directory-token',
      CONFIG,
      second.currentCursor,
      replayContext
    )
    expect(replay.documents).toEqual(second.documents)
    expect(replayContext.getDelegatedAccessToken).toHaveBeenCalledWith('alice@corp.com')
    const third = await drive.listDocuments('directory-token', CONFIG, second.nextCursor, context())
    expect(third.documents[0].externalId).toBe('private-bob')
    expect(
      mockFetch.mock.calls.filter(([address]) => new URL(address).pathname.endsWith('/users'))
    ).toHaveLength(1)
  })

  it.each(['teamDriveMembershipRequired', 'notFound'])(
    'advances after a listed shared drive becomes inaccessible: %s',
    async (reason) => {
      fixture({ users: [USER('alice@corp.com')] })
      const route = mockFetch.getMockImplementation()!
      mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
        const url = new URL(address)
        if (url.pathname.endsWith('/drives'))
          return json({ drives: [{ id: 'removed' }, { id: 'visible' }] })
        if (url.pathname.endsWith('/files') && url.searchParams.get('corpora') === 'drive') {
          return url.searchParams.get('driveId') === 'removed'
            ? json({ error: { errors: [{ reason }] } }, reason === 'notFound' ? 404 : 403)
            : json({ files: [FILE('still-visible', 'alice@corp.com')] })
        }
        return route(address, init)
      })
      const personal = await drive.listDocuments('directory-token', CONFIG, undefined, context())
      const removed = await drive.listDocuments(
        'directory-token',
        CONFIG,
        personal.nextCursor,
        context()
      )
      expect(removed.documents).toEqual([])
      expect(removed.hasMore).toBe(true)
      const visible = await drive.listDocuments(
        'directory-token',
        CONFIG,
        removed.nextCursor,
        context()
      )
      expect(visible.documents.map((file) => file.externalId)).toEqual(['still-visible'])
      expect(visible.hasMore).toBe(false)
    }
  )

  it.each([401, 403])(
    'does not treat a shared-drive authorization failure as an empty drive: %s',
    async (status) => {
      fixture({ users: [USER('alice@corp.com')] })
      const route = mockFetch.getMockImplementation()!
      mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
        const url = new URL(address)
        if (url.pathname.endsWith('/drives')) return json({ drives: [{ id: 'drive-a' }] })
        if (url.pathname.endsWith('/files') && url.searchParams.get('corpora') === 'drive')
          return json({ error: {} }, status)
        return route(address, init)
      })
      const first = await drive.listDocuments('directory-token', CONFIG, undefined, context())
      await expect(
        drive.listDocuments('directory-token', CONFIG, first.nextCursor, context())
      ).rejects.toThrow(GoogleDriveApiError)
    }
  )

  it('delegates only to selected primary emails found in the actual Workspace directory', async () => {
    fixture({})
    const ctx = context()
    const page = await drive.listDocuments(
      'directory-token',
      { ...CONFIG, userEmails: ['Bob@Corp.com'] },
      undefined,
      ctx
    )
    expect(page.documents.map((doc) => doc.externalId)).toEqual(['private-bob'])
    expect(ctx.getDelegatedAccessToken).toHaveBeenCalledExactlyOnceWith('bob@corp.com')
  })

  it.each([{ suspended: true }, { archived: true }, { isGuestUser: true }])(
    'skips inactive users without impersonating them: %j',
    async (inactive) => {
      fixture({ users: [USER('alice@corp.com', inactive), USER('bob@corp.com')] })
      const ctx = context()
      const page = await drive.listDocuments('directory-token', CONFIG, undefined, ctx)
      expect(page.documents[0].externalId).toBe('private-bob')
      expect(ctx.getDelegatedAccessToken).not.toHaveBeenCalledWith('alice@corp.com')
    }
  )

  it('rechecks suspension before resuming a previously listed user', async () => {
    fixture({})
    const first = await drive.listDocuments('directory-token', CONFIG, undefined, context())
    fixture({ users: [USER('alice@corp.com'), USER('bob@corp.com', { suspended: true })] })
    const ctx = context()
    const second = await drive.listDocuments('directory-token', CONFIG, first.nextCursor, ctx)
    expect(second.documents).toEqual([])
    expect(second.hasMore).toBe(false)
    expect(ctx.getDelegatedAccessToken).not.toHaveBeenCalled()
  })

  it('propagates delegation revocation rather than completing an empty crawl', async () => {
    fixture({})
    const ctx = context()
    ctx.getDelegatedAccessToken.mockRejectedValue(new Error('Delegation revoked'))
    await expect(drive.listDocuments('directory-token', CONFIG, undefined, ctx)).rejects.toThrow(
      'Delegation revoked'
    )
  })

  it('fails closed if a reader cannot retrieve permissions', async () => {
    fixture({
      files: { 'alice@corp.com': [FILE('file', 'alice@corp.com', { permissions: undefined })] },
    })
    const ctx = context()
    const page = await drive.listDocuments('directory-token', CONFIG, undefined, ctx)
    mockFetch.mockResolvedValue(
      json({ error: { errors: [{ reason: 'insufficientFilePermissions' }] } }, 403)
    )
    await expect(
      drive.getDocumentAcls!('directory-token', CONFIG, page.documents, ctx)
    ).resolves.toEqual({})
  })

  it('returns the current revoked ACL on a later crawl even when content is unchanged', async () => {
    fixture({
      files: {
        'alice@corp.com': [
          FILE('same', 'alice@corp.com', {
            permissions: [
              { type: 'user', emailAddress: 'alice@corp.com', role: 'owner' },
              { type: 'user', emailAddress: 'bob@corp.com', role: 'reader' },
            ],
          }),
        ],
      },
    })
    const before = await drive.listDocuments('directory-token', CONFIG, undefined, context())
    fixture({ files: { 'alice@corp.com': [FILE('same', 'alice@corp.com')] } })
    const after = await drive.listDocuments(
      'directory-token',
      CONFIG,
      undefined,
      context(),
      new Date()
    )
    expect(after.documents[0].contentHash).toBe(before.documents[0].contentHash)
    expect(after.documents[0].acl).toEqual(['u:alice@corp.com'])
  })

  it('refuses hydration without a verified listing identity and refuses nondelegated central tokens', async () => {
    const ctx = context()
    await expect(drive.getDocument('directory-token', CONFIG, 'unlisted', ctx)).rejects.toThrow(
      'verified delegated listing identity'
    )
    await expect(
      drive.listDocuments('ordinary-oauth', CONFIG, undefined, { mirrorsSourceAcls: true })
    ).rejects.toThrow('requires a delegated service account')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('marks a partial provider search unsafe for deletion reconciliation', async () => {
    fixture({})
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) =>
      new URL(address).pathname.endsWith('/files')
        ? json({ files: [], incompleteSearch: true })
        : route(address, init)
    )
    const page = await drive.listDocuments('directory-token', CONFIG, undefined, context())
    expect(page.reconciliationSafe).toBe(false)
  })
})

describe('Company-wide setup validation', () => {
  it.each([
    ['different customer', USER('other@elsewhere.com', { customerId: 'customer-2' })],
    ['alias', USER('primary@corp.com', { id: 'alias@corp.com' })],
    ['suspended', USER('suspended@corp.com', { suspended: true })],
    ['archived', USER('archived@corp.com', { archived: true })],
    ['guest', USER('guest@corp.com', { isGuestUser: true })],
  ])('rejects a selected user that is %s', async (_reason, user) => {
    fixture({ users: [USER('admin@corp.com'), user] })
    await expect(
      validateGoogleCompanyConfig(
        'directory-token',
        { ...CONFIG, userEmails: [user.id] },
        context()
      )
    ).rejects.toThrow()
  })
})

describe('Workspace user enumeration boundaries', () => {
  it.each([
    {},
    { users: [{ primaryEmail: 'alice@corp.com' }] },
    { users: [USER('alice@corp.com', { id: 'x'.repeat(257) })] },
    { users: [USER('alice@corp.com', { customerId: 'x'.repeat(257) })] },
    { users: [], nextPageToken: '' },
    { users: [], nextPageToken: 'x'.repeat(8193) },
  ])('rejects malformed directory data: %j', async (body) => {
    mockFetch.mockResolvedValue(json(body))
    await expect(listGoogleWorkspaceUsers('token')).rejects.toThrow('malformed')
  })
})
