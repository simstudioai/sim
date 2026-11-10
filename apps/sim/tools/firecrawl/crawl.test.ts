import { isPlainRecord } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { crawlTool } from '@/tools/firecrawl/crawl'

function crawlBody(options: {
  url?: string
  maxDepth: number
  maxDiscoveryDepth?: number
  includePaths?: string[]
  excludePaths?: string[]
}) {
  if (typeof crawlTool.request.body !== 'function') throw new Error('Missing request formatter')
  const body = crawlTool.request.body({ apiKey: 'test', url: 'https://example.com', ...options })
  if (!isPlainRecord(body)) throw new Error('Expected a JSON request body')
  return body
}

describe('Firecrawl legacy crawl depth', () => {
  it('bounds URL path segments without limiting discovery hops', () => {
    const body = crawlBody({ maxDepth: 1, maxDiscoveryDepth: 4 })
    const patterns = (body.includePaths as string[]).map((pattern) => new RegExp(pattern))
    const accepts = (path: string) => patterns.some((pattern) => pattern.test(path))

    expect(body.maxDiscoveryDepth).toBe(4)
    expect(body.regexOnFullURL).toBe(false)
    expect(accepts('/')).toBe(true)
    expect(accepts('/docs')).toBe(true)
    expect(accepts('/docs/index.html')).toBe(true)
    expect(accepts('/docs/guide')).toBe(false)
    expect(accepts('/docs/guide/page')).toBe(false)
  })

  it.each<[string, boolean]>([
    ['/docs/guide', true],
    ['/docs/guide/a', true],
    ['/docs/guide/a/index.html', true],
    ['/docs/guide/a/b', false],
  ])('counts depth from a start URL with a path: %s', (path, accepted) => {
    for (const url of [
      'https://example.com/docs/guide',
      'https://example.com/docs/guide/index.html',
    ]) {
      const body = crawlBody({ url, maxDepth: 1 })
      const includes = (body.includePaths as string[]).map((pattern) => new RegExp(pattern))
      expect(includes.some((pattern) => pattern.test(path))).toBe(accepted)
      const filtered = crawlBody({ url, maxDepth: 1, includePaths: ['^/docs'] })
      const excludes = (filtered.excludePaths as string[]).map((pattern) => new RegExp(pattern))
      expect(excludes.some((pattern) => pattern.test(path))).toBe(!accepted)
    }
  })

  it('keeps existing path filters while excluding paths beyond the legacy depth', () => {
    const body = crawlBody({ maxDepth: 1, includePaths: ['^/docs'], excludePaths: ['private'] })
    const patterns = (body.excludePaths as string[]).map((pattern) => new RegExp(pattern))
    const excludes = (path: string) => patterns.some((pattern) => pattern.test(path))

    expect(body.includePaths).toEqual(['^/docs'])
    expect(excludes('/docs')).toBe(false)
    expect(excludes('/docs/guide')).toBe(true)
    expect(excludes('/private')).toBe(true)
    expect(body.maxDiscoveryDepth).toBeUndefined()
  })

  it('honors a zero depth instead of dropping the limit', () => {
    const body = crawlBody({ maxDepth: 0 })
    const patterns = (body.includePaths as string[]).map((pattern) => new RegExp(pattern))
    expect(patterns.some((pattern) => pattern.test('/'))).toBe(true)
    expect(patterns.some((pattern) => pattern.test('/docs'))).toBe(false)
  })

  it.each<[number, string, boolean]>([
    [0, '/index.html', false],
    [0, '/index.php/', false],
    [1, '/docs/index.html', false],
    [1, '/docs/index.php', false],
    [1, '/docs//index.html/', false],
    [1, '/docs/guide/index.html', true],
    [1, '/docs/index.html/child', true],
    [1, '/docs/index.html.bak', true],
    [1, '/docs/index.phpx', true],
    [1, '/docs/inde', true],
    [1, '/docs/index.htm', true],
  ])('applies depth %s with existing includes to %s', (maxDepth, path, excluded) => {
    const body = crawlBody({ maxDepth, includePaths: ['^/'] })
    const patterns = (body.excludePaths as string[]).map((pattern) => new RegExp(pattern))
    expect(patterns.some((pattern) => pattern.test(path))).toBe(excluded)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid legacy depth: %s',
    (maxDepth) => {
      expect(() => crawlBody({ maxDepth })).toThrow(/maxDepth/)
    }
  )
})
