/**
 * @vitest-environment node
 */
import { rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { HtmlComplexityError, HtmlParser } from '@/lib/file-parsers/html-parser'

const parser = new HtmlParser()

describe('table cells with several paragraphs', () => {
  it('separates block children inside a cell with a space', async () => {
    const html = '<table><tr><td><p>Заказчик</p><p>Исполняющий</p></td><td>ok</td></tr></table>'
    const result = await new HtmlParser().parseBuffer(Buffer.from(html))

    expect(result.content).toContain('| Заказчик Исполняющий | ok |')
  })
})

describe('HtmlParser', () => {
  it('reports empty input with the typed parser taxonomy', async () => {
    await expect(parser.parseBuffer(Buffer.alloc(0))).rejects.toMatchObject({
      code: 'empty_input',
    })
  })

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

    /**
     * A 30,000-row by 8-column export is ~540k tokens in 3.6 MB, an ordinary
     * document that an earlier, tighter token cap rejected.
     */
    it('accepts a realistic large table export', async () => {
      const row = `<tr>${'<td>value</td>'.repeat(8)}</tr>`
      const buffer = Buffer.from(`<html><body><table>${row.repeat(30_000)}</table></body></html>`)

      const result = await parser.parseBuffer(buffer)

      expect(result.content).toContain('| value |')
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

    it('numbers ordered lists and keeps markers on nested items', async () => {
      const buffer = Buffer.from(
        `<body><ol start="3"><li>third</li><li>fourth<ul><li>nested</li></ul></li></ol></body>`
      )

      const result = await parser.parseBuffer(buffer)

      expect(result.content).toContain('3. third')
      expect(result.content).toContain('4. fourth')
      expect(result.content).toContain('  • nested')
      expect(result.content).not.toContain('fourth nested')
    })

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

    it('separates block elements inside a list item', async () => {
      const buffer = Buffer.from(
        `<body><ul><li><div><p>Versions</p><p>Release Information</p></div></li></ul></body>`
      )

      const result = await parser.parseBuffer(buffer)

      expect(result.content).toContain('• Versions Release Information')
    })

    it('drops endnote return links but keeps the endnote text', async () => {
      const buffer = Buffer.from(
        `<body><p>Body<sup><a href="#endnote-1" id="endnote-ref-1">[1]</a></sup></p>` +
          `<ol><li id="endnote-1"><p>End text <a href="#endnote-ref-1">↑</a></p></li></ol></body>`
      )

      const result = await parser.parseBuffer(buffer)

      expect(result.content).toContain('1. End text')
      expect(result.content).not.toContain('↑')
    })

    it('drops footnote return links but keeps the footnote text', async () => {
      const buffer = Buffer.from(
        `<body><p>Body<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup></p>` +
          `<ol><li id="footnote-1"><p>Note text <a href="#footnote-ref-1">↑</a></p></li></ol></body>`
      )

      const result = await parser.parseBuffer(buffer)

      expect(result.content).toContain('Body[1]')
      expect(result.content).toContain('1. Note text')
      expect(result.content).not.toContain('↑')
    })
  })
})
