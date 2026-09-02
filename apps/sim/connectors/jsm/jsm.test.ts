/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ JiraServiceManagementIcon: () => null }))
vi.mock('@/tools/jira/utils', () => ({
  getJiraCloudId: vi.fn(),
  extractAdfText: () => '',
}))

import { AtlassianSiteNotMatchedError } from '@/lib/atlassian/discovery'
import { jsmConnector } from '@/connectors/jsm/jsm'

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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('jsm listing scope classification', () => {
  it('treats a 403 on the request listing as a service desk the caller may not view', async () => {
    mockStatus(403)
    expect(jsmConnector.isListingScopeUnavailableError?.(await listingError())).toBe(true)
  })

  it('treats a 404 on the request listing as a service desk that does not exist for the caller', async () => {
    mockStatus(404)
    expect(jsmConnector.isListingScopeUnavailableError?.(await listingError())).toBe(true)
  })

  it('leaves other failures for the sync engines to retry', async () => {
    mockStatus(500)
    const error = await listingError()
    expect(error).toBeInstanceOf(Error)
    expect(jsmConnector.isListingScopeUnavailableError?.(error)).toBe(false)
  })

  it('treats a 403 while resolving a project key to a service desk id the same way', async () => {
    mockStatus(403)
    const error = await jsmConnector
      .listDocuments('token', { ...SOURCE_CONFIG, serviceDeskId: 'ITH' }, undefined, {
        cloudId: 'cloud-1',
      })
      .catch((caught: unknown) => caught)
    expect(jsmConnector.isListingScopeUnavailableError?.(error)).toBe(true)
  })

  it('treats a token that reaches only other Atlassian sites as not on the site', () => {
    expect(
      jsmConnector.isListingScopeUnavailableError?.(new AtlassianSiteNotMatchedError('elsewhere'))
    ).toBe(true)
  })
})
