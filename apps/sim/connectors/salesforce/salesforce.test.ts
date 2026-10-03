import { knowledgeDocumentsUtilsMock } from '@sim/testing/mocks/knowledge-documents-utils.mock'
import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/utils', () => knowledgeDocumentsUtilsMock)
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)

import { salesforceConnector } from '@/connectors/salesforce/salesforce'

const mockFetchWithRetry = knowledgeSecureFetchMockFns.mockFetchWithRetry

const INSTANCE_URL = 'https://org.example.com/services/data/v62.0/'

/** Answers every query with `status` and `body`, recording the requested URLs. */
function mockQuery(status: number, body: unknown) {
  const urls: string[] = []
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    urls.push(url)
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  })
  return urls
}

function syncContext(): Record<string, unknown> {
  return { instanceUrl: INSTANCE_URL }
}

async function listingError(sourceConfig: Record<string, unknown>): Promise<unknown> {
  return salesforceConnector
    .listDocuments('token', sourceConfig, undefined, syncContext())
    .catch((caught: unknown) => caught)
}

function soqlOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get('q') ?? '')
}

describe('salesforce listing scope classification', () => {
  it('treats an object the caller may not read (400 INVALID_TYPE) as the scope being unavailable', async () => {
    mockQuery(400, [
      { message: "sObject type 'Case' is not supported.", errorCode: 'INVALID_TYPE' },
    ])
    const error = await listingError({ objectType: 'Case' })
    expect(salesforceConnector.isListingScopeUnavailableError?.(error)).toBe(true)
  })

  it('leaves a malformed query and server faults for the sync engines to retry', async () => {
    mockQuery(400, [{ message: 'unexpected token', errorCode: 'MALFORMED_QUERY' }])
    const malformed = await listingError({ objectType: 'Account' })
    expect(malformed).toBeInstanceOf(Error)
    expect(salesforceConnector.isListingScopeUnavailableError?.(malformed)).toBe(false)

    mockQuery(500, 'Internal Server Error')
    const fault = await listingError({ objectType: 'Account' })
    expect(fault).toBeInstanceOf(Error)
    expect(salesforceConnector.isListingScopeUnavailableError?.(fault)).toBe(false)
  })
})

describe('salesforce incremental listing', () => {
  it('filters on LastModifiedDate with an unquoted UTC literal after a watermark', async () => {
    const urls = mockQuery(200, { records: [] })
    await salesforceConnector.listDocuments(
      'token',
      { objectType: 'Case' },
      undefined,
      syncContext(),
      new Date('2026-09-01T12:34:56.789Z')
    )
    expect(soqlOf(urls[0])).toContain(
      ' FROM Case WHERE LastModifiedDate >= 2026-09-01T12:34:56Z ORDER BY'
    )
  })
})
