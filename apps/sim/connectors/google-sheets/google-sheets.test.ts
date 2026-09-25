import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({
  GoogleSheetsIcon: () => null,
}))

import { googleSheetsConnector } from '@/connectors/google-sheets/google-sheets'

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

    it('fails open and lists every tab when the Drive read fails', async () => {
      stubFetch({ drive: { status: 500, body: { error: 'backend error' } } })

      const result = await googleSheetsConnector.listDocuments(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.documents.map((d) => d.externalId)).toEqual([
        `${SPREADSHEET_ID}__sheet__0`,
        `${SPREADSHEET_ID}__sheet__7`,
      ])
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
  })

  describe('content extraction', () => {
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
  })

  describe('validateConfig', () => {
    it('rejects a spreadsheet that is already in the Drive trash', async () => {
      stubFetch({ drive: { status: 200, body: { trashed: true } } })

      const result = await googleSheetsConnector.validateConfig(ACCESS_TOKEN, SOURCE_CONFIG)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('trash')
    })
  })
})
