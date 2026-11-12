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

vi.mock('@/lib/uploads/utils/file', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file.server', () => fileUtilsServerMock)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockProcessSingleFileToUserFile } = fileUtilsMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns

import { ConfluenceOperationError } from '@/lib/internal/confluence/errors'
import {
  executeConfluenceListComments,
  executeConfluenceListPagesInSpace,
  executeConfluenceSearch,
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
    ).resolves.toEqual({ results: [], spaceKey: 'ENG', totalSize: 0, nextCursor: null })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const searchUrl = String(fetchMock.mock.calls[1][0])
    expect(new URL(searchUrl).searchParams.get('cql')).toBe(
      'space = "ENG" AND text ~ "release notes"'
    )
  })

  it('reads comment author and creation time from the version object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          results: [
            {
              id: '77',
              status: 'current',
              title: 'Re: Plan',
              pageId: '12345',
              version: { number: 1, authorId: 'acct-1', createdAt: '2026-11-01T10:00:00.000Z' },
              body: {
                atlas_doc_format: { value: '{"type":"doc"}', representation: 'atlas_doc_format' },
              },
            },
          ],
          _links: {},
        })
      )
    )

    const result = await executeConfluenceListComments(
      { ...CONNECTION, pageId: '12345', limit: '25', bodyFormat: 'atlas_doc_format' },
      { headers: new Headers(), requestId: 'request-1' }
    )

    expect(result.comments[0]).toMatchObject({
      authorId: 'acct-1',
      createdAt: '2026-11-01T10:00:00.000Z',
      body: { value: '{"type":"doc"}', representation: 'atlas_doc_format' },
    })
  })

  it('returns the space key of each search result', async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const expand = new URL(String(request)).searchParams.get('expand')
      return Response.json({
        results: [
          {
            content: {
              id: '98765',
              type: 'page',
              title: 'Release notes',
              ...(expand === 'content.space'
                ? { space: { id: 4242, key: 'ENG', name: 'Engineering' } }
                : {}),
            },
            resultGlobalContainer: { title: 'Engineering', displayUrl: '/spaces/ENG' },
            excerpt: 'release',
            url: '/spaces/ENG/pages/98765',
          },
        ],
        totalSize: 1,
        _links: {},
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeConfluenceSearch(
      { ...CONNECTION, query: 'release', limit: 25 },
      { headers: new Headers(), requestId: 'request-1' }
    )

    expect(result.results[0]).toMatchObject({
      spaceKey: 'ENG',
      space: { id: '4242', key: 'ENG', name: 'Engineering' },
    })
  })

  it('keeps a trailing CQL order by after the parenthesized filter', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ results: [], totalSize: 0, _links: {} })
    )
    vi.stubGlobal('fetch', fetchMock)

    await executeConfluenceSearch(
      {
        ...CONNECTION,
        query: 'release',
        limit: 25,
        cql: 'title ~ "sort order by x" ORDER BY lastmodified desc',
      },
      { headers: new Headers(), requestId: 'request-1' }
    )

    const sentCql = new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('cql')
    expect(sentCql).toBe(
      'text ~ "release" AND (title ~ "sort order by x") ORDER BY lastmodified desc'
    )
  })

  it.each([
    [
      'search',
      () =>
        executeConfluenceSearch(
          { ...CONNECTION, query: 'release', limit: 25, cursor: 'cursor-2' },
          { headers: new Headers(), requestId: 'request-1' }
        ),
    ],
    [
      'search in space',
      () =>
        executeConfluenceSearchInSpace(
          { ...CONNECTION, spaceKey: 'ENG', limit: 25, cursor: 'cursor-2' },
          { headers: new Headers(), requestId: 'request-1' }
        ),
    ],
  ])('sends next=true with the cursor on %s, as Confluence next links do', async (_, run) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ results: [], totalSize: 0, _links: {} })
    )
    vi.stubGlobal('fetch', fetchMock)

    await run()

    const params = new URL(String(fetchMock.mock.calls.at(-1)?.[0])).searchParams
    expect(params.get('cursor')).toBe('cursor-2')
    expect(params.get('next')).toBe('true')
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
