/**
 * @vitest-environment jsdom
 *
 * Parse → serialize round-trip fixtures for the verbatim snippet nodes: raw HTML blocks, HTML
 * comments, footnotes (def + ref), and inline raw HTML. Each must reproduce its input byte-for-byte
 * and reach a fixpoint on a second pass (see `serializeMarkdownDocument` in `./markdown-parse.ts`).
 */
import { describe, expect, it } from 'vitest'
import { parseMarkdownToDoc, serializeMarkdownDocument } from './markdown-parse'

function roundTrip(input: string): string {
  return serializeMarkdownDocument(input).trim()
}

/** Top-level node type names of the parsed doc, for structural (not just string) assertions. */
function topLevelTypes(input: string): (string | undefined)[] {
  return (parseMarkdownToDoc(input).content ?? []).map((n) => n.type)
}

describe('raw markdown snippet nodes', () => {
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
})

describe('raw HTML block: does not fragment across blank lines', () => {
  it('a <details><summary> block with a blank-line-separated body is ONE node, not three', () => {
    const input =
      '<details>\n<summary>Click to expand</summary>\n\nThis is inside a details/summary block.\n\n</details>'
    expect(topLevelTypes(input)).toEqual(['rawHtmlBlock'])
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('nested same-tag block HTML balances depth across blank lines', () => {
    const input = '<div>\nouter\n\n<div>\n\ninner\n\n</div>\n\nstill outer\n</div>'
    expect(topLevelTypes(input)).toEqual(['rawHtmlBlock'])
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('an unterminated block tag falls back gracefully (no crash, no infinite loop)', () => {
    const input = '<details>\n<summary>never closed</summary>\n\nbody'
    expect(() => roundTrip(input)).not.toThrow()
  })

  it('preserves a quoted attribute value containing a literal >', () => {
    const input = '<div data-example="a > b">\n\ncontent\n\n</div>'
    expect(topLevelTypes(input)).toEqual(['rawHtmlBlock'])
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('a quoted attribute containing a nested same-tag mention does not confuse the balance scan', () => {
    // Without attribute-aware matching, `<div>` inside the quoted value below would be miscounted as
    // a real nested open tag, throwing off the depth count entirely.
    const input = '<div title="a <div> b">\n\ncontent\n\n</div>'
    expect(topLevelTypes(input)).toEqual(['rawHtmlBlock'])
    expect(roundTrip(input)).toBe(input)
  })

  it('does not mistake a tag name mentioned inside an inline code span for a real closing tag', () => {
    const input = '<details>\n<summary>x</summary>\n\nSee `</details>` in the docs.\n\n</details>'
    expect(topLevelTypes(input)).toEqual(['rawHtmlBlock'])
    expect(roundTrip(input)).toBe(input)
  })

  it('a bare (unescaped, un-fenced) tag-name mention never crashes and always converges to a stable save', () => {
    // Known, inherent limitation of regex-based (non-DOM) tag matching, shared by any HTML-block
    // scanner (and by real HTML parsers given the same ambiguous input) — a bare mention outside
    // code can still be misread as the real closer. The bar this file holds itself to is: never
    // crash, never lose text, and always settle to a fixpoint after one save (isRoundTripSafe's own
    // documented tolerance for single-pass normalization) — not a perfect, DOM-aware parse.
    const input =
      '<details>\n<summary>x</summary>\n\nSee the literal text </details> in docs.\n\nmore body\n\n</details>'
    expect(() => roundTrip(input)).not.toThrow()
    const once = roundTrip(input)
    const twice = roundTrip(once)
    expect(once).toBe(twice)
    // No word from the original is dropped, even though the structure/whitespace may be reflowed.
    for (const word of ['See', 'the', 'literal', 'text', 'in', 'docs', 'more', 'body']) {
      expect(once).toContain(word)
    }
  })

  it('treats a void block tag (no closing tag exists) as complete right after the open tag', () => {
    // `link`/`meta`/`base`/`hr` are in the CommonMark block-HTML whitelist but are void elements —
    // scanning for a `</meta>` that will never legitimately appear would risk grabbing unrelated
    // later content (or a stray same-name mention) into the block.
    for (const input of [
      '<link rel="stylesheet" href="x.css">\n\nafter',
      '<meta charset="utf-8">\n\nafter',
      '<hr>\n\nafter',
    ]) {
      const doc = parseMarkdownToDoc(input)
      expect(doc.content?.[0].type).toBe('rawHtmlBlock')
      expect(roundTrip(input)).toContain('after')
    }
  })

  it('a void block tag does not swallow a later, unrelated mention of its own tag name', () => {
    const input = '<meta charset="utf-8">\n\nSee the `<meta>` tag in docs.\n\nmore body'
    const doc = parseMarkdownToDoc(input)
    // The <meta> is its own complete block; the later mention (in code) stays in a separate paragraph.
    expect(doc.content?.[0].type).toBe('rawHtmlBlock')
    expect(doc.content?.[0].content?.[0].text).toBe('<meta charset="utf-8">')
    expect(roundTrip(input)).toContain('more body')
  })
})
