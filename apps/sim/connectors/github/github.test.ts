import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubConnector } from '@/connectors/github/github'

vi.mock('@/lib/core/rate-limiter/provider-capacity', () => ({
  acquireProviderCapacity: vi.fn(async () => ({ settle: vi.fn(async () => 0) })),
}))

const source = { repository: 'owner/repo', branch: 'main' }

function treeFile(path: string, sha = path, size = 20) {
  return { path, sha, size, mode: '100644', type: 'blob' }
}

function treeResponse(tree: ReturnType<typeof treeFile>[], truncated = false, sha = 'tree-sha') {
  return new Response(JSON.stringify({ sha, tree, truncated }), { status: 200 })
}

describe('githubConnector member listing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('pages the same tree without refetching a moving branch', async () => {
    const files = Array.from({ length: 201 }, (_, index) => treeFile(`file-${index}.md`))
    const fetchMock = vi.fn().mockResolvedValue(treeResponse(files))
    vi.stubGlobal('fetch', fetchMock)
    const context: Record<string, unknown> = {}
    const first = await githubConnector.listDocuments('token', source, undefined, context)
    const second = await githubConnector.listDocuments('token', source, first.nextCursor, context)
    expect(first.documents).toHaveLength(200)
    expect(first.hasMore).toBe(true)
    expect(second.documents.map((document) => document.externalId)).toEqual(['file-200.md'])
    expect(second.hasMore).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('replays a pinned tree in a fresh worker even when the branch has moved', async () => {
    const original = Array.from({ length: 201 }, (_, index) =>
      treeFile(`file-${index}.md`, `blob-${index}`)
    )
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/git/trees/main')) return treeResponse(original)
      if (url.includes('/git/trees/tree-sha')) return treeResponse(original)
      if (url.includes('/git/blobs/blob-200')) return new Response('original bytes')
      throw new Error('Unpinned request escaped the original snapshot')
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await githubConnector.listDocuments('token', source, undefined, {})
    const context = {}
    const resumed = await githubConnector.listDocuments('token', source, first.nextCursor, context)
    expect(resumed.documents.map((doc) => doc.externalId)).toEqual(['file-200.md'])
    expect(
      await githubConnector.getDocument('token', source, 'file-200.md', context)
    ).toMatchObject({
      content: 'original bytes',
      contentHash: 'git-sha:blob-200',
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/owner/repo/git/trees/main?recursive=1',
      'https://api.github.com/repos/owner/repo/git/trees/tree-sha?recursive=1',
      'https://api.github.com/repos/owner/repo/git/blobs/blob-200',
    ])
  })

  it('restarts legacy offsets rather than skipping entries in a different tree', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const error = await githubConnector
      .listDocuments('token', source, '200', {})
      .catch((error: unknown) => error)
    expect(githubConnector.isListingCursorInvalidError?.(error)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404])(
    'classifies repository rejection %i for member access',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
      const error = await githubConnector.listDocuments('token', source).catch((error) => error)
      expect(githubConnector.isCredentialInvalidError?.(error)).toBe(status === 401)
      expect(githubConnector.isListingScopeUnavailableError?.(error)).toBe(status !== 401)
    }
  )

  it('does not revoke member access for a rate-limit 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 403, headers: { 'retry-after': '3600' } }))
    )
    const error = await githubConnector.listDocuments('token', source).catch((error) => error)
    expect(githubConnector.isListingScopeUnavailableError?.(error)).toBe(false)
    expect(githubConnector.isCredentialInvalidError?.(error)).toBe(false)
  })

  it('prevents deletion reconciliation after GitHub truncates the tree', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(treeResponse([treeFile('one.md')], true)))
    const context: Record<string, unknown> = {}
    await githubConnector.listDocuments('token', source, undefined, context)
    expect(context.listingCapped).toBe(true)
  })

  it('rejects malformed successful listings instead of treating them as an empty repository', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    await expect(githubConnector.listDocuments('token', source)).rejects.toThrow()
  })

  it.each(['owner/repo?redirect=x', 'owner/../other', 'owner/repo/tree/main', 'owner/.'])(
    'rejects invalid repository input %s before sending a token',
    async (repository) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await expect(githubConnector.validateConfig('token', { repository })).resolves.toMatchObject({
        valid: false,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )
})

describe('githubConnector.getDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null only when a listed path is no longer present', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(treeResponse([]))
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
    )

    await expect(
      githubConnector.getDocument('token', { repository: 'owner/repo' }, 'deleted.md')
    ).resolves.toBeNull()
  })

  it('records a blob that exceeds the byte cap as a visible skipped document', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(treeResponse([treeFile('oversized.md', 'blob-sha')]))
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
})

describe('githubConnector symlinks', () => {
  afterEach(() => vi.unstubAllGlobals())

  const link = { ...treeFile('docs/link.md', 'link-sha'), mode: '120000' }
  const target = treeFile('docs/target.md', 'target-sha')

  it.each(['target.md', '../../outside.md', '/etc/passwd', 'https://example.com/file.md'])(
    'skips a deleted, escaping, or external symlink target: %s',
    async (targetPath) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(treeResponse([link], false, 'target-deleted-tree'))
        .mockResolvedValueOnce(new Response(targetPath))
      vi.stubGlobal('fetch', fetchMock)
      const context = {}
      const listing = await githubConnector.listDocuments('token', source, undefined, context)
      const hydrated = await githubConnector.getDocument('token', source, link.path, context)
      expect(hydrated).toMatchObject({
        content: '',
        contentDeferred: false,
        contentHash: listing.documents[0].contentHash,
        skippedReason: 'Symbolic link target is not a repository file',
        skippedExistingDisposition: 'replace',
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  )

  it('bounds cycles without repeatedly fetching the same link', async () => {
    const nextLink = { ...treeFile('docs/next.md', 'next-link-sha'), mode: '120000' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(treeResponse([link, nextLink]))
      .mockResolvedValueOnce(new Response('next.md'))
      .mockResolvedValueOnce(new Response('link.md'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(githubConnector.getDocument('token', source, link.path)).resolves.toMatchObject({
      content: '',
      skippedReason: 'Symbolic link target is not a repository file',
      skippedExistingDisposition: 'replace',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('caps a long acyclic link chain at forty target reads', async () => {
    const links = Array.from({ length: 41 }, (_, index) => ({
      ...treeFile(`link-${index}.md`, `link-sha-${index}`),
      mode: '120000',
    }))
    const fetchMock = vi.fn().mockResolvedValueOnce(treeResponse(links))
    for (let index = 1; index <= 40; index++)
      fetchMock.mockResolvedValueOnce(new Response(`link-${index}.md`))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      githubConnector.getDocument('token', source, links[0].path)
    ).resolves.toMatchObject({
      skippedReason: 'Symbolic link target is not a repository file',
      skippedExistingDisposition: 'replace',
    })
    expect(fetchMock).toHaveBeenCalledTimes(41)
  })

  it('fails hydration when a truncated snapshot may have omitted the target', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(treeResponse([link], true))
        .mockResolvedValueOnce(new Response('target.md'))
    )
    await expect(githubConnector.getDocument('token', source, link.path)).rejects.toThrow(
      'GitHub tree was truncated before the symbolic link target could be resolved'
    )
  })

  it('preserves binary detection and byte limits for actual symlink target blobs', async () => {
    for (const [body, length, reason] of [
      ['binary\0contents', '15', 'Binary file was not indexed'],
      [
        'oversized',
        String(100 * 1024 * 1024 + 1),
        'File exceeds the 100MB size limit and was not indexed',
      ],
    ]) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(treeResponse([link, target]))
          .mockResolvedValueOnce(new Response('target.md'))
          .mockResolvedValueOnce(new Response(body, { headers: { 'content-length': length } }))
      )
      await expect(githubConnector.getDocument('token', source, link.path)).resolves.toMatchObject({
        content: '',
        skippedReason: reason,
        skippedExistingDisposition: 'replace',
      })
    }
  })
})
