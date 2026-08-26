/**
 * @vitest-environment node
 *
 * `add-attachment` is an internal Next.js route, so the reflective
 * `request.url` probe in `tools/jira/path_safety.test.ts` cannot see it: the
 * provider URL is assembled *here*, from body fields, not by the tool config.
 *
 * Both `cloudId` and `issueKey` land in a path segment on a POST that carries
 * the caller's OAuth bearer token and a multipart body. `encodeURIComponent`
 * would not help — `.` and `..` are unreserved and the WHATWG parser removes
 * them after decoding — so the sibling routes reject instead, and so must this
 * one. Every assertion resolves the outgoing URL through `new URL(...)`, the
 * same normalization `fetch` applies.
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockProcessFilesToUserFiles, mockDownload, mockAssertToolFileAccess, mockGetJiraCloudId } =
  vi.hoisted(() => ({
    mockProcessFilesToUserFiles: vi.fn(),
    mockDownload: vi.fn(),
    mockAssertToolFileAccess: vi.fn(),
    mockGetJiraCloudId: vi.fn(),
  }))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mockProcessFilesToUserFiles,
  isInternalFileUrl: () => true,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownload,
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mockAssertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyResponse: () => null,
}))

vi.mock('@/tools/jira/utils', () => ({
  getJiraCloudId: mockGetJiraCloudId,
  parseAtlassianErrorMessage: (status: number) => `Jira error ${status}`,
}))

import { POST } from '@/app/api/tools/jira/add-attachment/route'

const CLOUD_ID = '1324a887-45db-1bf4-1e99-ef0ff456d421'
const ORIGIN = 'https://api.atlassian.com'

const FILE = { key: 'workspace/u1/report.pdf', name: 'report.pdf', size: 12, type: 'application/pdf' }

function body(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'inert-token',
    domain: 'example.atlassian.net',
    issueKey: 'PROJ-123',
    cloudId: CLOUD_ID,
    files: [FILE],
    ...overrides,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  mockProcessFilesToUserFiles.mockReturnValue([FILE])
  mockAssertToolFileAccess.mockResolvedValue(null)
  mockDownload.mockResolvedValue({
    buffer: Buffer.from('pdf'),
    contentType: 'application/pdf',
  })
  mockGetJiraCloudId.mockResolvedValue(CLOUD_ID)
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => [{ id: '1', filename: 'report.pdf', mimeType: 'application/pdf', size: 3 }],
    text: async () => '',
  })
  vi.stubGlobal('fetch', fetchMock)
})

function outgoingUrl(): URL {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  return new URL(fetchMock.mock.calls[0][0] as string)
}

describe('POST /api/tools/jira/add-attachment path safety', () => {
  /** The exact shape a legitimate call produces, asserted segment by segment. */
  it('builds the documented attachments path for legitimate values', async () => {
    const response = await POST(createMockRequest('POST', body()))
    expect(response.status).toBe(200)

    const url = outgoingUrl()
    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname.split('/')).toEqual([
      '',
      'ex',
      'jira',
      CLOUD_ID,
      'rest',
      'api',
      '3',
      'issue',
      'PROJ-123',
      'attachments',
    ])
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it.each(['..', '.', 'a/../b', '%2e%2e', '..%2f..'])(
    'rejects issueKey=%j with a 400 and never calls Jira',
    async (issueKey) => {
      const response = await POST(createMockRequest('POST', body({ issueKey })))

      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/issueKey/)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it.each(['..', '.', 'a/../b', '%2e%2e', '..%2f..'])(
    'rejects body-supplied cloudId=%j with a 400 and never calls Jira',
    async (cloudId) => {
      const response = await POST(createMockRequest('POST', body({ cloudId })))

      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/cloudId/)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  /** cloudId sits earlier in the path, so it is validated first, like the siblings. */
  it('reports cloudId before issueKey when both are hostile', async () => {
    const response = await POST(
      createMockRequest('POST', body({ cloudId: '..', issueKey: '..' }))
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/cloudId/)
  })

  /** A discovered cloudId is not caller-controlled, but it still shares the guard. */
  it('rejects a discovered cloudId that is a dot segment', async () => {
    mockGetJiraCloudId.mockResolvedValue('..')

    const response = await POST(createMockRequest('POST', body({ cloudId: undefined })))

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still resolves the cloudId from the domain when the body omits it', async () => {
    const response = await POST(createMockRequest('POST', body({ cloudId: undefined })))

    expect(response.status).toBe(200)
    expect(mockGetJiraCloudId).toHaveBeenCalledWith('example.atlassian.net', 'inert-token')
    expect(outgoingUrl().pathname.split('/')[3]).toBe(CLOUD_ID)
  })
})
