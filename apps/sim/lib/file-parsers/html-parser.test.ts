import { rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { HtmlComplexityError, HtmlParser } from '@/lib/file-parsers/html-parser'

const parser = new HtmlParser()

describe('HtmlParser', () => {
  describe('resource limits', () => {
    /**
     * Pinned by value: a 64 MB body aborts the process, so raising the cap
     * toward the shared upload limit must fail here, not in production.
     */
    it('rejects a document above the input byte cap', async () => {
      const oversized = Buffer.alloc(32 * 1024 * 1024 + 1)

      const error = await parser.parseBuffer(oversized).catch((e) => e)

      expect(error).toBeInstanceOf(HtmlComplexityError)
      expect(error.message).toMatch(/above the maximum of 33554432 bytes/)
    })

    it('rejects a tag-dense document above the markup-token cap', async () => {
      const dense = Buffer.from(`<html><body>${'<p>a</p>'.repeat(600_000)}</body></html>`)

      const error = await parser.parseBuffer(dense).catch((e) => e)

      expect(error).toBeInstanceOf(HtmlComplexityError)
      expect(error.message).toMatch(/exceeds the maximum of 1000000 markup tokens/)
    })

    it('accepts a byte-heavy document whose markup stays under the token cap', async () => {
      const paragraph = `<p>${'word '.repeat(200)}</p>`
      const buffer = Buffer.from(`<html><body>${paragraph.repeat(2000)}</body></html>`)

      const result = await parser.parseBuffer(buffer)

      expect(result.content).toContain('word')
    })

    /**
     * `parseFile` must not wrap the rejection in a generic error, or the route
     * stops recognising it and falls back to storing the document as raw text.
     */
    it('preserves the error type through parseFile so callers still fail closed', async () => {
      const dense = `<html><body>${'<p>a</p>'.repeat(600_000)}</body></html>`
      const path = join(tmpdir(), `html-parser-limits-${process.pid}.html`)
      await writeFile(path, dense)

      try {
        await expect(parser.parseFile(path)).rejects.toBeInstanceOf(HtmlComplexityError)
      } finally {
        await rm(path, { force: true })
      }
    })

    /**
     * Deep nesting overflows the stack inside cheerio's own recursive `.text()`,
     * which the pre-parse caps cannot predict. It still has to be classified as
     * a resource rejection so callers fail closed.
     */
    it('classifies a deep-nesting stack overflow as a complexity rejection', async () => {
      const depth = 15_000
      const buffer = Buffer.from(
        `<html><body>${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}</body></html>`
      )

      await expect(parser.parseBuffer(buffer)).rejects.toThrow(HtmlComplexityError)
    })
  })

  describe('extraction', () => {
    it('renders a nested table inside its cell exactly once', async () => {
      const buffer = Buffer.from(
        `<body><table><tbody><tr><td>Outer A</td><td><p>Intro</p>` +
          `<table><tr><td>Inner 1</td><td>Inner 2</td></tr><tr><td>Inner 3</td></tr></table>` +
          `</td></tr><tr><th>Outer B</th><td>Plain</td></tr></tbody></table></body>`
      )

      const result = await parser.parseBuffer(buffer)

      expect(result.content).toContain('| Outer A | Intro Inner 1 / Inner 2 / Inner 3 |')
      expect(result.content).toContain('| Outer B | Plain |')
      for (const cell of ['Outer A', 'Inner 1', 'Inner 2', 'Inner 3', 'Outer B', 'Plain']) {
        expect(result.content.split(cell)).toHaveLength(2)
      }
      expect(result.content.match(/\[Table\]/g)).toHaveLength(1)
      expect(result.metadata?.tableCount).toBe(2)
    })

    it('keeps descriptive image alt text and drops file-name alt text', async () => {
      const buffer = Buffer.from(
        `<body><img alt="Org chart"><img alt="python-logo.gif"><img alt="Image 2"><p>Body</p></body>`
      )

      const result = await parser.parseBuffer(buffer)

      expect(result.content).toContain('[Image: Org chart]')
      expect(result.content).not.toContain('python-logo')
      expect(result.content).not.toContain('Image 2')
    })
  })
})
