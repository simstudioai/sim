/**
 * @vitest-environment node
 */
import { inputValidationMock } from '@sim/testing'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateGoogleCompanyConfig } from '@/connectors/google-drive/company-crawl'
import { googleDriveConnector as drive } from '@/connectors/google-drive/google-drive'
import { GoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'
import {
  listGoogleWorkspaceUsers,
  selectedGoogleWorkspaceUsers,
} from '@/connectors/google-workspace/users'

vi.mock('@/components/icons', () => ({ GoogleDriveIcon: () => null }))

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
afterEach(() => vi.unstubAllGlobals())

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

  it('retains file IDs for deduplication and resolves a later reader through the full permissions endpoint', async () => {
    const acl = [
      { type: 'user', emailAddress: 'alice@corp.com', role: 'owner' },
      { type: 'user', emailAddress: 'bob@corp.com', role: 'reader' },
    ]
    fixture({
      files: {
        'alice@corp.com': [FILE('shared', 'alice@corp.com', { permissions: acl })],
        'bob@corp.com': [FILE('shared', 'alice@corp.com', { permissions: undefined })],
      },
      permissions: { shared: acl },
    })
    const ctx = context()
    const owner = await drive.listDocuments('directory-token', CONFIG, undefined, ctx)
    const reader = await drive.listDocuments('directory-token', CONFIG, owner.nextCursor, ctx)
    expect(reader.documents[0].externalId).toBe(owner.documents[0].externalId)
    expect(reader.documents[0].contentHash).toBe(owner.documents[0].contentHash)
    const resolved = await drive.getDocumentAcls!('directory-token', CONFIG, reader.documents, ctx)
    expect(resolved.shared).toEqual(owner.documents[0].acl)
    expect(resolved.shared).toEqual(['u:alice@corp.com', 'u:bob@corp.com'])
    expect(mockFetch.mock.calls.at(-1)?.[1].headers.Authorization).toBe(
      'Bearer delegated:bob@corp.com'
    )
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

  it('lets an owner index a shortcut after the earlier reader cannot access its target', async () => {
    const shortcut = FILE('shortcut', 'bob@corp.com', {
      mimeType: 'application/vnd.google-apps.shortcut',
      capabilities: { canDownload: false },
      shortcutDetails: { targetId: 'target' },
    })
    fixture({ files: { 'alice@corp.com': [shortcut], 'bob@corp.com': [shortcut] } })
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
      const url = new URL(address)
      if (url.pathname.endsWith('/files/target')) {
        if (new Headers(init.headers).get('Authorization') === 'Bearer delegated:alice@corp.com')
          return json({ error: { errors: [{ reason: 'notFound' }] } }, 404)
        if (url.searchParams.get('alt') === 'media') return new Response('Target content')
        return json(FILE('target', 'bob@corp.com', { capabilities: { canDownload: true } }))
      }
      return route(address, init)
    })
    const ctx = context()
    const reader = await drive.listDocuments('directory-token', CONFIG, undefined, ctx)
    expect(reader.documents).toEqual([])
    const owner = await drive.listDocuments('directory-token', CONFIG, reader.nextCursor, ctx)
    expect(owner.documents.map((file) => file.externalId)).toEqual(['shortcut'])
    expect((await drive.getDocument('directory-token', CONFIG, 'shortcut', ctx))?.content).toBe(
      'Target content'
    )
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

  it('visits untouched shared-drive files, paginates drives and files, and replays the exact scope', async () => {
    fixture({ users: [USER('alice@corp.com')] })
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
      const url = new URL(address)
      if (url.pathname.endsWith('/drives')) {
        expect(new Headers(init.headers).get('Authorization')).toBe(
          'Bearer delegated:alice@corp.com'
        )
        const token = url.searchParams.get('pageToken')
        return json(
          token === 'drives-3'
            ? { drives: [{ id: 'drive-c' }] }
            : token === 'drives-2'
              ? { drives: [], nextPageToken: 'drives-3' }
              : { drives: [{ id: 'drive-a' }, { id: 'drive-b' }], nextPageToken: 'drives-2' }
        )
      }
      if (url.pathname.endsWith('/files') && url.searchParams.get('corpora') === 'drive') {
        const id = url.searchParams.get('driveId')!
        const more = id === 'drive-a' && !url.searchParams.has('pageToken')
        return json({
          files: [FILE(`${id}${more ? '-1' : '-2'}`, 'alice@corp.com')],
          ...(more ? { nextPageToken: 'files-2' } : {}),
        })
      }
      return route(address, init)
    })
    const pages = []
    let cursor: string | undefined
    for (let index = 0; index < 10; index++) {
      const page = await drive.listDocuments('directory-token', CONFIG, cursor, context())
      pages.push(page)
      if (!page.hasMore) break
      cursor = page.nextCursor
    }
    expect(pages.flatMap((page) => page.documents.map((file) => file.externalId))).toEqual([
      'private-alice',
      'drive-a-1',
      'drive-a-2',
      'drive-b-2',
      'drive-c-2',
    ])
    expect(pages.at(-1)?.hasMore).toBe(false)
    const replayContext = context()
    const replay = await drive.listDocuments(
      'directory-token',
      CONFIG,
      pages[2].currentCursor,
      replayContext
    )
    expect(replay.documents).toEqual(pages[2].documents)
    expect(replayContext.getDelegatedAccessToken).toHaveBeenCalledExactlyOnceWith('alice@corp.com')
    const params = new URL(mockFetch.mock.calls.at(-1)![0]).searchParams
    expect(params.get('corpora')).toBe('drive')
    expect(params.get('driveId')).toBe('drive-a')
    expect(params.get('pageToken')).toBe('files-2')
    expect(pages.every((page) => !page.currentCursor?.includes('delegated:'))).toBe(true)
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

  it('continues other selected folders when one folder in a shared drive becomes inaccessible', async () => {
    fixture({ users: [USER('alice@corp.com')] })
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
      const url = new URL(address)
      if (url.pathname.endsWith('/drives')) return json({ drives: [{ id: 'drive-a' }] })
      if (url.pathname.endsWith('/files')) {
        if (url.searchParams.get('corpora') !== 'drive') return json({ files: [] })
        return url.searchParams.get('q')?.includes("'removed' in parents")
          ? json({ error: { errors: [{ reason: 'notFound' }] } }, 404)
          : json({ files: [FILE('visible-folder-file', 'alice@corp.com')] })
      }
      return route(address, init)
    })
    let cursor: string | undefined
    const ids: string[] = []
    for (let index = 0; index < 8; index++) {
      const page = await drive.listDocuments(
        'directory-token',
        { ...CONFIG, folderId: ['visible', 'removed'] },
        cursor,
        context()
      )
      ids.push(...page.documents.map((file) => file.externalId))
      if (!page.hasMore) break
      cursor = page.nextCursor
    }
    expect(ids).toEqual(['visible-folder-file'])
  })

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

  it('paginates Directory users, including an empty page, without preloading the company', async () => {
    fixture({})
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
      const url = new URL(address)
      if (url.pathname.endsWith('/users')) {
        const token = url.searchParams.get('pageToken')
        expect(url.searchParams.get('maxResults')).toBe('100')
        return json(
          token === 'users-3'
            ? { users: [USER('bob@corp.com')] }
            : token === 'users-2'
              ? { users: [], nextPageToken: 'users-3' }
              : { users: [USER('alice@corp.com')], nextPageToken: 'users-2' }
        )
      }
      return route(address, init)
    })
    const one = await drive.listDocuments('directory-token', CONFIG, undefined, context())
    const two = await drive.listDocuments('directory-token', CONFIG, one.nextCursor, context())
    expect(two.documents).toEqual([])
    expect(two.hasMore).toBe(true)
    const three = await drive.listDocuments('directory-token', CONFIG, two.nextCursor, context())
    expect(three.documents[0].externalId).toBe('private-bob')
    expect(three.hasMore).toBe(false)
  })

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

  it('stops before provider access when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      drive.listDocuments('directory-token', CONFIG, undefined, {
        ...context(),
        signal: controller.signal,
      })
    ).rejects.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('Company-wide setup validation', () => {
  it('validates only a bounded active user sample by default', async () => {
    fixture({})
    await expect(validateGoogleCompanyConfig('directory-token', CONFIG, context())).resolves.toBe(
      'alice@corp.com'
    )
    const sample = mockFetch.mock.calls.find(([address]) =>
      new URL(address).pathname.endsWith('/users')
    )
    expect(new URL(sample![0]).searchParams.get('maxResults')).toBe('1')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

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

  it('probes delegated Drive access without requiring the administrator to open selected folders', async () => {
    fixture({})
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
      const path = new URL(address).pathname
      if (path.endsWith('/groups')) return json({ groups: [] })
      if (path.endsWith('/domains')) return json({ domains: [] })
      return route(address, init)
    })
    const ctx = context()
    await expect(
      drive.validateConfig(
        'directory-token',
        { ...CONFIG, folderId: 'private-employee-folder' },
        ctx
      )
    ).resolves.toEqual({ valid: true })
    expect(ctx.getDelegatedAccessToken).toHaveBeenCalledExactlyOnceWith('alice@corp.com')
    const driveRequests = mockFetch.mock.calls.filter(
      ([address]) => new URL(address).hostname === 'www.googleapis.com'
    )
    expect(driveRequests).toHaveLength(1)
    expect(new URL(driveRequests[0][0]).searchParams.get('pageSize')).toBe('1')
    expect(driveRequests[0][1].headers.Authorization).toBe('Bearer delegated:alice@corp.com')
  })

  it('falls back to the verified administrator if the filtered sample is inactive or empty', async () => {
    fixture({ users: [USER('admin@corp.com')] })
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
      const url = new URL(address)
      if (url.pathname.endsWith('/users')) {
        expect(url.searchParams.get('query')).toBe(
          'isSuspended=false isArchived=false isGuest=false'
        )
        return json({ users: [USER('suspended@corp.com', { suspended: true })] })
      }
      return route(address, init)
    })
    await expect(validateGoogleCompanyConfig('directory-token', CONFIG, context())).resolves.toBe(
      'admin@corp.com'
    )
  })

  it('rejects disabled Drive access during setup', async () => {
    fixture({})
    const route = mockFetch.getMockImplementation()!
    mockFetch.mockImplementation(async (address: string, init: RequestInit) => {
      const path = new URL(address).pathname
      if (path.endsWith('/groups')) return json({ groups: [] })
      if (path.endsWith('/domains')) return json({ domains: [] })
      if (new URL(address).hostname === 'www.googleapis.com')
        return json({ error: { errors: [{ reason: 'accessNotConfigured' }] } }, 403)
      return route(address, init)
    })
    await expect(drive.validateConfig('directory-token', CONFIG, context())).resolves.toMatchObject(
      { valid: false, error: expect.stringContaining('403') }
    )
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
  it('rejects repeated continuation and directory authorization failures', async () => {
    mockFetch.mockResolvedValueOnce(json({ users: [], nextPageToken: 'same' }))
    await expect(listGoogleWorkspaceUsers('token', 'same')).rejects.toThrow('repeated')
    mockFetch.mockResolvedValueOnce(json({ error: { errors: [{ reason: 'forbidden' }] } }, 403))
    await expect(listGoogleWorkspaceUsers('token')).rejects.toBeInstanceOf(GoogleDriveApiError)
  })
  it('validates explicit user emails and their bound', () => {
    expect(selectedGoogleWorkspaceUsers(' Alice@Corp.com,alice@corp.com ')).toEqual([
      'alice@corp.com',
    ])
    expect(() => selectedGoogleWorkspaceUsers('not-an-email')).toThrow('valid')
    expect(() => selectedGoogleWorkspaceUsers(['alice@corp.com', 123])).toThrow()
    expect(() => selectedGoogleWorkspaceUsers({ email: 'alice@corp.com' })).toThrow()
    expect(() =>
      selectedGoogleWorkspaceUsers(Array.from({ length: 101 }, (_, i) => `u${i}@corp.com`))
    ).toThrow('100')
  })
})
