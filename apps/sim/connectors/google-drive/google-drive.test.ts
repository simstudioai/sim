/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ GoogleDriveIcon: () => null }))

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
  mockFetchWithRetry
    .mockResolvedValueOnce(jsonResponse(fileMetadata()))
    .mockResolvedValueOnce(exportResponse)
  return googleDriveConnector.getDocument('token', {}, FILE_ID)
}

describe('Google Drive API error parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(error.providerMessage).toBe('Provider message')
  })

  it('classifies retryable statuses even without a structured reason', async () => {
    const error = await readGoogleDriveApiError(
      new Response('upstream unavailable', { status: 503 })
    )

    expect(error.kind).toBe('transient')
    expect(error.providerMessage).toBeUndefined()
    expect(error.message).not.toContain('upstream unavailable')
  })

  it('bounds and normalizes the provider message used for diagnostics', async () => {
    const message = `Authorization: Bearer private-token\ncontext ${'x'.repeat(700)}`
    const error = await readGoogleDriveApiError(
      driveErrorResponse('insufficientFilePermissions', message)
    )

    expect(error.providerMessage).not.toContain('\n')
    expect(error.providerMessage!.length).toBeLessThanOrEqual(500)
    expect(error.providerMessage).toContain('Authorization: Bearer [REDACTED]')
    expect(error.providerMessage).not.toContain('private-token')
    expect(error.message).not.toContain('private-token')
  })
})

describe('Google Drive export failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records the documented export size limit as a terminal skipped document', async () => {
    const document = await hydrateWithExportResponse(
      driveErrorResponse('exportSizeLimitExceeded', 'Export exceeds the 10 MB limit')
    )

    expect(document?.contentDeferred).toBe(false)
    expect(document?.skippedReason).toContain('10MB size limit')
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
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
    }
  )

  it('propagates a body-classified rate limit so the task can retry it', async () => {
    await expect(
      hydrateWithExportResponse(
        driveErrorResponse('userRateLimitExceeded', 'User Rate Limit Exceeded')
      )
    ).rejects.toMatchObject({
      name: 'GoogleDriveApiError',
      status: 403,
      kind: 'transient',
      reasons: ['userRateLimitExceeded'],
    })
  })

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

  it('preserves the established first-sheet CSV export without parser truncation regressions', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(
        jsonResponse(
          fileMetadata({ name: 'Revenue model', mimeType: GOOGLE_SPREADSHEET_MIME_TYPE })
        )
      )
      .mockResolvedValueOnce(new Response('month,revenue\nJan,100'))

    const document = await googleDriveConnector.getDocument('token', {}, FILE_ID)
    const exportUrl = String(mockFetchWithRetry.mock.calls[1][0])

    expect(exportUrl).toContain('mimeType=text%2Fcsv')
    expect(document?.content).toBe('month,revenue\nJan,100')
    expect(document?.mimeType).toBe('text/plain')
    expect(document?.sourceFile).toBeUndefined()
    expect(document?.contentHash).toBe('gdrive:drive-file-1:2026-08-20T12:00:00Z')
  })
})

describe('Google Drive connector limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not let an oversized skipped file consume the maxFiles budget', async () => {
    mockFetchWithRetry
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

  it.each(['1.5', 'Infinity', 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid persisted maxFiles %s before listing from Drive',
    async (maxFiles) => {
      await expect(googleDriveConnector.listDocuments('token', { maxFiles })).rejects.toThrow(
        'Max files must be a positive safe integer, or 0 for unlimited'
      )
      expect(mockFetchWithRetry).not.toHaveBeenCalled()
    }
  )

  it.each([undefined, null, '', '   ', 0, '0'])(
    'keeps omitted or explicit unlimited maxFiles %s valid at runtime',
    async (maxFiles) => {
      mockFetchWithRetry.mockResolvedValueOnce(jsonResponse({ files: [] }))

      await expect(
        googleDriveConnector.listDocuments('token', { maxFiles })
      ).resolves.toMatchObject({ documents: [], hasMore: false })
      expect(String(mockFetchWithRetry.mock.calls[0][0])).toContain('pageSize=100')
    }
  )

  it('uses a valid persisted maxFiles cap at runtime', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(jsonResponse({ files: [] }))

    await googleDriveConnector.listDocuments('token', { maxFiles: '25' })

    expect(String(mockFetchWithRetry.mock.calls[0][0])).toContain('pageSize=25')
  })

  it.each(['1.5', 'Infinity', 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid maxFiles %s during validation without calling Drive',
    async (maxFiles) => {
      await expect(googleDriveConnector.validateConfig('token', { maxFiles })).resolves.toEqual({
        valid: false,
        error: 'Max files must be a positive safe integer, or 0 for unlimited',
      })
      expect(mockFetchWithRetry).not.toHaveBeenCalled()
    }
  )
})
