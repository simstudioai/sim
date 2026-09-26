import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockProcessSingleFileToUserFile } = fileUtilsMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns

import { ConfluenceOperationError } from '@/lib/internal/confluence/errors'
import {
  executeConfluenceListPagesInSpace,
  executeConfluenceSearchInSpace,
  executeConfluenceUploadAttachment,
} from '@/lib/internal/confluence/operations'

const CONNECTION = {
  domain: 'example.atlassian.net',
  accessToken: 'access-token',
  cloudId: '12345678-1234-1234-1234-123456789012',
}

describe('Confluence operations', () => {
  beforeEach(() => {
    mockProcessSingleFileToUserFile.mockReturnValue({
      id: 'file-1',
      key: 'uploads/file.txt',
      name: 'file.txt',
      size: 4,
      type: 'text/plain',
      url: '',
    })
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('test'),
      contentType: 'text/plain',
    })
  })

  it.each([
    { selectedValue: 'ENG', expectedCalls: 2 },
    { selectedValue: '12345', expectedCalls: 1 },
  ])(
    'uses numeric space IDs for V2 requests when the selected value is $selectedValue',
    async ({ selectedValue, expectedCalls }) => {
      const fetchMock = vi.fn(async (request: string | URL | Request) => {
        const url = String(request)
        if (url.includes('/spaces?')) {
          return Response.json({
            results: [{ id: '12345', key: 'ENG', name: 'Engineering', status: 'current' }],
          })
        }
        return Response.json({ results: [] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        executeConfluenceListPagesInSpace(
          { ...CONNECTION, spaceId: selectedValue, limit: 25 },
          { headers: new Headers(), requestId: 'request-1' }
        )
      ).resolves.toEqual({ pages: [], nextCursor: null })

      expect(fetchMock).toHaveBeenCalledTimes(expectedCalls)
      const urls = fetchMock.mock.calls.map(([request]) => String(request))
      expect(urls.at(-1)).toContain('/spaces/12345/pages?limit=25')
      if (selectedValue === 'ENG') {
        expect(urls[0]).toContain('/spaces?keys=ENG&limit=1&status=current')
      }
    }
  )

  it('resolves a legacy numeric space value before constructing key-based CQL', async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request)
      if (url.includes('/api/v2/spaces/12345')) {
        return Response.json({ id: '12345', key: 'ENG', name: 'Engineering' })
      }
      return Response.json({ results: [], totalSize: 0 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      executeConfluenceSearchInSpace(
        { ...CONNECTION, spaceKey: '12345', query: 'release notes', limit: 25 },
        { headers: new Headers(), requestId: 'request-1' }
      )
    ).resolves.toEqual({ results: [], spaceKey: 'ENG', totalSize: 0 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const searchUrl = String(fetchMock.mock.calls[1][0])
    expect(new URL(searchUrl).searchParams.get('cql')).toBe(
      'space = "ENG" AND text ~ "release notes"'
    )
  })

  it('fails closed when stored-file authorization denies access', async () => {
    mockAssertToolFileAccess.mockResolvedValueOnce(Response.json({ error: 'Forbidden' }))

    let caught: unknown
    try {
      await executeConfluenceUploadAttachment(
        { ...CONNECTION, pageId: '123', file: { key: 'uploads/file.txt' } },
        {
          headers: new Headers(),
          requestId: 'request-1',
          userId: 'user-1',
        }
      )
    } catch (error) {
      caught = error
    }

    expect(mockAssertToolFileAccess).toHaveBeenCalledWith(
      'uploads/file.txt',
      'user-1',
      'confluence-upload',
      expect.anything()
    )
    expect(caught).toEqual(
      new ConfluenceOperationError('File not found', 404, {
        success: false,
        error: 'File not found',
      })
    )
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })
})
