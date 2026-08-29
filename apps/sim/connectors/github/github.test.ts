/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubConnector } from '@/connectors/github/github'

describe('githubConnector.getDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the object media type and hydrates large file content through the blob API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: 'blob-sha',
            size: 2 * 1024 * 1024,
            content: '',
            encoding: 'none',
          }),
          { status: 200, headers: { 'last-modified': 'Fri, 28 Aug 2026 12:00:00 GMT' } }
        )
      )
      .mockResolvedValueOnce(
        new Response('large text file', { status: 200, headers: { 'content-length': '15' } })
      )
    vi.stubGlobal('fetch', fetchMock)

    const document = await githubConnector.getDocument(
      'token',
      { repository: 'owner/repo', branch: 'main' },
      'docs/large.md'
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Accept: 'application/vnd.github.object+json' }),
    })
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: expect.objectContaining({ Accept: 'application/vnd.github.raw+json' }),
    })
    expect(document).toMatchObject({
      externalId: 'docs/large.md',
      content: 'large text file',
      contentDeferred: false,
      contentHash: 'git-sha:blob-sha',
    })
  })

  it('returns null only when a listed path is no longer present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))

    await expect(
      githubConnector.getDocument('token', { repository: 'owner/repo' }, 'deleted.md')
    ).resolves.toBeNull()
  })

  it('records a blob that exceeds the byte cap as a visible skipped document', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: 'blob-sha',
            size: 2 * 1024 * 1024,
            content: '',
            encoding: 'none',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response('oversized', {
          status: 200,
          headers: { 'content-length': String(100 * 1024 * 1024 + 1) },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      githubConnector.getDocument('token', { repository: 'owner/repo' }, 'oversized.md')
    ).resolves.toMatchObject({
      externalId: 'oversized.md',
      content: '',
      skippedReason: 'File exceeds the 100MB size limit and was not indexed',
    })
  })

  it('surfaces a non-rate-limit 403 as a document failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))

    await expect(
      githubConnector.getDocument('token', { repository: 'owner/repo' }, 'private.md')
    ).rejects.toThrow('Failed to fetch file private.md: 403')
  })
})
