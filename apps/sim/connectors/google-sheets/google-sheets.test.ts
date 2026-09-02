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

/** Adds a chart tab and returns the tabs out of index order. */
const SPREADSHEET_METADATA_WITH_OBJECT_SHEET = {
  spreadsheetId: SPREADSHEET_ID,
  properties: { title: 'Quarterly Plan' },
  sheets: [
    { properties: { sheetId: 7, title: 'Costs', index: 1, sheetType: 'GRID' } },
    { properties: { sheetId: 9, title: 'Chart', index: 2, sheetType: 'OBJECT' } },
    { properties: { sheetId: 0, title: "Ann's Revenue", index: 0, sheetType: 'GRID' } },
  ],
}

/** Drive response bodies keyed by the scenario each test exercises. */
interface FetchStubResponses {
  drive: { status: number; body: unknown }
  values?: unknown
  spreadsheet?: unknown
  spreadsheetStatus?: number
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
      return new Response(JSON.stringify(responses.spreadsheet ?? SPREADSHEET_METADATA), {
        status: responses.spreadsheetStatus ?? 200,
      })
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
    it('returns an empty listing when the spreadsheet is trashed', async () => {
      stubFetch({
        drive: { status: 200, body: { trashed: true, modifiedTime: '2026-07-01T00:00:00.000Z' } },
      })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result).toEqual({ documents: [], hasMore: false })
    })

    it('lists every tab when the trashed field is absent', async () => {
      stubFetch({ drive: { status: 200, body: { modifiedTime: '2026-07-01T00:00:00.000Z' } } })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.documents.map((d) => d.externalId)).toEqual([
        `${SPREADSHEET_ID}__sheet__0`,
        `${SPREADSHEET_ID}__sheet__7`,
      ])
      expect(result.hasMore).toBe(false)
    })

    it('lists every tab when trashed is explicitly false', async () => {
      stubFetch({ drive: { status: 200, body: { trashed: false } } })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.documents).toHaveLength(2)
    })

    it('fails open and lists every tab when the Drive read fails', async () => {
      stubFetch({ drive: { status: 500, body: { error: 'backend error' } } })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.documents.map((d) => d.externalId)).toEqual([
        `${SPREADSHEET_ID}__sheet__0`,
        `${SPREADSHEET_ID}__sheet__7`,
      ])
    })

    it('fails open when the Drive body is not an object', async () => {
      stubFetch({ drive: { status: 200, body: 'trashed' } })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.documents).toHaveLength(2)
    })

    it.each([403, 404])(
      'reports a spreadsheet the token cannot reach (%i) as an unavailable listing scope',
      async (status) => {
        stubFetch({
          drive: { status: 200, body: {} },
          spreadsheet: { error: 'denied' },
          spreadsheetStatus: status,
        })

        const error = await googleSheetsConnector
          .listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)
          .catch((caught: unknown) => caught)

        expect(googleSheetsConnector.isListingScopeUnavailableError?.(error)).toBe(true)
      }
    )

    it('keeps any other metadata failure retryable', async () => {
      stubFetch({
        drive: { status: 200, body: {} },
        spreadsheet: { error: 'backend' },
        spreadsheetStatus: 500,
      })

      const error = await googleSheetsConnector
        .listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      expect(googleSheetsConnector.isListingScopeUnavailableError?.(error)).toBe(false)
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

  describe('listDocuments sheet selection', () => {
    it('drops object (chart) tabs and orders the rest by tab index', async () => {
      stubFetch({
        drive: { status: 200, body: { trashed: false } },
        spreadsheet: SPREADSHEET_METADATA_WITH_OBJECT_SHEET,
      })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.documents.map((d) => d.externalId)).toEqual([
        `${SPREADSHEET_ID}__sheet__0`,
        `${SPREADSHEET_ID}__sheet__7`,
      ])
    })

    it('selects the leftmost grid tab for the first-sheet filter', async () => {
      stubFetch({
        drive: { status: 200, body: { trashed: false } },
        spreadsheet: SPREADSHEET_METADATA_WITH_OBJECT_SHEET,
      })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, {
        ...SOURCE_CONFIG,
        sheetFilter: 'first',
      })

      expect(result.documents.map((d) => d.externalId)).toEqual([`${SPREADSHEET_ID}__sheet__0`])
    })

    it('tolerates a metadata response without a sheets array', async () => {
      stubFetch({
        drive: { status: 200, body: { trashed: false } },
        spreadsheet: { spreadsheetId: SPREADSHEET_ID, properties: { title: 'Empty' } },
      })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result).toEqual({ documents: [], hasMore: false })
    })
  })

  describe('content extraction', () => {
    it('keeps the stub contentHash identical between listing and hydration', async () => {
      stubFetch({
        drive: { status: 200, body: { modifiedTime: '2026-07-01T00:00:00.000Z' } },
        values: { values: [['Region'], ['West']] },
      })

      const listed = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)
      const hydrated = await googleSheetsConnector.getDocument(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        `${SPREADSHEET_ID}__sheet__0`
      )

      expect(hydrated?.contentHash).toBe(listed.documents[0].contentHash)
    })

    it('keeps columns whose header cell is blank, sizing by the widest row', async () => {
      stubFetch({
        drive: { status: 200, body: { trashed: false } },
        values: { values: [['Region'], ['West', '10', '20']] },
      })

      const doc = await googleSheetsConnector.getDocument(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        `${SPREADSHEET_ID}__sheet__0`
      )

      expect(doc?.content).toContain('Region: West')
      expect(doc?.content).toContain('Column 2: 10')
      expect(doc?.content).toContain('Column 3: 20')
      expect(doc?.metadata?.columnCount).toBe(3)
    })

    it('requests every column via a row-only A1 range with the tab name quote-escaped', async () => {
      const fetchMock = stubFetch({
        drive: { status: 200, body: { trashed: false } },
        spreadsheet: SPREADSHEET_METADATA_WITH_OBJECT_SHEET,
        values: { values: [['Region'], ['West']] },
      })

      await googleSheetsConnector.getDocument(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        `${SPREADSHEET_ID}__sheet__0`
      )

      const valuesUrl = fetchMock.mock.calls
        .map(([input]) => String(input))
        .find((url) => url.includes('/values/'))

      expect(valuesUrl).toContain(encodeURIComponent("'Ann''s Revenue'!1:10000"))
      expect(valuesUrl).not.toContain('ZZ')
    })

    it('reuses the cached spreadsheet context instead of re-reading it per tab', async () => {
      const fetchMock = stubFetch({
        drive: { status: 200, body: { trashed: false } },
        values: { values: [['Region'], ['West']] },
      })
      const syncContext: Record<string, unknown> = {}

      await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG, undefined, syncContext)
      await googleSheetsConnector.getDocument(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        `${SPREADSHEET_ID}__sheet__0`,
        syncContext
      )
      await googleSheetsConnector.getDocument(
        ACCESS_TOKEN,
        SOURCE_CONFIG,
        `${SPREADSHEET_ID}__sheet__7`,
        syncContext
      )

      const urls = fetchMock.mock.calls.map(([input]) => String(input))
      expect(
        urls.filter((url) => url.startsWith('https://www.googleapis.com/drive/'))
      ).toHaveLength(1)
      expect(urls.filter((url) => url.includes('/values/'))).toHaveLength(2)
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
