/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock('@/components/icons', () => ({ GoogleDriveIcon: () => null }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

import { googleDriveConnector } from '@/connectors/google-drive/google-drive'
import {
  GoogleDriveApiError,
  readGoogleDriveApiError,
} from '@/connectors/google-drive/google-drive-errors'
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
const GOOGLE_SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet'
const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

describe('Google Drive administrator setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('requires a delegated administrator only when mirroring source permissions', async () => {
    await expect(
      googleDriveConnector.validateConfig('token', {}, { mirrorsSourceAcls: true })
    ).resolves.toMatchObject({ valid: false, error: expect.stringContaining('Crawl as') })
    expect(mockFetch).not.toHaveBeenCalled()
    mockFetch.mockResolvedValue(jsonResponse({ files: [] }))
    await expect(googleDriveConnector.validateConfig('token', {})).resolves.toEqual({ valid: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toContain('/drive/v3/files?')
  })

  it.each(['groups', 'domains', 'members'])(
    'rejects denied directory %s even when Drive would work',
    async (denied) => {
      mockFetch.mockImplementation(async (input: string) => {
        const url = new URL(input)
        if (url.pathname.endsWith(`/${denied}`))
          return driveErrorResponse('forbidden', 'Not Authorized', 403)
        if (url.pathname.endsWith('/groups'))
          return jsonResponse({ groups: [{ id: 'first-group' }] })
        return jsonResponse({ domains: [{ domainName: 'corp.com' }], files: [] })
      })
      await expect(
        googleDriveConnector.validateConfig(
          'token',
          { adminEmail: 'admin@corp.com' },
          { mirrorsSourceAcls: true }
        )
      ).resolves.toMatchObject({
        valid: false,
        error: expect.stringContaining('administrator privileges'),
      })
      expect(
        mockFetch.mock.calls.every(([url]) => String(url).includes('admin.googleapis.com'))
      ).toBe(true)
      expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(3)
    }
  )

  it('probes one group and membership without following directory pagination during setup', async () => {
    mockFetch.mockImplementation(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/groups'))
        return jsonResponse({ groups: [{ id: 'first-group' }], nextPageToken: 'more-groups' })
      return jsonResponse({
        domains: [{ domainName: 'corp.com' }],
        members: [],
        files: [],
        nextPageToken: 'more',
      })
    })
    await expect(
      googleDriveConnector.validateConfig(
        'token',
        { adminEmail: 'admin@corp.com' },
        { mirrorsSourceAcls: true }
      )
    ).resolves.toEqual({ valid: true })
    expect(mockFetch).toHaveBeenCalledTimes(4)
    const directoryUrls = mockFetch.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.hostname === 'admin.googleapis.com')
    expect(directoryUrls).toHaveLength(3)
    expect(directoryUrls.every((url) => !url.searchParams.has('pageToken'))).toBe(true)
    expect(
      directoryUrls
        .filter((url) => !url.pathname.endsWith('/domains'))
        .every((url) => url.searchParams.get('maxResults') === '1')
    ).toBe(true)
  })

  it('accepts a directory with no groups without inventing a membership probe', async () => {
    mockFetch.mockImplementation(async () =>
      jsonResponse({ groups: [], domains: [{ domainName: 'corp.com' }], files: [] })
    )
    await expect(
      googleDriveConnector.validateConfig(
        'token',
        { adminEmail: 'admin@corp.com' },
        { mirrorsSourceAcls: true }
      )
    ).resolves.toEqual({ valid: true })
    expect(mockFetch).toHaveBeenCalledTimes(3)
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
    vi.clearAllMocks()
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

  it('walks overlapping selected roots once', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ files: [fileMetadata({ id: 'child-doc' })] }))
      .mockResolvedValueOnce(
        jsonResponse({ files: [fileMetadata({ id: 'child', mimeType: GOOGLE_FOLDER_MIME_TYPE })] })
      )
    const config = { folderId: ['root', 'child', 'root'] }
    const first = await googleDriveConnector.listDocuments('token', config)
    const second = await googleDriveConnector.listDocuments('token', config, first.nextCursor)
    expect(first.documents).toHaveLength(1)
    expect(second.documents).toEqual([])
    expect(second.hasMore).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(2)
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
    const context = { mirrorsSourceAcls: true }
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

  it.each(['old-provider-page', 'gdrive-tree:1:malformed'])(
    'resets invalid saved tree cursor %s',
    async (cursor) => {
      const error = await googleDriveConnector
        .listDocuments('token', { folderId: 'root' }, cursor)
        .catch((value: unknown) => value)
      expect(googleDriveConnector.isListingCursorInvalidError?.(error)).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

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

  it('uses change feeds only for account-wide scope', () => {
    expect(googleDriveConnector.supportsChangeFeed?.({})).toBe(true)
    expect(googleDriveConnector.supportsChangeFeed?.({ folderId: ['root'] })).toBe(false)
  })

  it.each([
    ['plan.pdf', 'application/pdf', 'application/pdf'],
    [
      'plan.docx',
      'application/octet-stream',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    [
      'model.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    [
      'slides.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    ['scan.png', 'image/png', 'image/png'],
  ])(
    'preserves raw %s bytes for the shared parser and OCR pipeline',
    async (name, mimeType, storedMimeType) => {
      const bytes = Buffer.from([0, 255, 20, 80])
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ files: [fileMetadata({ name, mimeType })] }))
        .mockResolvedValueOnce(jsonResponse(fileMetadata({ name, mimeType })))
        .mockResolvedValueOnce(new Response(bytes))
      const page = await googleDriveConnector.listDocuments('token', {})
      expect(page.documents[0].contentDeferred).toBe(true)
      const hydrated = await googleDriveConnector.getDocument('token', {}, FILE_ID)
      expect(hydrated?.contentHash).toBe(page.documents[0].contentHash)
      expect(hydrated?.sourceFile).toEqual({ bytes, fileName: name, mimeType: storedMimeType })
      expect(hydrated?.content).toBe('')
      expect(String(mockFetch.mock.calls[2][0])).toContain('alt=media&supportsAllDrives=true')
    }
  )

  it('keeps Google Docs-only filtering while discovering subfolders', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        files: [
          fileMetadata(),
          fileMetadata({ id: 'pdf', name: 'plan.pdf', mimeType: 'application/pdf' }),
          fileMetadata({ id: 'nested', mimeType: GOOGLE_FOLDER_MIME_TYPE }),
        ],
      })
    )
    const page = await googleDriveConnector.listDocuments('token', {
      folderId: 'root',
      fileType: 'documents',
    })
    expect(page.documents.map((item) => item.externalId)).toEqual([FILE_ID])
    expect(page.hasMore).toBe(true)
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

  it('surfaces raw download permission denial as a failed hydration', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(fileMetadata({ name: 'plan.pdf', mimeType: 'application/pdf' }))
      )
      .mockResolvedValueOnce(driveErrorResponse('insufficientFilePermissions', 'No download'))
    await expect(googleDriveConnector.getDocument('token', {}, FILE_ID)).rejects.toMatchObject({
      kind: 'permission',
    })
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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it.each([
    ['exportSizeLimitExceeded', 'export_too_large'],
    ['insufficientFilePermissions', 'permission'],
    ['appNotAuthorizedToFile', 'permission'],
    ['domainPolicy', 'policy'],
    ['fileNotExportable', 'unsupported_export'],
    ['dailyLimitExceeded', 'quota'],
    ['rateLimitExceeded', 'transient'],
    ['userRateLimitExceeded', 'transient'],
  ] as const)('classifies %s as %s', async (reason, kind) => {
    const error = await readGoogleDriveApiError(driveErrorResponse(reason, 'Provider message'))

    expect(error).toBeInstanceOf(GoogleDriveApiError)
    expect(error.kind).toBe(kind)
    expect(error.reasons).toEqual([reason])
  })

  it('classifies retryable statuses even without a structured reason', async () => {
    const error = await readGoogleDriveApiError(
      new Response('upstream unavailable', { status: 503 })
    )

    expect(error.kind).toBe('transient')
    expect(error.message).not.toContain('upstream unavailable')
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

  it('detects a structured rate limit beyond the bounded diagnostic reasons', async () => {
    const reasons = [
      ...Array.from({ length: 16 }, (_, index) => `providerReason${index}`),
      'userRateLimitExceeded',
    ]
    const error = await readGoogleDriveApiError(
      jsonResponse(
        {
          error: {
            errors: reasons.map((reason) => ({ reason })),
          },
        },
        403
      )
    )

    expect(error.reasons).toEqual(reasons.slice(0, 16))
    expect(error.kind).toBe('transient')
    expect(error.rateLimited).toBe(true)
  })

  it('omits provider messages from diagnostics', async () => {
    const message = `Authorization: Bearer private-token\ncontext ${'x'.repeat(700)}`
    const error = await readGoogleDriveApiError(
      driveErrorResponse('insufficientFilePermissions', message)
    )

    expect(error.message).not.toContain('private-token')
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

  it('discards an error envelope that exceeds the diagnostic body limit', async () => {
    const sentinel = 'sk-over-cap-provider-secret-value'
    const body = JSON.stringify({
      error: {
        errors: [{ reason: 'quotaExceeded' }],
        message: `${'x'.repeat(64 * 1024)}${sentinel}`,
      },
    })

    const error = await readGoogleDriveApiError(
      new Response(body, { status: 403, headers: { 'Content-Type': 'application/json' } })
    )

    expect(error.kind).toBe('unknown')
    expect(error.reasons).toEqual([])
    expect(error.message).not.toContain(sentinel)
  })
})

describe('Google Drive metadata hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    vi.clearAllMocks()
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

  it('retries a body-classified 403 rate limit and succeeds', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(jsonResponse(fileMetadata()))
      .mockResolvedValueOnce(
        driveErrorResponse('userRateLimitExceeded', 'User Rate Limit Exceeded')
      )
      .mockResolvedValueOnce(new Response('recovered content', { status: 200 }))

    const documentPromise = googleDriveConnector.getDocument('token', {}, FILE_ID)
    await vi.runAllTimersAsync()

    await expect(documentPromise).resolves.toMatchObject({
      content: 'recovered content',
    })
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('retains header-classified 403 rate-limit retries when the body has no known reason', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(jsonResponse(fileMetadata()))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Temporarily throttled' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
        })
      )
      .mockResolvedValueOnce(new Response('recovered content', { status: 200 }))

    const documentPromise = googleDriveConnector.getDocument('token', {}, FILE_ID)
    await vi.runAllTimersAsync()

    await expect(documentPromise).resolves.toMatchObject({ content: 'recovered content' })
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it.each([
    [429, 'insufficientFilePermissions'],
    [503, 'exportSizeLimitExceeded'],
  ])(
    'retries HTTP %i even when the provider reason is classified as terminal',
    async (status, reason) => {
      vi.useFakeTimers()
      mockFetch
        .mockResolvedValueOnce(jsonResponse(fileMetadata()))
        .mockResolvedValueOnce(driveErrorResponse(reason, 'Conflicting provider reason', status))
        .mockResolvedValueOnce(new Response('recovered content', { status: 200 }))

      const documentPromise = googleDriveConnector.getDocument('token', {}, FILE_ID)
      await vi.runAllTimersAsync()

      await expect(documentPromise).resolves.toMatchObject({ content: 'recovered content' })
      expect(mockFetch).toHaveBeenCalledTimes(3)
    }
  )

  it('propagates unknown 403 responses instead of misclassifying them as permanent', async () => {
    await expect(
      hydrateWithExportResponse(driveErrorResponse('newGoogleReason', 'Undocumented failure'))
    ).rejects.toMatchObject({
      name: 'GoogleDriveApiError',
      status: 403,
      kind: 'unknown',
      reasons: ['newGoogleReason'],
    })
  })

  it('hands the complete XLSX workbook to the shared parser instead of exporting only sheet one', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty first sheet')
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['month', 'revenue'],
        ['Jan', 100],
      ]),
      'Revenue'
    )
    const workbookBytes = Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }))

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(
          fileMetadata({ name: 'Revenue model', mimeType: GOOGLE_SPREADSHEET_MIME_TYPE })
        )
      )
      .mockResolvedValueOnce(new Response(workbookBytes))

    const document = await googleDriveConnector.getDocument('token', {}, FILE_ID)
    const exportUrl = String(mockFetch.mock.calls[1][0])

    expect(exportUrl).toContain(
      'mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    expect(document?.content).toBe('')
    expect(document?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    expect(document?.sourceFile).toMatchObject({
      fileName: 'Revenue model.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    expect(document?.sourceFile?.bytes).toEqual(workbookBytes)
    expect(document?.skippedReason).toBeUndefined()
    expect(document?.contentHash).toBe('gdrive:v2:drive-file-1:2026-08-20T12:00:00Z')
  })

  it('marks an empty export as an authoritative skip', async () => {
    const document = await hydrateWithExportResponse(new Response('   '))

    expect(document).toMatchObject({
      content: '',
      contentDeferred: false,
      skippedExistingDisposition: 'replace',
      skippedReason: 'Document contains no extractable text',
    })
  })

  it('authoritatively skips a listed file that changed to an unsupported type', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(fileMetadata({ name: 'archive.zip', mimeType: 'application/zip' }))
    )

    await expect(googleDriveConnector.getDocument('token', {}, FILE_ID)).resolves.toMatchObject({
      content: '',
      skippedReason: 'File is no longer an indexable document',
      skippedExistingDisposition: 'replace',
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('Google Drive connector limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('asks only for files modified after an incremental watermark', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ files: [] }))

    await googleDriveConnector.listDocuments(
      'token',
      {},
      undefined,
      {},
      new Date('2026-08-20T12:00:00Z')
    )

    const url = new URL(String(mockFetch.mock.calls[0][0]))
    expect(url.searchParams.get('q')).toContain("modifiedTime > '2026-08-20T12:00:00.000Z'")
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

  it('rejects a malformed successful file-list envelope', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}))

    await expect(googleDriveConnector.listDocuments('token', {}, undefined, {})).rejects.toThrow(
      'Google Drive API returned malformed file-list metadata'
    )
  })

  it('accepts a discriminator-only empty file-list envelope', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ kind: 'drive#fileList' }))

    await expect(
      googleDriveConnector.listDocuments('token', {}, undefined, {})
    ).resolves.toMatchObject({ documents: [], hasMore: false })
  })

  it.each([
    { files: [{ name: 'Missing ID', mimeType: 'text/plain', modifiedTime: '2026-01-01' }] },
    { files: [], nextPageToken: 123 },
    { files: [], incompleteSearch: 'true' },
  ])('rejects malformed file-list metadata', async (body) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(body))

    await expect(googleDriveConnector.listDocuments('token', {}, undefined, {})).rejects.toThrow(
      'Google Drive API returned malformed file-list metadata'
    )
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

  it.each([undefined, null, '', '   ', 0, '0'])(
    'keeps omitted or explicit unlimited maxFiles %s valid at runtime',
    async (maxFiles) => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ files: [] }))

      await expect(
        googleDriveConnector.listDocuments('token', { maxFiles })
      ).resolves.toMatchObject({ documents: [], hasMore: false })
      expect(String(mockFetch.mock.calls[0][0])).toContain('pageSize=100')
    }
  )

  it('uses a valid persisted maxFiles cap at runtime', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ files: [] }))

    await googleDriveConnector.listDocuments('token', { maxFiles: '25' })

    expect(String(mockFetch.mock.calls[0][0])).toContain('pageSize=25')
  })

  it.each(['1.5', 'Infinity', 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid maxFiles %s during validation without calling Drive',
    async (maxFiles) => {
      await expect(googleDriveConnector.validateConfig('token', { maxFiles })).resolves.toEqual({
        valid: false,
        error: 'Max files must be a positive safe integer, or 0 for unlimited',
      })
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )
})

describe('Google Drive change feed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it("opens the feed at the account's current start token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ startPageToken: '4821' }))

    await expect(googleDriveConnector.getChangeCursor?.('token', {})).resolves.toBe('4821')
    expect(String(mockFetch.mock.calls[0][0])).toContain('/changes/startPageToken')
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
    expect(result.nextCursor).toBe('5000')
    expect(result.hasMore).toBe(false)
    const url = new URL(String(mockFetch.mock.calls[0][0]))
    expect(url.searchParams.get('pageToken')).toBe('4821')
    expect(url.searchParams.get('includeRemoved')).toBe('true')
  })

  it('continues on the next page token while the feed has more', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ changes: [], nextPageToken: '4900', newStartPageToken: '5000' })
    )

    const result = await googleDriveConnector.listChanges!('token', {}, '4821')

    expect(result).toEqual({ changes: [], nextCursor: '4900', hasMore: true })
  })

  it('rejects a feed page without a cursor to continue from', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ changes: [] }))

    await expect(googleDriveConnector.listChanges!('token', {}, '4821')).rejects.toThrow(
      'malformed change-list metadata'
    )
  })

  it.each([
    [400, [], true],
    [400, ['invalid'], true],
    [404, ['notFound'], true],
    [410, [], true],
    [403, ['insufficientFilePermissions'], false],
    [500, ['backendError'], false],
  ])('classifies HTTP %s %j as cursor-invalid=%s', (status, reasons, expected) => {
    expect(
      googleDriveConnector.isChangeCursorInvalidError!(new GoogleDriveApiError(status, reasons))
    ).toBe(expected)
    expect(googleDriveConnector.isChangeCursorInvalidError!(new Error('other'))).toBe(false)
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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  /** The engine seeds this on every mirroring run; without it a crawl reads no permissions. */
  const MIRRORING = { mirrorsSourceAcls: true }

  async function listWith(file: Record<string, unknown>, sourceConfig: Record<string, unknown>) {
    mockFetch.mockResolvedValueOnce(fileListResponse([file]))
    const result = await googleDriveConnector.listDocuments('token', sourceConfig, undefined, {
      ...MIRRORING,
    })
    return result.documents[0]
  }

  it('asks Drive for the permissions it needs to mirror', async () => {
    mockFetch.mockResolvedValueOnce(fileListResponse([]))
    await googleDriveConnector.listDocuments('token', ADMIN, undefined, { ...MIRRORING })

    const url = String(mockFetch.mock.calls[0][0])
    expect(decodeURIComponent(url)).toContain('permissions(id,type,emailAddress,domain,role,')
  })

  /** A crawl that is not mirroring must not pull a permission array per file and discard it. */
  it('leaves permissions out of the field mask when the run does not mirror', async () => {
    mockFetch.mockResolvedValueOnce(fileListResponse([]))
    await googleDriveConnector.listDocuments('token', ADMIN, undefined, {})

    expect(decodeURIComponent(String(mockFetch.mock.calls[0][0]))).not.toContain('permissions(')
  })

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

  /**
   * The tenant is baked into every stored group token, so it has to come from
   * the administrator's own domain rather than anything a file happens to carry.
   */
  it('names the group directory after the administrator the crawl runs as', async () => {
    const doc = await listWith(
      driveFile({ permissions: [{ id: 'p1', type: 'group', emailAddress: 'eng@other.com' }] }),
      { adminEmail: 'Admin@Corp.com' }
    )

    expect(doc.acl).toEqual(['g:google-drive:corp.com:eng@other.com'])
  })

  it('mirrors no ACL at all when no administrator is configured', async () => {
    const doc = await listWith(
      driveFile({ permissions: [{ id: 'p1', type: 'user', emailAddress: 'alice@corp.com' }] }),
      {}
    )

    expect(doc.acl).toBeUndefined()
  })

  it('keeps an openly shared file out of search until the admin opts in', async () => {
    const shared = driveFile({ permissions: [{ id: 'p1', type: 'domain', domain: 'corp.com' }] })

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

  /**
   * Drive does not populate `permissions` for a file on a shared drive; the
   * only source is `permissions.list`. A listing that left the ACL unset must
   * therefore be answered by the fallback, not treated as readable by nobody.
   */
  it('resolves a file the listing could not describe through permissions.list', async () => {
    const doc = await listWith(driveFile({}), ADMIN)
    expect(doc.acl).toBeUndefined()

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        permissions: [
          { id: 'p1', type: 'user', emailAddress: 'alice@corp.com' },
          { id: 'p2', type: 'group', emailAddress: 'eng@corp.com' },
        ],
      })
    )

    await expect(
      googleDriveConnector.getDocumentAcls?.('token', ADMIN, [FILE_DOC], { ...MIRRORING })
    ).resolves.toEqual({
      [FILE_ID]: ['g:google-drive:corp.com:eng@corp.com', 'u:alice@corp.com'],
    })
    const url = String(mockFetch.mock.calls[1][0])
    expect(url).toContain(`/files/${FILE_ID}/permissions`)
    expect(url).toContain('supportsAllDrives=true')
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

  it('answers nothing for a crawl that mirrors no permissions', async () => {
    await expect(
      googleDriveConnector.getDocumentAcls?.('token', {}, [FILE_DOC], { ...MIRRORING })
    ).resolves.toEqual({})
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
