import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

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
    googleDrivePageAccess: { token: 'token', externalIds: new Set(['drive-file-1']) },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

import {
  DOWNLOAD_RESTRICTED_SKIP_REASON,
  googleDriveConnector,
} from '@/connectors/google-drive/google-drive'
import { readGoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'
import type { ExternalDocument } from '@/connectors/types'
import { CONNECTOR_MAX_FILE_BYTES } from '@/connectors/utils'

const FILE_ID = 'drive-file-1'
/** The listed document the ACL hook is asked about; only its id matters to Drive. */
const FILE_DOC: ExternalDocument = {
  externalId: FILE_ID,
  title: 'File',
  content: '',
  mimeType: 'text/plain',
  contentHash: 'h',
}
const GOOGLE_DOCUMENT_MIME_TYPE = 'application/vnd.google-apps.document'
const _GOOGLE_SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet'
const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

describe('Google Drive administrator setup', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('requires a delegated administrator only when mirroring source permissions', async () => {
    await expect(
      googleDriveConnector.validateConfig('token', {}, companyContext())
    ).resolves.toMatchObject({
      valid: false,
      error: expect.stringContaining('Directory administrator email'),
    })
    expect(mockFetch).not.toHaveBeenCalled()
    mockFetch.mockResolvedValue(jsonResponse({ files: [] }))
    await expect(googleDriveConnector.validateConfig('token', {})).resolves.toEqual({ valid: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toContain('/drive/v3/files?')
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function driveErrorResponse(reason: string, message: string, status = 403): Response {
  return jsonResponse(
    {
      error: {
        code: status,
        errors: [{ domain: 'global', reason, message }],
        message,
      },
    },
    status
  )
}

function fileMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FILE_ID,
    name: 'Product plan',
    mimeType: GOOGLE_DOCUMENT_MIME_TYPE,
    modifiedTime: '2026-08-20T12:00:00Z',
    webViewLink: `https://drive.google.com/file/d/${FILE_ID}/view`,
    ...overrides,
  }
}

async function hydrateWithExportResponse(exportResponse: Response) {
  mockFetch
    .mockResolvedValueOnce(jsonResponse(fileMetadata()))
    .mockResolvedValueOnce(exportResponse)
  return googleDriveConnector.getDocument('token', {}, FILE_ID)
}

describe('Google Drive recursive folders and raw files', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('continues nested folders and parent pages durably without payload in the cursor', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          files: [fileMetadata({ id: 'child', name: 'Child', mimeType: GOOGLE_FOLDER_MIME_TYPE })],
          nextPageToken: 'parent-next',
        })
      )
      .mockResolvedValueOnce(jsonResponse({ files: [fileMetadata({ id: 'nested-doc' })] }))
      .mockResolvedValueOnce(jsonResponse({ files: [fileMetadata({ id: 'parent-doc' })] }))
    const config = { folderId: 'root', fileType: 'documents' }
    const first = await googleDriveConnector.listDocuments(
      'token',
      config,
      undefined,
      {},
      new Date()
    )
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    const second = await googleDriveConnector.listDocuments('token', config, first.nextCursor, {})
    const third = await googleDriveConnector.listDocuments('token', config, second.nextCursor, {})
    expect(second.documents.map((item) => item.externalId)).toEqual(['nested-doc'])
    expect(third.documents.map((item) => item.externalId)).toEqual(['parent-doc'])
    expect(third.hasMore).toBe(false)
    const urls = mockFetch.mock.calls.map(([url]) => new URL(String(url)))
    expect(urls[0].searchParams.get('q')).toContain(
      "mimeType = 'application/vnd.google-apps.folder'"
    )
    expect(urls[0].searchParams.get('q')).not.toContain('modifiedTime >')
    expect(urls[1].searchParams.get('q')).toContain("'child' in parents")
    expect(urls[2].searchParams.get('q')).toContain("'root' in parents")
    expect(urls[2].searchParams.get('pageToken')).toBe('parent-next')
    expect(first.nextCursor?.length).toBeLessThan(1000)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('preserves nested per-document ACLs instead of copying the folder grant', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ files: [fileMetadata({ id: 'child', mimeType: GOOGLE_FOLDER_MIME_TYPE })] })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          files: [
            fileMetadata({
              permissions: [{ type: 'user', emailAddress: 'reader@example.com', role: 'reader' }],
            }),
          ],
        })
      )
    const config = { folderId: 'root', adminEmail: 'admin@example.com' }
    const context = companyContext()
    const first = await googleDriveConnector.listDocuments('token', config, undefined, context)
    const second = await googleDriveConnector.listDocuments(
      'token',
      config,
      first.nextCursor,
      context
    )
    expect(second.documents[0].acl).toEqual(['u:reader@example.com'])
  })

  it('withdraws an unreachable member subtree and continues its other roots', async () => {
    mockFetch
      .mockResolvedValueOnce(driveErrorResponse('insufficientFilePermissions', 'No access'))
      .mockResolvedValueOnce(jsonResponse({ files: [fileMetadata()] }))
    const config = { folderId: ['readable', 'unreadable'] }
    const first = await googleDriveConnector.listDocuments('token', config, undefined, {
      perMemberListing: true,
    })
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    const second = await googleDriveConnector.listDocuments('token', config, first.nextCursor, {
      perMemberListing: true,
    })
    expect(second.documents).toHaveLength(1)
    expect(second.hasMore).toBe(false)
  })

  it('fails a shared credential listing instead of reconciling an unreadable subtree', async () => {
    mockFetch.mockResolvedValueOnce(driveErrorResponse('insufficientFilePermissions', 'No access'))
    await expect(
      googleDriveConnector.listDocuments('token', { folderId: 'root' }, undefined, {})
    ).rejects.toMatchObject({ kind: 'permission' })
  })

  it('persists the document cap across fresh contexts and suppresses incomplete reconciliation', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          files: [fileMetadata(), fileMetadata({ id: 'child', mimeType: GOOGLE_FOLDER_MIME_TYPE })],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ files: [fileMetadata({ id: 'second' })], nextPageToken: 'more' })
      )
    const config = { folderId: 'root', maxFiles: 2 }
    const first = await googleDriveConnector.listDocuments('token', config, undefined, {})
    const context: Record<string, unknown> = {}
    const second = await googleDriveConnector.listDocuments(
      'token',
      config,
      first.nextCursor,
      context
    )
    expect(second.documents).toHaveLength(1)
    expect(second.hasMore).toBe(false)
    expect(context.listingCapped).toBe(true)
    expect(context.totalDocsFetched).toBe(2)
  })

  it('rejects excessive continuation depth without recursing indefinitely', async () => {
    const cursor = `gdrive-tree:1:${Buffer.from(JSON.stringify({ pending: [{ id: 'deep', depth: 128 }], totalFetched: 0 })).toString('base64url')}`
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ files: [fileMetadata({ id: 'deeper', mimeType: GOOGLE_FOLDER_MIME_TYPE })] })
    )
    await expect(
      googleDriveConnector.listDocuments('token', { folderId: 'root' }, cursor)
    ).rejects.toThrow('nesting-depth limit')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('enforces raw download limits even when listing metadata omitted its size', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(fileMetadata({ name: 'plan.pdf', mimeType: 'application/pdf' }))
      )
      .mockResolvedValueOnce(
        new Response('tiny', {
          headers: { 'Content-Length': String(CONNECTOR_MAX_FILE_BYTES + 1) },
        })
      )
    const hydrated = await googleDriveConnector.getDocument('token', {}, FILE_ID)
    expect(hydrated?.skippedReason).toContain('limit')
    expect(hydrated?.sourceFile).toBeUndefined()
  })
})

describe('Google Drive API error parsing', () => {
  it.each([401, 403, 404, 429, 503])(
    'invalidates only authenticated API401 errors (status=%s)',
    async (status) => {
      const error = await readGoogleDriveApiError(
        driveErrorResponse('authError', 'Provider message', status)
      )
      expect(googleDriveConnector.isCredentialInvalidError?.(error)).toBe(status === 401)
    }
  )

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('normalizes only structured rate-limit reasons into the shared throttle signal', async () => {
    const rateLimit = await readGoogleDriveApiError(
      driveErrorResponse('userRateLimitExceeded', 'Provider message')
    )
    const backendFailure = await readGoogleDriveApiError(
      driveErrorResponse('backendError', 'Provider message', 503)
    )

    expect(rateLimit.rateLimited).toBe(true)
    expect(backendFailure.rateLimited).toBe(false)
  })

  it('bounds and redacts provider reasons without losing classification', async () => {
    const secret = 'sk-provider-controlled-secret-value'
    const reasons = [
      ...Array.from({ length: 20 }, (_, index) => `${index}-${secret}-${'x'.repeat(200)}`),
      'quotaExceeded',
    ]
    const error = await readGoogleDriveApiError(
      jsonResponse(
        {
          error: {
            errors: reasons.map((reason) => ({ reason })),
            message: 'Provider message',
          },
        },
        403
      )
    )

    expect(error.kind).toBe('quota')
    expect(error.reasons).toEqual(['quotaExceeded'])
    expect(JSON.stringify(error.reasons)).not.toContain(secret)
    expect(error.message).not.toContain(secret)
  })
})

describe('Google Drive download-restricted files', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  const restricted = () => fileMetadata({ capabilities: { canDownload: false } })

  it.each([
    ['a workspace crawl', {}],
    ['a per-member listing', { perMemberListing: true }],
  ])('skips a restricted file at listing time in %s', async (_label, syncContext) => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ files: [restricted()] }))
    const page = await googleDriveConnector.listDocuments('token', {}, undefined, syncContext)

    expect(page.documents).toHaveLength(1)
    expect(page.documents[0].skippedReason).toBe(DOWNLOAD_RESTRICTED_SKIP_REASON)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('Google Drive metadata hydration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it.each([{}, { ...fileMetadata(), id: 'different-file' }])(
    'rejects malformed metadata instead of replacing retained content',
    async (metadata) => {
      mockFetch.mockResolvedValueOnce(jsonResponse(metadata))

      await expect(googleDriveConnector.getDocument('token', {}, FILE_ID)).rejects.toThrow(
        'Google Drive API returned malformed file metadata'
      )
    }
  )
})

describe('Google Drive export failures', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('records the documented export size limit as a terminal skipped document', async () => {
    const document = await hydrateWithExportResponse(
      driveErrorResponse('exportSizeLimitExceeded', 'Export exceeds the 10 MB limit')
    )

    expect(document?.contentDeferred).toBe(false)
    expect(document?.skippedReason).toContain('10MB size limit')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['notFound', 'File not found.', 404],
    [
      'insufficientFilePermissions',
      'The user does not have sufficient permissions for this file.',
      403,
    ],
    ['domainPolicy', 'The domain administrators have disabled Drive apps.', 403],
    ['cannotExportFile', 'This file cannot be exported by the user.', 403],
    ['cannotDownloadFile', 'This file cannot be downloaded by the user.', 403],
    ['fileNotExportable', 'This file cannot be exported.', 403],
  ])(
    'propagates recoverable %s failures instead of persisting a sticky same-hash skip',
    async (reason, message, status) => {
      await expect(
        hydrateWithExportResponse(driveErrorResponse(reason, message, status))
      ).rejects.toMatchObject({ name: 'GoogleDriveApiError', status })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    }
  )
})

describe('Google Drive connector limits', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('does not let an oversized skipped file consume the maxFiles budget', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          files: [
            fileMetadata({
              id: 'oversized',
              name: 'oversized.txt',
              mimeType: 'text/plain',
              size: String(CONNECTOR_MAX_FILE_BYTES + 1),
            }),
          ],
          nextPageToken: 'next-page',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          files: [
            fileMetadata({
              id: 'indexable',
              name: 'notes.txt',
              mimeType: 'text/plain',
              size: '12',
            }),
          ],
        })
      )

    const syncContext: Record<string, unknown> = {}
    const first = await googleDriveConnector.listDocuments(
      'token',
      { maxFiles: '1' },
      undefined,
      syncContext
    )
    const second = await googleDriveConnector.listDocuments(
      'token',
      { maxFiles: '1' },
      first.nextCursor,
      syncContext
    )

    expect(first.documents[0].skippedReason).toBeDefined()
    expect(first.hasMore).toBe(true)
    expect(second.documents.map((document) => document.externalId)).toEqual(['indexable'])
    expect(syncContext.totalDocsFetched).toBe(1)
  })

  it('makes an incomplete cross-corpus search non-authoritative', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ files: [fileMetadata()], incompleteSearch: true })
    )
    const syncContext: Record<string, unknown> = {}

    const result = await googleDriveConnector.listDocuments('token', {}, undefined, syncContext)

    expect(result.documents.map((document) => document.externalId)).toEqual([FILE_ID])
    expect(result.reconciliationSafe).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it.each(['1.5', 'Infinity', 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid persisted maxFiles %s before listing from Drive',
    async (maxFiles) => {
      await expect(googleDriveConnector.listDocuments('token', { maxFiles })).rejects.toThrow(
        'Max files must be a positive safe integer, or 0 for unlimited'
      )
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )
})

describe('Google Drive change feed', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('reports lost access and trashed files as removals and in-scope files as upserts', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        changes: [
          { changeType: 'file', fileId: 'gone', removed: true },
          {
            changeType: 'file',
            fileId: 'binned',
            file: fileMetadata({ id: 'binned', trashed: true }),
          },
          {
            changeType: 'file',
            fileId: 'kept',
            file: fileMetadata({ id: 'kept', parents: ['f-1'] }),
          },
          {
            changeType: 'file',
            fileId: 'moved-out',
            file: fileMetadata({ id: 'moved-out', parents: ['elsewhere'] }),
          },
          {
            changeType: 'file',
            fileId: 'video',
            file: fileMetadata({ id: 'video', mimeType: 'video/mp4', parents: ['f-1'] }),
          },
          { changeType: 'drive', driveId: 'd-1' },
        ],
        newStartPageToken: '5000',
      })
    )

    const result = await googleDriveConnector.listChanges!('token', { folderId: 'f-1' }, '4821')

    expect(result.changes).toEqual([
      { kind: 'removed', externalId: 'gone' },
      { kind: 'removed', externalId: 'binned' },
      {
        kind: 'upsert',
        externalId: 'kept',
        document: expect.objectContaining({ externalId: 'kept' }),
      },
      { kind: 'removed', externalId: 'moved-out' },
      { kind: 'removed', externalId: 'video' },
    ])
    expect(result.nextCursor).toMatch(/^gdrive-shortcuts:v1:/)
    expect(result.hasMore).toBe(true)
    mockFetch.mockResolvedValueOnce(jsonResponse({ files: [] }))
    await expect(
      googleDriveConnector.listChanges!('token', {}, result.nextCursor!)
    ).resolves.toEqual({ changes: [], nextCursor: '5000', hasMore: false })
    const url = new URL(String(mockFetch.mock.calls[0][0]))
    expect(url.searchParams.get('pageToken')).toBe('4821')
    expect(url.searchParams.get('includeRemoved')).toBe('true')
  })

  it('rejects a feed page without a cursor to continue from', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ changes: [] }))

    await expect(googleDriveConnector.listChanges!('token', {}, '4821')).rejects.toThrow(
      'malformed change-list metadata'
    )
  })
})

describe('mirroring Drive permissions onto listed documents', () => {
  const ADMIN = { adminEmail: 'admin@corp.com' }

  function fileListResponse(files: unknown[]): Response {
    return jsonResponse({ kind: 'drive#fileList', files })
  }

  function driveFile(overrides: Record<string, unknown>) {
    return {
      id: FILE_ID,
      name: 'Plan',
      mimeType: GOOGLE_DOCUMENT_MIME_TYPE,
      modifiedTime: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  /** The engine seeds this on every mirroring run; without it a crawl reads no permissions. */
  const MIRRORING = companyContext()

  async function listWith(file: Record<string, unknown>, sourceConfig: Record<string, unknown>) {
    mockFetch.mockResolvedValueOnce(fileListResponse([file]))
    const result = await googleDriveConnector.listDocuments('token', sourceConfig, undefined, {
      ...MIRRORING,
    })
    return result.documents[0]
  }

  it('tags each document with who may read it', async () => {
    const doc = await listWith(
      driveFile({
        permissions: [
          { id: 'p1', type: 'user', emailAddress: 'Alice@corp.com' },
          { id: 'p2', type: 'group', emailAddress: 'eng@corp.com' },
        ],
      }),
      ADMIN
    )

    expect(doc.acl).toEqual(['g:google-drive:corp.com:eng@corp.com', 'u:alice@corp.com'])
  })

  it('mirrors no ACL at all when no administrator is configured', async () => {
    const doc = await listWith(
      driveFile({ permissions: [{ id: 'p1', type: 'user', emailAddress: 'alice@corp.com' }] }),
      {}
    )

    expect(doc.acl).toBeUndefined()
  })

  it('keeps an openly shared file out of search until the admin opts in', async () => {
    const shared = driveFile({
      permissions: [{ id: 'p1', type: 'domain', domain: 'corp.com', allowFileDiscovery: true }],
    })

    await expect(listWith(shared, ADMIN)).resolves.toMatchObject({ acl: ['link'] })
    await expect(listWith(shared, { ...ADMIN, openSharing: 'domain' })).resolves.toMatchObject({
      acl: ['g:google-drive:corp.com:domain:corp.com'],
    })
  })

  it('never makes a link-only share findable, even with open sharing on', async () => {
    const doc = await listWith(
      driveFile({ permissions: [{ id: 'p1', type: 'anyone', allowFileDiscovery: false }] }),
      { ...ADMIN, openSharing: 'anyone' }
    )

    expect(doc.acl).toEqual(['link'])
  })

  it('follows the permission list across pages', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          permissions: [{ id: 'p1', type: 'user', emailAddress: 'alice@corp.com' }],
          nextPageToken: 'p2',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ permissions: [{ id: 'p2', type: 'user', emailAddress: 'bob@corp.com' }] })
      )

    await expect(
      googleDriveConnector.getDocumentAcls?.('token', ADMIN, [FILE_DOC], { ...MIRRORING })
    ).resolves.toEqual({ [FILE_ID]: ['u:alice@corp.com', 'u:bob@corp.com'] })
  })

  it('omits a file whose permissions could not be read, so it stays hidden', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 403))

    await expect(
      googleDriveConnector.getDocumentAcls?.('token', ADMIN, [FILE_DOC], { ...MIRRORING })
    ).resolves.toEqual({})
  })
})
