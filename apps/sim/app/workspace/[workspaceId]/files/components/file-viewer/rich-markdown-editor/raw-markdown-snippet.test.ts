/**
 * @vitest-environment jsdom
 *
 * Parse → serialize round-trip fixtures for the verbatim snippet nodes: raw HTML blocks, HTML
 * comments, footnotes (def + ref), and inline raw HTML. Each must reproduce its input byte-for-byte
 * and reach a fixpoint on a second pass (see `serializeMarkdownDocument` in `./markdown-parse.ts`).
 */
import { describe, expect, it } from 'vitest'
import { serializeMarkdownDocument } from './markdown-parse'

function roundTrip(input: string): string {
  return serializeMarkdownDocument(input).trim()
}

describe('raw markdown snippet nodes', () => {
  it('preserves a standalone HTML comment', () => {
    const input = '<!-- a note -->\n\ntext'
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('preserves a multi-line raw HTML block spanning blank lines', () => {
    const input = '<details><summary>More</summary>\n\nbody\n\n</details>'
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('preserves a raw HTML block with attributes', () => {
    const input = '<div align="center">\n\ncentered\n\n</div>'
    expect(roundTrip(input)).toBe(input)
  })

  it('preserves a footnote reference and definition', () => {
    const input = 'a claim[^1]\n\n[^1]: the source'
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('preserves an inline raw HTML tag the schema has no mark/node for', () => {
    for (const input of ['a <sub>b</sub> c', 'press <kbd>Ctrl</kbd> now', 'a <mark>hit</mark> b']) {
      expect(roundTrip(input)).toBe(input)
    }
  })

  it('leaves recognized inline tags to their real mark (not captured as raw)', () => {
    expect(roundTrip('a <em>b</em> c')).toBe('a *b* c')
    expect(roundTrip('a <strong>b</strong> c')).toBe('a **b** c')
  })

  it('leaves a lone <img>/<br> block tag to the stock image/hard-break handling', () => {
    expect(roundTrip('<img src="/x.png" alt="a">')).toContain('![a](/x.png)')
  })

  it('preserves a raw HTML block inside a blockquote', () => {
    const input = '> <div>\n>\n> quoted\n>\n> </div>'
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('preserves a footnote reference inside a list item', () => {
    const input = '- a claim[^1]\n- another line\n\n[^1]: the source'
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('does not interfere with an adjacent table or code block', () => {
    const input =
      '<!-- note -->\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n```js\nconst x = 1\n```'
    expect(roundTrip(input)).toBe(input)
  })

  it('preserves a footnote definition with an indented continuation line', () => {
    const input = 'a claim[^1]\n\n[^1]: the source\n    continued here'
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('preserves a footnote definition with a blank line between continuation paragraphs', () => {
    const input = 'a claim[^1]\n\n[^1]: first paragraph\n\n    second paragraph'
    expect(roundTrip(input)).toBe(input)
  })

  it('does not swallow the next block into a footnote definition without continuation', () => {
    const input = 'a claim[^1]\n\n[^1]: the source\n\nafter'
    const out = roundTrip(input)
    expect(out).toContain('[^1]: the source')
    expect(out).toContain('after')
  })

  it('preserves nested same-tag inline HTML (balanced close, not first-match)', () => {
    const input = 'a <span>outer <span>inner</span></span> b'
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('preserves a self-closing same-name tag nested inside an inline HTML element', () => {
    const input = 'a <span>before<span/>after</span> b'
    expect(roundTrip(input)).toBe(input)
  })
})
