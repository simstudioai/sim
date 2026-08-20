/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assertBitbucketResponseOk,
  bitbucketApiUrl,
  bitbucketJson,
  bitbucketRawHead,
  bitbucketRawTail,
  bitbucketRepositoryPath,
  encodeBitbucketRepositoryPath,
  encodeBitbucketSegment,
  normalizeBitbucketFileMetadata,
  normalizeBitbucketPage,
  validateBitbucketOpaqueUrl,
  validateBitbucketPullRequestRedirect,
} from '@/tools/bitbucket/utils'

describe('Bitbucket path and pagination safety', () => {
  it('encodes every identifier as one path segment', () => {
    expect(encodeBitbucketSegment(' team/blue?admin=true#x ', 'workspaceSlug')).toBe(
      'team%2Fblue%3Fadmin%3Dtrue%23x'
    )
    expect(bitbucketRepositoryPath('team / blue', 'repo/../secret?x=1')).toBe(
      '/repositories/team%20%2F%20blue/repo%2F..%2Fsecret%3Fx%3D1'
    )
  })

  it('encodes repository paths segment-by-segment, including spaces and hostile characters', () => {
    expect(encodeBitbucketRepositoryPath('/src/my file?#.ts/')).toBe('src/my%20file%3F%23.ts')
    expect(encodeBitbucketRepositoryPath('', true)).toBe('')
    expect(() => encodeBitbucketRepositoryPath('src/../secret')).toThrow(/dot segment/)
    expect(() => encodeBitbucketRepositoryPath('src/./file')).toThrow(/dot segment/)
    expect(() => encodeBitbucketSegment('..', 'repoSlug')).toThrow(/dot path segment/)
  })

  it('builds bounded list queries and does not add pagination to non-list calls', () => {
    const list = new URL(
      bitbucketApiUrl('/repositories/acme', {
        pageLen: 25,
        query: { role: 'owner', q: 'name ~ "sdk"', ignored: undefined },
      })
    )
    expect(list.origin).toBe('https://api.bitbucket.org')
    expect(list.pathname).toBe('/2.0/repositories/acme')
    expect(Object.fromEntries(list.searchParams)).toEqual({
      role: 'owner',
      q: 'name ~ "sdk"',
      pagelen: '25',
    })

    expect(bitbucketApiUrl('/repositories/acme/demo')).toBe(
      'https://api.bitbucket.org/2.0/repositories/acme/demo'
    )
    expect(() => bitbucketApiUrl('/repositories/acme', { pageLen: 101 })).toThrow(
      /between 1 and 100/
    )
  })

  it('accepts only exact HTTPS Bitbucket Cloud API 2.0 cursor authorities', () => {
    const valid = 'https://api.bitbucket.org/2.0/repositories/acme?page=2'
    expect(validateBitbucketOpaqueUrl(valid)).toBe(valid)

    const hostile = [
      'http://api.bitbucket.org/2.0/repositories/acme?page=2',
      'https://api.bitbucket.org.evil.test/2.0/repositories/acme?page=2',
      'https://api.bitbucket.org:444/2.0/repositories/acme?page=2',
      'https://user:pass@api.bitbucket.org/2.0/repositories/acme?page=2',
      'https://api.bitbucket.org/1.0/repositories/acme?page=2',
      'https://api.bitbucket.org/2.0/repositories/acme?page=2#fragment',
      'not a url',
    ]
    for (const candidate of hostile) {
      expect(() => validateBitbucketOpaqueUrl(candidate), candidate).toThrow()
    }
  })

  it('binds opaque cursors to the exact list endpoint', () => {
    const expected = 'https://api.bitbucket.org/2.0/repositories/acme/demo/commits?page=2'
    expect(
      bitbucketApiUrl('/repositories/acme/demo/commits', {
        nextUrl: expected,
        pageLen: 100,
        query: { q: 'ignored for opaque cursors' },
      })
    ).toBe(expected)

    expect(() =>
      bitbucketApiUrl('/repositories/acme/demo/commits', {
        nextUrl: 'https://api.bitbucket.org/2.0/repositories/acme/demo/pipelines?page=2',
      })
    ).toThrow(/does not belong/)

    for (const nextUrl of [false, 0, null, {}]) {
      expect(() =>
        bitbucketApiUrl('/repositories/acme/demo/commits', {
          nextUrl: nextUrl as never,
        })
      ).toThrow(/nextUrl must be a non-empty string/)
    }
  })

  it('accepts a canonical-cased cursor for a mixed-case slug but not a re-cased file path', () => {
    const canonical = 'https://api.bitbucket.org/2.0/repositories/acme/demo/commits?page=2'
    expect(bitbucketApiUrl('/repositories/ACME/Demo/commits', { nextUrl: canonical })).toBe(
      canonical
    )

    const revision = '0123456789abcdef0123456789abcdef01234567'
    expect(
      bitbucketApiUrl(`/repositories/ACME/Demo/src/${revision.toUpperCase()}/src/dir`, {
        nextUrl: `https://api.bitbucket.org/2.0/repositories/acme/demo/src/${revision}/src/dir?page=2`,
        nextPathPrefix: '/repositories/ACME/Demo/src',
        nextPathSuffix: 'src/dir',
        nextRevision: revision.toUpperCase(),
      })
    ).toBe(`https://api.bitbucket.org/2.0/repositories/acme/demo/src/${revision}/src/dir?page=2`)

    for (const recased of [
      'https://api.bitbucket.org/2.0/Repositories/acme/demo/commits?page=2',
      'https://api.bitbucket.org/2.0/repositories/acme/demo/Commits?page=2',
    ]) {
      expect(
        () => bitbucketApiUrl('/repositories/ACME/Demo/commits', { nextUrl: recased }),
        recased
      ).toThrow(/does not belong to this Bitbucket list endpoint/)
    }

    expect(() =>
      bitbucketApiUrl(`/repositories/acme/demo/src/${revision}/src/Dir`, {
        nextUrl: `https://api.bitbucket.org/2.0/repositories/acme/demo/src/${revision}/src/dir?page=2`,
        nextPathPrefix: '/repositories/acme/demo/src',
        nextPathSuffix: 'src/Dir',
        nextRevision: revision,
      })
    ).toThrow(/does not preserve the requested Bitbucket directory path/)
  })

  it('binds directory cursors to the selected repository path', () => {
    const revision = '0123456789abcdef0123456789abcdef01234567'
    const next = `https://api.bitbucket.org/2.0/repositories/acme/demo/src/${revision}/src/my%20dir?page=2`
    expect(
      bitbucketApiUrl(`/repositories/acme/demo/src/${revision}/src/my%20dir`, {
        nextUrl: next,
        nextPathPrefix: '/repositories/acme/demo/src',
        nextPathSuffix: 'src/my%20dir',
        nextRevision: revision,
      })
    ).toBe(next)

    const equivalentEncoding = `https://api.bitbucket.org/2.0/repositories/acme/demo/src/${revision}/src/my%20%64ir?page=2`
    expect(
      bitbucketApiUrl(`/repositories/acme/demo/src/${revision}/src/my%20dir`, {
        nextUrl: equivalentEncoding,
        nextPathPrefix: '/repositories/acme/demo/src',
        nextPathSuffix: 'src/my%20dir',
        nextRevision: revision,
      })
    ).toBe(equivalentEncoding)

    expect(() =>
      bitbucketApiUrl(`/repositories/acme/demo/src/${revision}/src/my%20dir`, {
        nextUrl: `https://api.bitbucket.org/2.0/repositories/acme/demo/src/${revision}/src/other?page=2`,
        nextPathPrefix: '/repositories/acme/demo/src',
        nextPathSuffix: 'src/my%20dir',
        nextRevision: revision,
      })
    ).toThrow(/does not preserve/)

    expect(() =>
      bitbucketApiUrl(`/repositories/acme/demo/src/${revision}/src/my%20dir`, {
        nextUrl: `https://api.bitbucket.org/2.0/repositories/acme/demo/src/${revision}/src//my%20dir?page=2`,
        nextPathPrefix: '/repositories/acme/demo/src',
        nextPathSuffix: 'src/my%20dir',
        nextRevision: revision,
      })
    ).toThrow(/empty path segments/)

    const otherRevision = 'fedcba9876543210fedcba9876543210fedcba98'
    expect(() =>
      bitbucketApiUrl(`/repositories/acme/demo/src/${revision}/src/my%20dir`, {
        nextUrl: `https://api.bitbucket.org/2.0/repositories/acme/demo/src/${otherRevision}/src/my%20dir?page=2`,
        nextPathPrefix: '/repositories/acme/demo/src',
        nextPathSuffix: 'src/my%20dir',
        nextRevision: revision,
      })
    ).toThrow(/requested Bitbucket revision/)
  })

  it('rejects non-primitive runtime query values', () => {
    expect(() =>
      bitbucketApiUrl('/repositories/acme', {
        query: { role: { unexpected: true } } as never,
      })
    ).toThrow(/query parameter role must be a string, number, or boolean/)
  })

  it('accepts PR redirects only for the requested repository and endpoint kind', () => {
    const diff = 'https://api.bitbucket.org/2.0/repositories/acme/demo/diff/main..feature'
    expect(validateBitbucketPullRequestRedirect(diff, 'acme', 'demo', 'diff')).toBe(diff)
    const providerQualified =
      'https://api.bitbucket.org/2.0/repositories/acme/demo/diff/source-team/source-repo:6315b3bac849%0Decdc2efc4f27?from_pullrequest_id=7&topic=true'
    expect(validateBitbucketPullRequestRedirect(providerQualified, 'acme', 'demo', 'diff')).toBe(
      providerQualified
    )
    expect(() =>
      validateBitbucketPullRequestRedirect(
        'https://api.bitbucket.org/2.0/repositories/acme/other/diff/main..feature',
        'acme',
        'demo',
        'diff'
      )
    ).toThrow(/did not target/)
    expect(() =>
      validateBitbucketPullRequestRedirect(
        'https://api.bitbucket.org/2.0/repositories/acme/demo/diff/main..feature//extra',
        'acme',
        'demo',
        'diff'
      )
    ).toThrow(/empty spec path segment/)
    expect(() =>
      validateBitbucketPullRequestRedirect(
        'https://api.bitbucket.org/2.0/repositories/acme/demo/diffstat/main..feature',
        'acme',
        'demo',
        'diff'
      )
    ).toThrow(/did not target/)
  })
})

describe('Bitbucket envelopes and errors', () => {
  it('normalizes lists to items plus stable page metadata', () => {
    const output = normalizeBitbucketPage(
      {
        values: [{ id: 1 }, { id: 2 }],
        size: 9,
        page: 2,
        pagelen: 2,
        next: 'https://api.bitbucket.org/2.0/repositories/acme?page=3',
        previous: 'https://api.bitbucket.org/2.0/repositories/acme?page=1',
      },
      (value) => value
    )

    expect(output).toEqual({
      items: [{ id: 1 }, { id: 2 }],
      page: {
        size: 9,
        page: 2,
        pageLen: 2,
        nextUrl: 'https://api.bitbucket.org/2.0/repositories/acme?page=3',
        previousUrl: 'https://api.bitbucket.org/2.0/repositories/acme?page=1',
      },
    })
  })

  it('rejects malformed pagination envelopes and pagination links', () => {
    expect(() => normalizeBitbucketPage({}, (value) => value)).toThrow(/values array/)
    expect(() =>
      normalizeBitbucketPage({ values: [], next: { href: 'not-supported' } }, (value) => value)
    ).toThrow(/pagination next must be a URL/)
    expect(() =>
      normalizeBitbucketPage(
        { values: [], next: 'https://evil.test/2.0/repositories/acme?page=2' },
        (value) => value
      )
    ).toThrow(/Bitbucket Cloud API 2.0 URL/)
  })

  it('rejects non-object JSON responses', async () => {
    await expect(bitbucketJson(Response.json([]))).rejects.toThrow(/non-object JSON/)
    await expect(bitbucketJson(Response.json(null))).rejects.toThrow(/non-object JSON/)
  })

  it('extracts Bitbucket structured errors and preserves plain-text errors', async () => {
    await expect(
      assertBitbucketResponseOk(
        Response.json({ error: { message: 'Merge checks failed' } }, { status: 409 })
      )
    ).rejects.toThrow('Merge checks failed')
    await expect(
      assertBitbucketResponseOk(new Response('Service unavailable', { status: 503 }))
    ).rejects.toThrow('Service unavailable')
    await expect(assertBitbucketResponseOk(new Response(null, { status: 429 }))).rejects.toThrow(
      /Bitbucket API error: 429/
    )
  })

  it('distinguishes documented binary metadata from unknown metadata', () => {
    expect(
      normalizeBitbucketFileMetadata({
        type: 'commit_file',
        path: 'assets/logo.png',
        commit: { hash: 'abc' },
        escaped_path: 'assets/logo.png',
        size: 42,
        attributes: ['binary', 'lfs'],
      })
    ).toMatchObject({ attributes: ['binary', 'lfs'], isBinary: true })
    expect(
      normalizeBitbucketFileMetadata({ type: 'commit_file', path: 'README.md' })
    ).toMatchObject({
      attributes: null,
      isBinary: null,
    })
    expect(
      normalizeBitbucketFileMetadata({
        type: 'commit_file',
        path: 'README.md',
        attributes: [],
      })
    ).toMatchObject({ attributes: [], isBinary: false })
    expect(
      normalizeBitbucketFileMetadata({
        type: 'commit_file',
        path: 'binary.dat',
        attributes: 'binary',
      })
    ).toMatchObject({ attributes: ['binary'], isBinary: true })
    expect(() =>
      normalizeBitbucketFileMetadata({
        type: 'commit_file',
        path: 'README.md',
        attributes: ['future_attribute', 1],
      })
    ).toThrow(/metadata\.attributes\[1\] must be a string/)
  })
})

describe('Bitbucket bounded raw content', () => {
  it('caps UTF-8 file content without emitting an incomplete trailing character', async () => {
    const bytes = new TextEncoder().encode('ab🙂cd')
    const partial = bytes.slice(0, 5)
    const result = await bitbucketRawHead(
      new Response(partial, {
        status: 206,
        headers: {
          'Content-Range': `bytes 0-${partial.byteLength - 1}/${bytes.byteLength}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
      }),
      5,
      false
    )

    expect(result).toEqual({
      content: 'ab',
      binary: false,
      truncated: true,
      returnedBytes: partial.byteLength,
      fullBytes: bytes.byteLength,
      contentType: 'text/plain; charset=utf-8',
    })
  })

  it('locally caps a full response when Range is ignored', async () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'
    const result = await bitbucketRawHead(
      new Response(text, { headers: { 'Content-Length': String(text.length) } }),
      3,
      false
    )

    expect(result).toEqual({
      content: 'abc',
      binary: false,
      truncated: true,
      returnedBytes: 12,
      fullBytes: text.length,
      contentType: 'text/plain;charset=UTF-8',
    })
  })

  it('does not split an astral character at a retained prefix boundary', async () => {
    const text = 'ab😀cd'
    const result = await bitbucketRawHead(
      new Response(text, { headers: { 'Content-Length': String(Buffer.byteLength(text)) } }),
      3,
      false
    )

    expect(result.content).toBe('ab')
    expect(result.content).not.toMatch(/[\ud800-\udfff]/)
    expect(result.truncated).toBe(true)
  })

  it.each([
    ['missing range', {}, 'abcde'],
    ['impossible total', { 'Content-Range': 'bytes 0-4/4' }, 'abcde'],
    [
      'inconsistent length header',
      { 'Content-Range': 'bytes 0-4/10', 'Content-Length': '4' },
      'abcde',
    ],
    ['inconsistent body length', { 'Content-Range': 'bytes 0-4/10' }, 'abcd'],
  ])('rejects a 206 prefix with %s', async (_name, headers, body) => {
    await expect(
      bitbucketRawHead(new Response(body, { status: 206, headers }), 100, false)
    ).rejects.toThrow(/Content-(?:Range|Length)|body does not match/)
  })

  it('detects NUL bytes when metadata cannot determine whether a file is binary', async () => {
    const result = await bitbucketRawHead(
      new Response(new Uint8Array([65, 0, 66]), {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
      100,
      null
    )

    expect(result).toMatchObject({
      content: null,
      binary: true,
      truncated: true,
      returnedBytes: 3,
      fullBytes: 3,
    })
  })

  it('reports nullable truncation when raw binary size remains unknown', async () => {
    const result = await bitbucketRawHead(
      new Response(new Uint8Array([65, 0, 66]), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-2/*' },
      }),
      100,
      null
    )

    expect(result).toMatchObject({
      content: null,
      binary: true,
      truncated: null,
      returnedBytes: 3,
      fullBytes: null,
    })
  })

  it('trims a partial leading line from a ranged log tail', async () => {
    const body = 'ise\nFAILED: expected 1 to be 2\n'
    const result = await bitbucketRawTail(
      new Response(body, {
        status: 206,
        headers: { 'Content-Range': `bytes 969-999/1000` },
      }),
      100
    )

    expect(result).toEqual({
      log: 'FAILED: expected 1 to be 2\n',
      truncated: true,
      totalBytes: 1000,
    })
  })

  it('keeps the first line when a 206 response contains the entire log', async () => {
    const body = 'first\nsecond\n'
    const result = await bitbucketRawTail(
      new Response(body, {
        status: 206,
        headers: { 'Content-Range': `bytes 0-${body.length - 1}/${body.length}` },
      }),
      100
    )

    expect(result).toEqual({ log: body, truncated: false, totalBytes: body.length })
  })

  it.each([
    ['missing Content-Range', {}, 'abc'],
    ['non-suffix range', { 'Content-Range': 'bytes 0-2/10' }, 'abc'],
    ['body mismatch', { 'Content-Range': 'bytes 7-9/10' }, 'ab'],
  ])('rejects a 206 log tail with %s', async (_name, headers, body) => {
    await expect(
      bitbucketRawTail(new Response(body, { status: 206, headers }), 100)
    ).rejects.toThrow(/Content-Range|suffix|body does not match/)
  })

  it('accepts an internally consistent unknown-total log suffix', async () => {
    const result = await bitbucketRawTail(
      new Response('abc', {
        status: 206,
        headers: { 'Content-Range': 'bytes 7-9/*' },
      }),
      100
    )

    expect(result).toEqual({ log: 'abc', truncated: true, totalBytes: null })
  })

  it('accepts the minimum 4 KiB suffix response before trimming a small requested tail', async () => {
    const body = `${'x'.repeat(4_080)}\nDONE😀\n`
    const bytes = Buffer.byteLength(body)
    const result = await bitbucketRawTail(
      new Response(body, {
        status: 206,
        headers: { 'Content-Range': `bytes 1000-${999 + bytes}/${1000 + bytes}` },
      }),
      100
    )

    expect(result.log.endsWith('DONE😀\n')).toBe(true)
    expect(result.log.length).toBeLessThanOrEqual(100)
    expect(result.truncated).toBe(true)
  })

  it('does not split an astral character at a retained suffix boundary', async () => {
    const body = 'ab😀cd'
    const bytes = Buffer.byteLength(body)
    const result = await bitbucketRawTail(
      new Response(body, {
        status: 206,
        headers: { 'Content-Range': `bytes 0-${bytes - 1}/${bytes}` },
      }),
      3
    )

    expect(result.log).toBe('cd')
    expect(result.log).not.toMatch(/[\ud800-\udfff]/)
  })

  it('never empties the log when the retained window holds one long line', async () => {
    const body = `${'x'.repeat(400)}\n`
    const result = await bitbucketRawTail(
      new Response(body, { headers: { 'Content-Length': String(Buffer.byteLength(body)) } }),
      100
    )

    expect(result.log).toBe(`${'x'.repeat(99)}\n`)
    expect(result.truncated).toBe(true)
  })

  it('returns the fragment when the retained window contains no line break at all', async () => {
    const body = 'y'.repeat(400)
    const result = await bitbucketRawTail(
      new Response(body, { headers: { 'Content-Length': String(Buffer.byteLength(body)) } }),
      100
    )

    expect(result.log).toBe('y'.repeat(100))
    expect(result.truncated).toBe(true)
  })

  it('keeps a bounded tail when the server ignores Range', async () => {
    const body = `${'noise line\n'.repeat(20)}FAILED\n`
    const result = await bitbucketRawTail(
      new Response(body, { headers: { 'Content-Length': String(Buffer.byteLength(body)) } }),
      10
    )

    expect(result.log).toBe('FAILED\n')
    expect(result.log.startsWith('ne')).toBe(false)
    expect(result.log.length).toBeLessThanOrEqual(10)
    expect(result).toMatchObject({ truncated: true, totalBytes: Buffer.byteLength(body) })
  })
})
