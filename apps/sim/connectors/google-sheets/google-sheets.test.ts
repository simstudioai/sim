/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({
  GoogleSheetsIcon: () => null,
}))

import {
  type DriveFileMetadata,
  googleSheetsConnector,
  isTrashedDriveFile,
  parseDriveFileMetadata,
} from '@/connectors/google-sheets/google-sheets'

describe('isTrashedDriveFile', () => {
  it.concurrent('excludes an explicitly trashed file', () => {
    expect(isTrashedDriveFile({ trashed: true })).toBe(true)
  })

  it.concurrent('keeps a file explicitly marked not trashed', () => {
    expect(isTrashedDriveFile({ trashed: false })).toBe(false)
  })

  it.concurrent('keeps a file when the trashed field is absent', () => {
    expect(isTrashedDriveFile({ modifiedTime: '2026-07-22T10:00:00.000Z' })).toBe(false)
  })

  it.concurrent('keeps a file when the Drive read failed and returned nothing', () => {
    expect(isTrashedDriveFile({})).toBe(false)
  })
})

describe('parseDriveFileMetadata', () => {
  it.concurrent('extracts modifiedTime and trashed', () => {
    expect(
      parseDriveFileMetadata({ modifiedTime: '2026-07-22T10:00:00.000Z', trashed: true })
    ).toEqual({ modifiedTime: '2026-07-22T10:00:00.000Z', trashed: true })
  })

  it.concurrent('omits fields with the wrong type instead of coercing them', () => {
    const parsed: DriveFileMetadata = parseDriveFileMetadata({ modifiedTime: 123, trashed: 'true' })
    expect(parsed).toEqual({})
    expect(isTrashedDriveFile(parsed)).toBe(false)
  })

  it.concurrent('ignores unrelated fields', () => {
    expect(parseDriveFileMetadata({ id: 'abc', name: 'Sheet' })).toEqual({})
  })

  it.concurrent('returns an empty object for non-object bodies', () => {
    expect(parseDriveFileMetadata(null)).toEqual({})
    expect(parseDriveFileMetadata(undefined)).toEqual({})
    expect(parseDriveFileMetadata('trashed')).toEqual({})
  })

  it.concurrent('preserves trashed: false', () => {
    expect(parseDriveFileMetadata({ trashed: false })).toEqual({ trashed: false })
  })
})

const SPREADSHEET_ID = 'sheet-abc'
const ACCESS_TOKEN = 'token-123'
const SOURCE_CONFIG = { spreadsheetId: SPREADSHEET_ID }

const SPREADSHEET_METADATA = {
  spreadsheetId: SPREADSHEET_ID,
  properties: { title: 'Quarterly Plan' },
  sheets: [
    { properties: { sheetId: 0, title: 'Revenue', index: 0 } },
    { properties: { sheetId: 7, title: 'Costs', index: 1 } },
  ],
}

/** Drive response bodies keyed by the scenario each test exercises. */
interface FetchStubResponses {
  drive: { status: number; body: unknown }
  values?: unknown
}

/**
 * Routes Sheets metadata, Sheets values, and Drive `files.get` calls to canned
 * responses. Non-2xx statuses are restricted to codes `fetchWithRetry` treats as
 * non-retryable so no test ever waits on a backoff sleep.
 */
function stubFetch(responses: FetchStubResponses) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.startsWith('https://www.googleapis.com/drive/v3/files/')) {
      return new Response(JSON.stringify(responses.drive.body), {
        status: responses.drive.status,
      })
    }
    if (url.includes('/values/')) {
      return new Response(JSON.stringify(responses.values ?? {}), { status: 200 })
    }
    if (url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) {
      return new Response(JSON.stringify(SPREADSHEET_METADATA), { status: 200 })
    }
    throw new Error(`Unexpected fetch to ${url}`)
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('googleSheetsConnector trashed handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('listDocuments', () => {
    it('returns an empty listing and confirms the empty result when the spreadsheet is trashed', async () => {
      stubFetch({
        drive: { status: 200, body: { trashed: true, modifiedTime: '2026-07-01T00:00:00.000Z' } },
      })
      const syncContext: Record<string, unknown> = {}

      const result = await googleSheetsConnector.listDocuments(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        undefined,
        syncContext
      )

      expect(result).toEqual({ documents: [], hasMore: false })
      expect(syncContext.sourceConfirmedEmpty).toBe(true)
    })

    it('lists every tab when the trashed field is absent', async () => {
      stubFetch({ drive: { status: 200, body: { modifiedTime: '2026-07-01T00:00:00.000Z' } } })
      const syncContext: Record<string, unknown> = {}

      const result = await googleSheetsConnector.listDocuments(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        undefined,
        syncContext
      )

      expect(result.documents.map((d) => d.externalId)).toEqual([
        `${SPREADSHEET_ID}__sheet__0`,
        `${SPREADSHEET_ID}__sheet__7`,
      ])
      expect(result.hasMore).toBe(false)
      expect(syncContext.sourceConfirmedEmpty).toBeUndefined()
    })

    it('lists every tab when trashed is explicitly false', async () => {
      stubFetch({ drive: { status: 200, body: { trashed: false } } })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.documents).toHaveLength(2)
    })

    it('fails open and lists every tab when the Drive read fails', async () => {
      stubFetch({ drive: { status: 500, body: { error: 'backend error' } } })
      const syncContext: Record<string, unknown> = {}

      const result = await googleSheetsConnector.listDocuments(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        undefined,
        syncContext
      )

      expect(result.documents.map((d) => d.externalId)).toEqual([
        `${SPREADSHEET_ID}__sheet__0`,
        `${SPREADSHEET_ID}__sheet__7`,
      ])
      expect(syncContext.sourceConfirmedEmpty).toBeUndefined()
    })

    it('fails open when the Drive body is not an object', async () => {
      stubFetch({ drive: { status: 200, body: 'trashed' } })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.documents).toHaveLength(2)
    })

    it('does not throw when trashed and no syncContext is passed', async () => {
      stubFetch({ drive: { status: 200, body: { trashed: true } } })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result).toEqual({ documents: [], hasMore: false })
    })
  })

  describe('getDocument', () => {
    const VALUES = {
      values: [
        ['Region', 'Total'],
        ['West', '10'],
      ],
    }

    it('returns null when the spreadsheet is trashed', async () => {
      stubFetch({ drive: { status: 200, body: { trashed: true } }, values: VALUES })

      const doc = await googleSheetsConnector.getDocument(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        `${SPREADSHEET_ID}__sheet__0`
      )

      expect(doc).toBeNull()
    })

    it('returns the document when the trashed field is absent', async () => {
      stubFetch({
        drive: { status: 200, body: { modifiedTime: '2026-07-01T00:00:00.000Z' } },
        values: VALUES,
      })

      const doc = await googleSheetsConnector.getDocument(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        `${SPREADSHEET_ID}__sheet__0`
      )

      expect(doc?.externalId).toBe(`${SPREADSHEET_ID}__sheet__0`)
      expect(doc?.contentDeferred).toBe(false)
    })

    it('fails open and returns the document when the Drive read fails', async () => {
      stubFetch({ drive: { status: 500, body: { error: 'backend error' } }, values: VALUES })

      const doc = await googleSheetsConnector.getDocument(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        `${SPREADSHEET_ID}__sheet__0`
      )

      expect(doc?.externalId).toBe(`${SPREADSHEET_ID}__sheet__0`)
    })
  })

  describe('validateConfig', () => {
    it('rejects a spreadsheet that is already in the Drive trash', async () => {
      stubFetch({ drive: { status: 200, body: { trashed: true } } })

      const result = await googleSheetsConnector.validateConfig(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('trash')
    })

    it('accepts a spreadsheet that is not trashed', async () => {
      stubFetch({ drive: { status: 200, body: { trashed: false } } })

      const result = await googleSheetsConnector.validateConfig(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result).toEqual({ valid: true })
    })

    it('fails open and accepts the config when the Drive read fails', async () => {
      stubFetch({ drive: { status: 500, body: { error: 'backend error' } } })

      const result = await googleSheetsConnector.validateConfig(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result).toEqual({ valid: true })
    })
  })
})
