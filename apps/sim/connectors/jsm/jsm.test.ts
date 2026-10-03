import { knowledgeDocumentsUtilsMock } from '@sim/testing/mocks/knowledge-documents-utils.mock'
import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/utils', () => knowledgeDocumentsUtilsMock)
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)
vi.mock('@/tools/jira/utils', () => ({
  getJiraCloudId: vi.fn(),
  extractAdfText: () => '',
}))

import { jsmConnector } from '@/connectors/jsm/jsm'

const mockFetchWithRetry = knowledgeSecureFetchMockFns.mockFetchWithRetry

const SOURCE_CONFIG = { domain: 'example.atlassian.net', serviceDeskId: '10' }

function mockStatus(status: number) {
  mockFetchWithRetry.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => '',
  } as unknown as Response)
}

async function listingError(): Promise<unknown> {
  return jsmConnector
    .listDocuments('token', SOURCE_CONFIG, undefined, { cloudId: 'cloud-1' })
    .catch((caught: unknown) => caught)
}

describe('jsm listing scope classification', () => {
  it('treats a 403 on the request listing as a service desk the caller may not view', async () => {
    mockStatus(403)
    expect(jsmConnector.isListingScopeUnavailableError?.(await listingError())).toBe(true)
  })

  it('leaves other failures for the sync engines to retry', async () => {
    mockStatus(500)
    const error = await listingError()
    expect(error).toBeInstanceOf(Error)
    expect(jsmConnector.isListingScopeUnavailableError?.(error)).toBe(false)
  })
})
