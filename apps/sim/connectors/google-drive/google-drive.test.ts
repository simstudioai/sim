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
import { CONNECTOR_MAX_FILE_BYTES } from '@/connectors/utils'

const FILE_ID = 'drive-file-1'
const GOOGLE_DOCUMENT_MIME_TYPE = 'application/vnd.google-apps.document'
const GOOGLE_SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet'

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

describe('Google Drive API error parsing', () => {
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
      jsonResponse(fileMetadata({ name: 'diagram.png', mimeType: 'image/png' }))
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
