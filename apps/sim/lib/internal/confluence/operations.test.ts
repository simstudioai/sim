/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const uploadMocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  processSingleFileToUserFile: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: uploadMocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: uploadMocks.processSingleFileToUserFile,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: uploadMocks.downloadServableFileFromStorage,
}))

import { ConfluenceOperationError } from '@/lib/internal/confluence/errors'
import {
  executeConfluenceListLabels,
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
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    uploadMocks.processSingleFileToUserFile.mockReturnValue({
      id: 'file-1',
      key: 'uploads/file.txt',
      name: 'file.txt',
      size: 4,
      type: 'text/plain',
      url: '',
    })
    uploadMocks.assertToolFileAccess.mockResolvedValue(null)
    uploadMocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('test'),
      contentType: 'text/plain',
    })
  })

  it('preserves list pagination and forwards cancellation to Atlassian', async () => {
    const response = Response.json({
      results: [{ id: 'label-1', name: 'release', prefix: 'global' }],
      _links: { next: '/wiki/api/v2/pages/123/labels?cursor=next-cursor' },
    })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(
      executeConfluenceListLabels(
        { ...CONNECTION, pageId: '123', limit: '20', cursor: 'current-cursor' },
        {
          headers: new Headers(),
          requestId: 'request-1',
          signal: controller.signal,
          userId: 'user-1',
        }
      )
    ).resolves.toEqual({
      labels: [{ id: 'label-1', name: 'release', prefix: 'global' }],
      nextCursor: 'next-cursor',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/pages/123/labels?limit=20&cursor=current-cursor'),
      expect.objectContaining({ signal: controller.signal })
    )
    expect(response.bodyUsed).toBe(true)
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

  it('fails closed before downloading a stored file without an acting user', async () => {
    let caught: unknown
    try {
      await executeConfluenceUploadAttachment(
        { ...CONNECTION, pageId: '123', file: { key: 'uploads/file.txt' } },
        { headers: new Headers(), requestId: 'request-1' }
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toEqual(new ConfluenceOperationError('Unauthorized', 401))
    expect(uploadMocks.processSingleFileToUserFile).not.toHaveBeenCalled()
    expect(uploadMocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('fails closed when stored-file authorization denies access', async () => {
    uploadMocks.assertToolFileAccess.mockResolvedValueOnce(Response.json({ error: 'Forbidden' }))

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

    expect(uploadMocks.assertToolFileAccess).toHaveBeenCalledWith(
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
    expect(uploadMocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('uploads only the authorized first file and consumes the provider response', async () => {
    const response = Response.json({
      results: [
        {
          id: 'attachment-1',
          title: 'file.txt',
          extensions: { fileSize: 4, mediaType: 'text/plain' },
          _links: { download: '/download/file.txt' },
        },
      ],
    })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(
      executeConfluenceUploadAttachment(
        {
          ...CONNECTION,
          pageId: '123',
          file: [{ key: 'uploads/file.txt' }, { key: 'uploads/ignored.txt' }],
          comment: 'Release notes',
        },
        {
          headers: new Headers(),
          requestId: 'request-1',
          signal: controller.signal,
          userId: 'user-1',
        }
      )
    ).resolves.toEqual({
      attachmentId: 'attachment-1',
      title: 'file.txt',
      fileSize: 4,
      mediaType: 'text/plain',
      downloadUrl: '/download/file.txt',
      pageId: '123',
    })

    expect(uploadMocks.processSingleFileToUserFile).toHaveBeenCalledWith(
      { key: 'uploads/file.txt' },
      'confluence-upload',
      expect.anything()
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/wiki/rest/api/content/123/child/attachment'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer access-token',
          'X-Atlassian-Token': 'nocheck',
        }),
        body: expect.any(FormData),
        signal: controller.signal,
      })
    )
    expect(response.bodyUsed).toBe(true)
  })
})
