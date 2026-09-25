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
