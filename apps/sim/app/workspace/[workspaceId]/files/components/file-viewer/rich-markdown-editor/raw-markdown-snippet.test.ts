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

describe('raw HTML block: does not fragment across blank lines', () => {
  it('a <details><summary> block with a blank-line-separated body is ONE node, not three', () => {
    const input =
      '<details>\n<summary>Click to expand</summary>\n\nThis is inside a details/summary block.\n\n</details>'
    expect(topLevelTypes(input)).toEqual(['rawHtmlBlock'])
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('a <div> with multiple blank-line-separated paragraphs inside is ONE node', () => {
    const input = '<div>\n\nfirst paragraph\n\nsecond paragraph\n\n</div>'
    expect(topLevelTypes(input)).toEqual(['rawHtmlBlock'])
    expect(roundTrip(input)).toBe(input)
  })

  it('nested same-tag block HTML balances depth across blank lines', () => {
    const input = '<div>\nouter\n\n<div>\n\ninner\n\n</div>\n\nstill outer\n</div>'
    expect(topLevelTypes(input)).toEqual(['rawHtmlBlock'])
    expect(roundTrip(input)).toBe(input)
    expect(roundTrip(roundTrip(input))).toBe(roundTrip(input))
  })

  it('a paragraph starting with a non-block-list inline tag is NOT captured as a raw block', () => {
    // `em`/`a` aren't in the CommonMark block-HTML tag whitelist — they can legitimately start an
    // ordinary paragraph, and must keep parsing as real marks, not freeze as raw source.
    expect(topLevelTypes('<em>hi</em> there, this is a normal paragraph')).toEqual(['paragraph'])
    expect(roundTrip('<em>hi</em> there')).toBe('*hi* there')
  })

  it('a stray inline-only tag alone on its own line is left to the stock (non-whitelisted) path', () => {
    // `<span>` isn't in the block whitelist, so the new block tokenizer must not claim it — it falls
    // through to marked's own (stricter) block-HTML detection, unaffected by this change.
    const input = '<span>\n\nnot a block-html tag\n\n</span>'
    expect(() => roundTrip(input)).not.toThrow()
  })

  it('an unterminated block tag falls back gracefully (no crash, no infinite loop)', () => {
    const input = '<details>\n<summary>never closed</summary>\n\nbody'
    expect(() => roundTrip(input)).not.toThrow()
  })

  it('a block comment spanning blank lines still round-trips via the new shared tokenizer path', () => {
    const input = '<!--\n\nmulti-line comment\n\n-->\n\ntext after'
    expect(topLevelTypes(input)[0]).toBe('rawHtmlBlock')
    expect(roundTrip(input)).toBe(input)
  })

  it('a table and code block adjacent to a fragmenting-prone details block still coexist correctly', () => {
    const input =
      '<details>\n<summary>s</summary>\n\nbody\n\n</details>\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n```js\nconst x = 1\n```'
    expect(roundTrip(input)).toBe(input)
  })

  it('preserves an indented (up to 3 spaces) block-HTML opening line', () => {
    // `roundTrip`'s `.trim()` would strip the very leading indent this test verifies, so check the
    // parsed node's own text (and the untrimmed serialization) instead of the trimmed helper.
    for (const indent of [' ', '  ', '   ']) {
      const input = `${indent}<details>\n<summary>x</summary>\n\nbody\n\n</details>`
      const doc = parseMarkdownToDoc(input)
      expect(doc.content?.map((n) => n.type)).toEqual(['rawHtmlBlock'])
      expect(doc.content?.[0].content?.[0].text).toBe(input)
      expect(serializeMarkdownDocument(input)).toBe(`${input}\n`)
    }
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

  it('does not mistake a tag name mentioned inside a fenced code block for a real closing tag', () => {
    const input = '<div>\n\nExample:\n\n```html\n<div>example</div>\n```\n\nmore body\n\n</div>'
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

  it('does not mistake a tag name mentioned inside a blockquoted fenced code block for a real closing tag', () => {
    const input =
      '<div>\n\n> Example:\n>\n> ```html\n> <div>example</div>\n> ```\n\nmore body\n\n</div>'
    expect(topLevelTypes(input)).toEqual(['rawHtmlBlock'])
    expect(roundTrip(input)).toBe(input)
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
