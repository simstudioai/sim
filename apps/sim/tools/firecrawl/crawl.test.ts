import { isPlainRecord } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { crawlTool } from '@/tools/firecrawl/crawl'

function crawlBody(options: {
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

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid legacy depth: %s',
    (maxDepth) => {
      expect(() => crawlBody({ maxDepth })).toThrow(/maxDepth/)
    }
  )
})
