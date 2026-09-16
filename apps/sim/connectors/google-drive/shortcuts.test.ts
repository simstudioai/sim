/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('@/components/icons', () => ({ GoogleDriveIcon: () => null }))

vi.mock('@/connectors/google-drive/workspace-drives', () => ({
  GOOGLE_WORKSPACE_DRIVES_PAGE_SIZE: 100,
  listGoogleWorkspaceDrives: async () => ({ driveIds: [] }),
}))

/** The file/ACL tests isolate Directory enumeration; company-crawl tests exercise its real HTTP boundary. */
vi.mock('@/connectors/google-workspace/users', () => ({
  GOOGLE_WORKSPACE_USERS_PAGE_SIZE: 100,
  selectedGoogleWorkspaceUsers: () => [],
  listGoogleWorkspaceUsers: async () => ({
    users: [{ id: 'admin', email: 'admin@corp.com', customerId: 'customer', active: true }],
  }),
  getGoogleWorkspaceUser: async () => ({
    id: 'admin',
    email: 'admin@corp.com',
    customerId: 'customer',
    active: true,
  }),
}))

function companyContext(): Record<string, unknown> {
  return {
    mirrorsSourceAcls: true,
    getDelegatedAccessToken: async () => 'token',
    googleDrivePageAccess: { token: 'token', externalIds: new Set(['shortcut']) },
  }
}

import { googleDriveConnector as drive } from '@/connectors/google-drive/google-drive'
import { GoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'
import { CONNECTOR_MAX_FILE_BYTES } from '@/connectors/utils'

const shortcutMime = 'application/vnd.google-apps.shortcut'
const docMime = 'application/vnd.google-apps.document'
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const denied = (reason = 'notFound', status = 404) =>
  new Response(JSON.stringify({ error: { errors: [{ reason }] } }), { status })
function file(overrides: Record<string, unknown> = {}) {
  return {
    id: 'target',
    name: 'Target.pdf',
    mimeType: 'application/pdf',
    modifiedTime: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}
function shortcut(overrides: Record<string, unknown> = {}) {
  return file({
    id: 'shortcut',
    name: 'Alias.pdf',
    mimeType: shortcutMime,
    shortcutDetails: { targetId: 'target', targetMimeType: 'application/pdf' },
    ...overrides,
  })
}
const urlAt = (index: number) => new URL(String(fetchMock.mock.calls[index][0]))

describe('Drive file shortcuts', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('downloads the target PDF and keeps the shortcut identity and listing hash', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ files: [shortcut()] }))
      .mockResolvedValueOnce(json(file()))
    const listing = await drive.listDocuments('token', {})
    expect(listing.documents).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock
      .mockResolvedValueOnce(json(shortcut()))
      .mockResolvedValueOnce(json(file()))
      .mockResolvedValueOnce(new Response('%PDF-fixture'))
    const hydrated = await drive.getDocument('token', {}, 'shortcut')
    expect(hydrated).toMatchObject({
      externalId: 'shortcut',
      title: 'Alias.pdf',
      contentHash: listing.documents[0].contentHash,
      contentDeferred: false,
      mimeType: 'application/pdf',
      sourceFile: { fileName: 'Target.pdf', bytes: Buffer.from('%PDF-fixture') },
    })
    expect(urlAt(4).pathname).toBe('/drive/v3/files/target')
    expect(urlAt(4).searchParams.get('alt')).toBe('media')
  })

  it('uses current target MIME and filename instead of stale shortcut hints', async () => {
    fetchMock
      .mockResolvedValueOnce(json(shortcut()))
      .mockResolvedValueOnce(json(file({ name: 'Native document', mimeType: docMime })))
      .mockResolvedValueOnce(new Response('Native content'))
    expect(await drive.getDocument('token', {}, 'shortcut')).toMatchObject({
      content: 'Native content',
      mimeType: 'text/plain',
    })
    expect(urlAt(2).pathname).toBe('/drive/v3/files/target/export')
  })

  it('sends resource keys to target metadata and content only, without persisting them', async () => {
    const alias = shortcut({
      shortcutDetails: { targetId: 'target', targetResourceKey: 'synthetic-resource-key' },
    })
    fetchMock
      .mockResolvedValueOnce(json(alias))
      .mockResolvedValueOnce(json(file()))
      .mockResolvedValueOnce(new Response('pdf'))
    const hydrated = await drive.getDocument('token', {}, 'shortcut')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('X-Goog-Drive-Resource-Keys')).toBe(
      false
    )
    for (const index of [1, 2])
      expect(
        new Headers(fetchMock.mock.calls[index][1].headers).get('X-Goog-Drive-Resource-Keys')
      ).toBe('target/synthetic-resource-key')
    expect(JSON.stringify(hydrated)).not.toContain('synthetic-resource-key')
  })

  it('observes target edits during incremental listings without downloading unchanged content', async () => {
    const hashes = []
    for (const modifiedTime of ['2026-01-01', '2026-01-02']) {
      fetchMock
        .mockResolvedValueOnce(json({ files: [shortcut()] }))
        .mockResolvedValueOnce(json(file({ modifiedTime })))
      const page = await drive.listDocuments('token', {}, undefined, {}, new Date('2026-01-01'))
      hashes.push(page.documents[0].contentHash)
    }
    expect(hashes[0]).not.toBe(hashes[1])
    expect(urlAt(0).searchParams.get('q')).toContain(`or mimeType = '${shortcutMime}'`)
    expect(
      fetchMock.mock.calls.every(([url]) => !new URL(String(url)).searchParams.has('alt'))
    ).toBe(true)
  })

  it('includes shortcuts in type-filtered queries and filters on the current target', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ files: [shortcut()] }))
      .mockResolvedValueOnce(json(file({ mimeType: docMime })))
    const page = await drive.listDocuments('token', { fileType: 'documents' })
    expect(page.documents).toHaveLength(1)
    expect(urlAt(0).searchParams.get('q')).toContain(`mimeType = '${shortcutMime}'`)
    fetchMock
      .mockResolvedValueOnce(json({ files: [shortcut()] }))
      .mockResolvedValueOnce(json(file()))
    expect((await drive.listDocuments('token', { fileType: 'documents' })).documents).toEqual([])
  })

  it.each(['application/vnd.google-apps.folder', shortcutMime, 'application/vnd.google-apps.form'])(
    'does not download unsupported native %s with a PDF filename',
    async (mimeType) => {
      fetchMock
        .mockResolvedValueOnce(json(shortcut()))
        .mockResolvedValueOnce(json(file({ mimeType })))
      expect(await drive.getDocument('token', {}, 'shortcut')).toMatchObject({
        skippedExistingDisposition: 'replace',
        skippedReason: 'File is no longer an indexable document',
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  )

  it.each([
    { targetId: 'shortcut' },
    { targetId: 'other', targetResourceKey: 'bad\r\nheader' },
    { targetId: '' },
    null,
  ])(
    'rejects malformed or cyclic target metadata before requesting it',
    async (shortcutDetails) => {
      fetchMock.mockResolvedValueOnce(json(shortcut({ shortcutDetails })))
      await expect(drive.getDocument('token', {}, 'shortcut')).rejects.toThrow(/malformed|cyclic/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    ['notFound', 404],
    ['insufficientFilePermissions', 403],
  ] as const)(
    'withdraws member visibility and clears unavailable target content for %s',
    async (reason, status) => {
      fetchMock
        .mockResolvedValueOnce(json({ files: [shortcut()] }))
        .mockResolvedValueOnce(denied(reason, status))
      expect(
        (await drive.listDocuments('token', {}, undefined, { perMemberListing: true })).documents
      ).toEqual([])
      fetchMock
        .mockResolvedValueOnce(json(shortcut()))
        .mockResolvedValueOnce(denied(reason, status))
      expect(await drive.getDocument('token', {}, 'shortcut')).toMatchObject({
        skippedExistingDisposition: 'replace',
        acl: [],
        skippedReason: expect.stringContaining('Shortcut target is unavailable'),
      })
    }
  )

  it('keeps other source documents progressing when target metadata fails', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ files: [shortcut(), file({ id: 'ordinary' })] }))
      .mockResolvedValueOnce(denied('invalid', 400))
    const page = await drive.listDocuments('token', {})
    expect(page.documents.map((doc) => doc.externalId)).toEqual(['shortcut', 'ordinary'])
    expect(page.documents[0]).toMatchObject({ contentDeferred: true, acl: [] })
    fetchMock
      .mockResolvedValueOnce(json({ files: [shortcut()] }))
      .mockResolvedValueOnce(denied('invalid', 400))
    await expect(
      drive.listDocuments('token', {}, undefined, { perMemberListing: true })
    ).rejects.toBeInstanceOf(GoogleDriveApiError)
  })

  it('requires both shortcut and target permissions when mirroring ACLs', async () => {
    const alias = shortcut({
      permissions: [{ type: 'user', emailAddress: 'alice@fixture.test', role: 'reader' }],
    })
    const target = file({
      permissions: [{ type: 'group', emailAddress: 'team@fixture.test', role: 'reader' }],
    })
    fetchMock.mockResolvedValueOnce(json({ files: [alias] })).mockResolvedValueOnce(json(target))
    const page = await drive.listDocuments(
      'token',
      { adminEmail: 'admin@fixture.test' },
      undefined,
      companyContext()
    )
    expect(page.documents[0].acl).toEqual({
      acl: ['u:alice@fixture.test'],
      requirements: [['g:google-drive:fixture.test:team@fixture.test']],
    })
  })

  it('preserves the target restriction through the separate ACL lookup hook', async () => {
    const alias = shortcut({
      permissions: [{ type: 'user', emailAddress: 'alice@fixture.test', role: 'reader' }],
    })
    const target = file({
      permissions: [{ type: 'user', emailAddress: 'bob@fixture.test', role: 'reader' }],
    })
    fetchMock.mockResolvedValueOnce(json({ files: [alias] })).mockResolvedValueOnce(json(target))
    const page = await drive.listDocuments('token', {})
    expect(page.documents[0].acl).toBeUndefined()
    fetchMock.mockResolvedValueOnce(json(alias)).mockResolvedValueOnce(json(target))
    const acls = await drive.getDocumentAcls!(
      'token',
      { adminEmail: 'admin@fixture.test' },
      page.documents,
      companyContext()
    )
    expect(acls.shortcut).toEqual({
      acl: ['u:alice@fixture.test'],
      requirements: [['u:bob@fixture.test']],
    })
    fetchMock.mockResolvedValueOnce(json(alias)).mockResolvedValueOnce(denied())
    expect(
      await drive.getDocumentAcls!(
        'token',
        { adminEmail: 'admin@fixture.test' },
        page.documents,
        companyContext()
      )
    ).toEqual({ shortcut: [] })
  })

  it('keeps denied target permissions unresolved without granting shortcut-only access', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          files: [
            shortcut({
              permissions: [{ type: 'anyone', role: 'reader', allowFileDiscovery: true }],
              shortcutDetails: { targetId: 'target', targetResourceKey: 'key' },
            }),
          ],
        })
      )
      .mockResolvedValueOnce(json(file()))
      .mockResolvedValueOnce(denied('insufficientFilePermissions', 403))
    const page = await drive.listDocuments(
      'token',
      { adminEmail: 'admin@fixture.test', openSharing: 'anyone' },
      undefined,
      companyContext()
    )
    expect(page.documents[0].acl).toBeUndefined()
    expect(urlAt(2).pathname).toBe('/drive/v3/files/target/permissions')
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('X-Goog-Drive-Resource-Keys')).toBe(
      'target/key'
    )
  })

  it('rechecks both permissions when target metadata failed before a target ID was recorded', async () => {
    const alias = shortcut({
      permissions: [{ type: 'anyone', role: 'reader', allowFileDiscovery: true }],
    })
    const context = companyContext()
    const config = { adminEmail: 'admin@fixture.test', openSharing: 'anyone' }
    fetchMock
      .mockResolvedValueOnce(json({ files: [alias] }))
      .mockResolvedValueOnce(denied('invalid', 400))
    const page = await drive.listDocuments('token', config, undefined, context)
    expect(page.documents[0].acl).toBeUndefined()
    expect(page.documents[0].metadata).toMatchObject({ originalMimeType: shortcutMime })
    expect(page.documents[0].metadata?.shortcutTargetId).toBeUndefined()

    fetchMock.mockResolvedValueOnce(json(alias)).mockResolvedValueOnce(denied('invalid', 400))
    expect(await drive.getDocumentAcls!('token', config, page.documents, context)).toEqual({})
    expect(urlAt(2).pathname).toBe('/drive/v3/files/shortcut')
    expect(urlAt(3).pathname).toBe('/drive/v3/files/target')

    fetchMock.mockResolvedValueOnce(json(alias)).mockResolvedValueOnce(
      json(
        file({
          permissions: [{ type: 'user', emailAddress: 'alice@fixture.test', role: 'reader' }],
        })
      )
    )
    expect(await drive.getDocumentAcls!('token', config, page.documents, context)).toEqual({
      shortcut: { acl: ['pub'], requirements: [['u:alice@fixture.test']] },
    })
  })

  it('checks target size at listing and caps target bytes while downloading', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ files: [shortcut()] }))
      .mockResolvedValueOnce(json(file({ size: String(CONNECTOR_MAX_FILE_BYTES + 1) })))
    expect((await drive.listDocuments('token', {})).documents[0].skippedReason).toContain('exceeds')
    fetchMock
      .mockResolvedValueOnce(json(shortcut()))
      .mockResolvedValueOnce(json(file()))
      .mockResolvedValueOnce(
        new Response('small', {
          headers: { 'Content-Length': String(CONNECTOR_MAX_FILE_BYTES + 1) },
        })
      )
    expect((await drive.getDocument('token', {}, 'shortcut'))?.skippedReason).toContain('exceeds')
  })

  it('caps metadata bytes before parsing', async () => {
    fetchMock
      .mockResolvedValueOnce(json(shortcut()))
      .mockResolvedValueOnce(
        new Response('{}', { headers: { 'Content-Length': String(1024 * 1024 + 1) } })
      )
    await expect(drive.getDocument('token', {}, 'shortcut')).rejects.toThrow('metadata exceeded')
  })

  it('bounds shortcut metadata concurrency to eight without fetching ordinary files', async () => {
    let active = 0
    let peak = 0
    fetchMock.mockImplementation(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/files'))
        return json({
          files: Array.from({ length: 30 }, (_, index) => shortcut({ id: `alias-${index}` })),
        })
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return json(file())
    })
    expect((await drive.listDocuments('token', {})).documents).toHaveLength(30)
    expect(peak).toBeLessThanOrEqual(8)
  })

  it('durably sweeps shortcuts after an empty change feed to find target updates and revocations', async () => {
    fetchMock.mockResolvedValueOnce(json({ changes: [], newStartPageToken: 'resume' }))
    const changes = await drive.listChanges!('token', {}, 'start')
    expect(changes.hasMore).toBe(true)
    fetchMock
      .mockResolvedValueOnce(json({ files: [shortcut()], nextPageToken: 'page-two' }))
      .mockResolvedValueOnce(json(file()))
    const first = await drive.listChanges!('token', {}, changes.nextCursor!)
    expect(first).toMatchObject({
      hasMore: true,
      changes: [{ kind: 'upsert', externalId: 'shortcut' }],
    })
    expect(urlAt(1).searchParams.get('q')).toBe(`trashed = false and mimeType = '${shortcutMime}'`)
    fetchMock
      .mockResolvedValueOnce(json({ files: [shortcut({ id: 'revoked' })] }))
      .mockResolvedValueOnce(denied())
    const second = await drive.listChanges!('token', {}, first.nextCursor!)
    expect(second).toEqual({
      changes: [{ kind: 'removed', externalId: 'revoked' }],
      hasMore: false,
      nextCursor: 'resume',
    })
    expect(urlAt(3).searchParams.get('pageToken')).toBe('page-two')
  })

  it('rejects corrupt shortcut cursors and incomplete searches without advancing the feed', async () => {
    await expect(drive.listChanges!('token', {}, 'gdrive-shortcuts:v1:invalid')).rejects.toThrow(
      'must restart'
    )
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(json({ changes: [], newStartPageToken: 'resume' }))
    const page = await drive.listChanges!('token', {}, 'start')
    fetchMock.mockResolvedValueOnce(json({ files: [], incompleteSearch: true }))
    await expect(drive.listChanges!('token', {}, page.nextCursor!)).rejects.toThrow('incomplete')
  })
})
