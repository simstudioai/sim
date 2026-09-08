/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { githubConnector } from '@/connectors/github/github'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

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

  it('resolves a member source default branch once and reuses it during hydration', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ default_branch: 'master' })))
      .mockResolvedValueOnce(treeResponse([treeFile('readme.md', 'sha')]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sha: 'sha', size: 4, content: 'dGV4dA==', encoding: 'base64' })
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    const context: Record<string, unknown> = { ...PER_MEMBER_LISTING_CONTEXT }
    const config = { repository: 'owner/repo' }
    const listing = await githubConnector.listDocuments('member-token', config, undefined, context)
    const hydrated = await githubConnector.getDocument('member-token', config, 'readme.md', context)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/owner/repo',
      'https://api.github.com/repos/owner/repo/git/trees/master?recursive=1',
      'https://api.github.com/repos/owner/repo/contents/readme.md?ref=master',
    ])
    expect(listing.documents[0]?.metadata?.branch).toBe('master')
    expect(hydrated?.metadata?.branch).toBe('master')
    expect(hydrated?.contentHash).toBe(listing.documents[0]?.contentHash)
  })

  it('preserves the default main branch for existing general KB sources', async () => {
    const fetchMock = vi.fn().mockResolvedValue(treeResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    await githubConnector.listDocuments('pat', { repository: 'owner/repo' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/owner/repo/git/trees/main?recursive=1'
    )
  })

  it('uses an explicitly configured member branch without a repository metadata lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(treeResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    await githubConnector.listDocuments(
      'member-token',
      { repository: 'owner/repo', branch: 'release/docs' },
      undefined,
      { ...PER_MEMBER_LISTING_CONTEXT }
    )
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/owner/repo/git/trees/release%2Fdocs?recursive=1'
    )
  })

  it('validates a member source against its actual default branch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ default_branch: 'develop' })))
      .mockResolvedValueOnce(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      githubConnector.validateConfig(
        'member-token',
        { repository: 'owner/repo' },
        {
          ...PER_MEMBER_LISTING_CONTEXT,
        }
      )
    ).resolves.toEqual({ valid: true })
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.github.com/repos/owner/repo/branches/develop'
    )
  })

  it('lists only metadata under the caller token and retains the hydration hash', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(treeResponse([treeFile('docs/readme.md', 'blob-sha')]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sha: 'blob-sha', size: 20, content: 'dGV4dA==', encoding: 'base64' })
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    const context = {}
    const result = await githubConnector.listDocuments('member-token', source, undefined, context)
    expect(result.documents[0]).toMatchObject({
      externalId: 'docs/readme.md',
      content: '',
      contentDeferred: true,
      contentHash: 'git-sha:blob-sha',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer member-token')
    const hydrated = await githubConnector.getDocument(
      'member-token',
      source,
      'docs/readme.md',
      context
    )
    expect(hydrated?.contentHash).toBe(result.documents[0]?.contentHash)
    expect(hydrated?.content).toBe('text')
  })

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

  it.each([401, 403, 404])(
    'classifies repository rejection %i for member access',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
      const error = await githubConnector.listDocuments('token', source).catch((error) => error)
      expect(githubConnector.isCredentialInvalidError?.(error)).toBe(status === 401)
      expect(githubConnector.isListingScopeUnavailableError?.(error)).toBe(status !== 401)
    }
  )

  it('keeps an SSO denial distinct from invalid credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 403, headers: { 'x-github-sso': 'required' } })
        )
    )
    const error = await githubConnector.listDocuments('token', source).catch((error) => error)
    expect(githubConnector.isListingScopeUnavailableError?.(error)).toBe(true)
    expect(githubConnector.isCredentialInvalidError?.(error)).toBe(false)
  })

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

  it('does not revoke access for a secondary throttle without rate-limit headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), {
          status: 403,
        })
      )
    )
    const error = await githubConnector.listDocuments('token', source).catch((error) => error)
    expect(githubConnector.isListingScopeUnavailableError?.(error)).toBe(false)
    expect(error).toMatchObject({ rateLimited: true, retryAfterMs: 60_000 })
  })

  it('prevents deletion reconciliation after GitHub truncates the tree', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(treeResponse([treeFile('one.md')], true)))
    const context: Record<string, unknown> = {}
    await githubConnector.listDocuments('token', source, undefined, context)
    expect(context.listingCapped).toBe(true)
  })

  it('prevents reconciliation after a general KB file cap truncates the listing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(treeResponse([treeFile('one.md'), treeFile('two.md')]))
    )
    const context: Record<string, unknown> = {}
    const result = await githubConnector.listDocuments(
      'token',
      { ...source, maxFiles: '1' },
      undefined,
      context
    )
    expect(result.documents).toHaveLength(1)
    expect(context.listingCapped).toBe(true)
  })

  it('allows reconciliation after intentional scope filtering', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          treeResponse([treeFile('docs/one.md'), treeFile('docs/two.txt'), treeFile('src/code.ts')])
        )
    )
    const context: Record<string, unknown> = {}
    const result = await githubConnector.listDocuments(
      'token',
      { ...source, pathPrefix: 'docs/', extensions: 'md' },
      undefined,
      context
    )
    expect(result.documents.map((document) => document.externalId)).toEqual(['docs/one.md'])
    expect(context.listingCapped).toBeUndefined()
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

  it('uses the object media type and hydrates large file content through the blob API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(treeResponse([treeFile('docs/large.md', 'blob-sha')]))
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

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: expect.objectContaining({ Accept: 'application/vnd.github.object+json' }),
    })
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
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

  it('rejects a bodyless blob response instead of misreporting it as oversized', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(treeResponse([treeFile('missing-body.md', 'blob-sha')]))
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
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      githubConnector.getDocument('token', { repository: 'owner/repo' }, 'missing-body.md')
    ).rejects.toThrow('GitHub git blob blob-sha returned no body')
  })

  it('retains null hydration for a repository that became unavailable before the tree request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(githubConnector.getDocument('token', source, 'docs/readme.md')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a non-rate-limit 403 as a document failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(treeResponse([treeFile('private.md')]))
        .mockResolvedValueOnce(new Response(null, { status: 403 }))
    )

    await expect(
      githubConnector.getDocument('token', { repository: 'owner/repo' }, 'private.md')
    ).rejects.toThrow('Failed to fetch file private.md: 403')
  })
})

describe('githubConnector symlinks', () => {
  afterEach(() => vi.unstubAllGlobals())

  const link = { ...treeFile('docs/link.md', 'link-sha'), mode: '120000' }
  const target = treeFile('docs/target.md', 'target-sha')

  function contents(content: string) {
    return Response.json({
      type: 'file',
      sha: link.sha,
      size: Buffer.byteLength(content),
      encoding: 'base64',
      content: Buffer.from(content).toString('base64'),
    })
  }

  it('versions symlink targets while keeping unchanged trees and regular files stable', async () => {
    const stable = treeFile('docs/stable.md', 'stable-sha')
    const fetchMock = vi.fn()
    for (const [revision, text] of [
      ['one', 'one'],
      ['two', 'two'],
    ] as const) {
      fetchMock
        .mockResolvedValueOnce(treeResponse([link, stable, target], false, `tree-${revision}`))
        .mockResolvedValueOnce(contents(text))
        .mockResolvedValueOnce(new Response('target.md'))
        .mockResolvedValueOnce(new Response(text))
    }
    fetchMock.mockResolvedValueOnce(treeResponse([link, stable, target], false, 'tree-two'))
    vi.stubGlobal('fetch', fetchMock)
    const firstContext = {}
    const first = await githubConnector.listDocuments('token', source, undefined, firstContext)
    const firstContent = await githubConnector.getDocument('token', source, link.path, firstContext)
    const secondContext = {}
    const second = await githubConnector.listDocuments('token', source, undefined, secondContext)
    const secondContent = await githubConnector.getDocument(
      'token',
      source,
      link.path,
      secondContext
    )
    const unchanged = await githubConnector.listDocuments('token', source, undefined, {})

    expect(firstContent?.content).toBe('one')
    expect(secondContent?.content).toBe('two')
    expect(firstContent?.contentHash).toBe(first.documents[0].contentHash)
    expect(secondContent?.contentHash).toBe(second.documents[0].contentHash)
    expect(first.documents[0].contentHash).not.toBe(second.documents[0].contentHash)
    expect(unchanged.documents.map((doc) => doc.contentHash)).toEqual(
      second.documents.map((doc) => doc.contentHash)
    )
    expect(first.documents[1].contentHash).toBe(second.documents[1].contentHash)
    expect(fetchMock).toHaveBeenCalledTimes(9)
  })

  it.each(['target.md', '../../outside.md', '/etc/passwd', 'https://example.com/file.md'])(
    'skips a deleted, escaping, or external symlink target: %s',
    async (targetPath) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(treeResponse([link], false, 'target-deleted-tree'))
        .mockResolvedValueOnce(Response.json({ type: 'symlink', sha: link.sha, size: 9 }))
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
      expect(fetchMock).toHaveBeenCalledTimes(3)
    }
  )

  it('reads the full target blob when GitHub Contents silently truncates a link at 1 MiB', async () => {
    const fullContent = 'x'.repeat(1024 * 1024 + 8192)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(treeResponse([link, { ...target, size: fullContent.length }]))
      .mockResolvedValueOnce(contents(fullContent.slice(0, 1024 * 1024)))
      .mockResolvedValueOnce(new Response('target.md'))
      .mockResolvedValueOnce(new Response(fullContent))
    vi.stubGlobal('fetch', fetchMock)
    const context = {}
    const listing = await githubConnector.listDocuments('token', source, undefined, context)
    const hydrated = await githubConnector.getDocument('token', source, link.path, context)
    expect(hydrated?.content.length).toBe(fullContent.length)
    expect(hydrated?.content.endsWith(fullContent.slice(-8192))).toBe(true)
    expect(hydrated?.contentHash).toBe(listing.documents[0].contentHash)
    expect(hydrated?.metadata?.size).toBe(fullContent.length)
    expect(fetchMock.mock.calls.slice(2).map(([url]) => url)).toEqual([
      'https://api.github.com/repos/owner/repo/git/blobs/link-sha',
      'https://api.github.com/repos/owner/repo/git/blobs/target-sha',
    ])
  })

  it('follows an in-repository link chain outside the configured listing prefix', async () => {
    const nextLink = { ...treeFile('intermediate.md', 'next-link-sha'), mode: '120000' }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(treeResponse([link, nextLink, target]))
        .mockResolvedValueOnce(contents('complete target'))
        .mockResolvedValueOnce(new Response('../intermediate.md'))
        .mockResolvedValueOnce(new Response('docs/target.md'))
        .mockResolvedValueOnce(new Response('complete target'))
    )
    await expect(
      githubConnector.getDocument('token', { ...source, pathPrefix: 'docs/' }, link.path)
    ).resolves.toMatchObject({ content: 'complete target' })
  })

  it('bounds cycles without repeatedly fetching the same link', async () => {
    const nextLink = { ...treeFile('docs/next.md', 'next-link-sha'), mode: '120000' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(treeResponse([link, nextLink]))
      .mockResolvedValueOnce(Response.json({ type: 'symlink', sha: link.sha, size: 7 }))
      .mockResolvedValueOnce(new Response('next.md'))
      .mockResolvedValueOnce(new Response('link.md'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(githubConnector.getDocument('token', source, link.path)).resolves.toMatchObject({
      content: '',
      skippedReason: 'Symbolic link target is not a repository file',
      skippedExistingDisposition: 'replace',
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('caps a long acyclic link chain at forty target reads', async () => {
    const links = Array.from({ length: 41 }, (_, index) => ({
      ...treeFile(`link-${index}.md`, `link-sha-${index}`),
      mode: '120000',
    }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(treeResponse(links))
      .mockResolvedValueOnce(Response.json({ type: 'symlink', sha: links[0].sha, size: 9 }))
    for (let index = 1; index <= 40; index++)
      fetchMock.mockResolvedValueOnce(new Response(`link-${index}.md`))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      githubConnector.getDocument('token', source, links[0].path)
    ).resolves.toMatchObject({
      skippedReason: 'Symbolic link target is not a repository file',
      skippedExistingDisposition: 'replace',
    })
    expect(fetchMock).toHaveBeenCalledTimes(42)
  })

  it('fails hydration when a truncated snapshot may have omitted the target', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(treeResponse([link], true))
        .mockResolvedValueOnce(contents('possibly valid target'))
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
          .mockResolvedValueOnce(contents('incomplete contents'))
          .mockResolvedValueOnce(new Response('target.md'))
          .mockResolvedValueOnce(new Response(body, { headers: { 'content-length': length } }))
      )
      await expect(githubConnector.getDocument('token', source, link.path)).resolves.toMatchObject({
        content: '',
        skippedReason: reason,
      })
    }
  })
})
