/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { HtmlComplexityError, HtmlParser } from '@/lib/file-parsers/html-parser'

const parser = new HtmlParser()

describe('HtmlParser', () => {
  describe('resource limits', () => {
    it('rejects a document above the input byte cap', async () => {
      const sparse = Buffer.concat([
        Buffer.from('<html><body><p>'),
        Buffer.alloc(32 * 1024 * 1024, 0x61),
        Buffer.from('</p></body></html>'),
      ])

      await expect(parser.parseBuffer(sparse)).rejects.toThrow(
        /above the maximum of 33554432 bytes/
      )
    })

    it('rejects a tag-dense document above the markup-token cap', async () => {
      const dense = Buffer.from(`<html><body>${'<p>a</p>'.repeat(300_000)}</body></html>`)

      const error = await parser.parseBuffer(dense).catch((e) => e)

      expect(error).toBeInstanceOf(HtmlComplexityError)
      expect(error.message).toMatch(/exceeds the maximum of 500000 markup tokens/)
    })

    it('accepts a byte-heavy document whose markup stays under the token cap', async () => {
      const paragraph = `<p>${'word '.repeat(200)}</p>`
      const buffer = Buffer.from(`<html><body>${paragraph.repeat(2000)}</body></html>`)

      const result = await parser.parseBuffer(buffer)

      expect(result.content).toContain('word')
    })

    /**
     * Deep nesting overflows the stack inside cheerio's own recursive `.text()`,
     * which the caps cannot pre-empt. A `RangeError` is catchable, so it must
     * surface as a rejected promise rather than take the process down.
     */
    it('surfaces deeply nested markup as a catchable error, not a crash', async () => {
      const depth = 15_000
      const buffer = Buffer.from(
        `<html><body>${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}</body></html>`
      )

      await expect(parser.parseBuffer(buffer)).rejects.toThrow(/Failed to parse HTML buffer/)
    })
  })

  describe('extraction', () => {
    it('extracts structured text, headings, links, and metadata', async () => {
      const buffer = Buffer.from(
        `<html><head><title>Doc</title><meta name="description" content="About"></head>` +
          `<body><h1>Title</h1><p>Body text</p>` +
          `<ul><li>one</li><li>two</li></ul>` +
          `<table><tr><th>h</th></tr><tr><td>c</td></tr></table>` +
          `<a href="https://example.com">Example</a>` +
          `<script>alert(1)</script></body></html>`
      )

      const result = await parser.parseBuffer(buffer)

      expect(result.metadata?.title).toBe('Doc')
      expect(result.metadata?.metaDescription).toBe('About')
      expect(result.content).toContain('Title')
      expect(result.content).toContain('Body text')
      expect(result.content).toContain('• one')
      expect(result.content).toContain('| h |')
      expect(result.content).toContain('Example (https://example.com)')
      expect(result.content).not.toContain('alert(1)')
      expect(result.metadata?.headings).toEqual([{ level: 1, text: 'Title' }])
      expect(result.metadata?.links).toEqual([{ text: 'Example', href: 'https://example.com' }])
      expect(result.metadata?.listCount).toBe(1)
      expect(result.metadata?.tableCount).toBe(1)
    })
  })
})
