/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'
import { parseMarkdownToDoc, serializeMarkdownBody, splitMarkdownBlocks } from './markdown-parse'
import { isRoundTripSafe } from './round-trip-safety'

/** Mirror of the production `isEmptyParagraph` (not exported): the shape a blank line reconstructs to. */
const isEmptyPara = (n: { type?: string; content?: unknown[] }): boolean =>
  n.type === 'paragraph' && !n.content?.length

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** The current whole-document path: parse markdown in one shot, serialize back. */
function oneShot(body: string): string {
  editor = new Editor({ extensions: createMarkdownContentExtensions() })
  editor.commands.setContent(body, { contentType: 'markdown' })
  const out = editor.getMarkdown()
  editor.destroy()
  editor = null
  return out
}

/**
 * Chunked parsing must be byte-identical to the one-shot path — these are the structures a naive
 * blank-line split would shatter (loose lists span blank lines, list items hold multiple paragraphs,
 * blockquotes and fenced code contain blank lines), so they're the real fidelity test.
 */
const CASES: Array<[string, string]> = [
  [
    'heading + inline marks',
    '# Heading\n\nA paragraph with **bold**, *italic*, `code`, and a [link](https://x.com).',
  ],
  ['tight list', '- tight a\n- tight b\n- tight c'],
  ['loose list (blank lines between items)', '- loose a\n\n- loose b\n\n- loose c'],
  ['multi-paragraph list item', '1. first\n\n   second paragraph in item one\n\n2. second item'],
  ['nested list', '- outer\n  - nested one\n  - nested two\n    - deeper\n- outer two'],
  [
    'nested blockquote with blank lines',
    '> a blockquote\n>\n> with two paragraphs\n>\n> > and a nested quote',
  ],
  ['gfm table', '| col a | col b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'],
  [
    'fenced code with internal blank line',
    '```ts\nconst x = 1\n\nfunction f() {\n  return x\n}\n```',
  ],
  ['task list', '- [ ] task one\n- [x] task two done\n  - [ ] subtask'],
  ['thematic break between paragraphs', 'Para before.\n\n---\n\nPara after a divider.'],
  [
    'image + linked-image badge',
    '![alt](https://img.example/a.png)\n\n[![badge](https://img.shields.io/x.svg)](https://link.example)',
  ],
  // The editor serializes nested lists with sub-3-space indentation, which a strict external lexer
  // would mis-nest — this is the exact case that must survive re-parsing (idempotency).
  [
    'reduced-indent nested list (editor output shape)',
    '1. First\n  - sub bullet\n  - another\n  1. deep ordered\n  2. item\n2. Second',
  ],
  ['heading-separated sections', '# A\n\nalpha\n\n## B\n\nbeta\n\n## C\n\ngamma'],
]

describe('parseMarkdownToDoc (chunked)', () => {
  it('produces a doc node', () => {
    const doc = parseMarkdownToDoc('# Hi\n\nbody')
    expect(doc.type).toBe('doc')
    expect(Array.isArray(doc.content)).toBe(true)
  })

  it.each(CASES)('chunked parse round-trips identically to one-shot: %s', (_label, body) => {
    expect(serializeMarkdownBody(body)).toBe(oneShot(body))
  })

  // The editor re-parses its own output on every settle/repeat-stream, so a second pass must not
  // drift — otherwise editing + saving + reopening would slowly corrupt structure (this is the bug
  // that an external lexer introduced for sub-3-space nested lists).
  it.each(CASES)('is idempotent (a second pass changes nothing): %s', (_label, body) => {
    const once = serializeMarkdownBody(body)
    expect(serializeMarkdownBody(once)).toBe(once)
  })

  it('empty and whitespace-only input produce an empty doc', () => {
    expect(parseMarkdownToDoc('').type).toBe('doc')
    expect(parseMarkdownToDoc('   \n\n  ').type).toBe('doc')
    expect(splitMarkdownBlocks('')).toEqual([])
    expect(splitMarkdownBlocks('\n\n  \n')).toEqual([])
  })

  // Asserts the collapse documented on `stripEmptyParagraphs` — at document edges, between blocks, for
  // one or many blank lines, and around lists. (Blank runs are insignificant in markdown, so a collapsed
  // file renders identically everywhere it's viewed; the pathological case is a run of thousands.)
  describe('collapses blank-line runs to markdown-standard spacing', () => {
    /** Block-type shape of a doc after `parseMarkdownToDoc`, `∅` for any surviving empty paragraph. */
    function shapeOf(md: string): string {
      return (parseMarkdownToDoc(md).content ?? [])
        .map((n) => (isEmptyPara(n) ? '∅' : n.type))
        .join(',')
    }

    it.each([
      ['one blank gap between paragraphs', 'a\n\n\n\nb', 'paragraph,paragraph'],
      ['many blank lines between paragraphs', 'a\n\n\n\n\n\n\n\nb', 'paragraph,paragraph'],
      ['leading blank lines', '\n\n\n\na', 'paragraph'],
      ['leading + interior', '\n\n\na\n\n\n\nb', 'paragraph,paragraph'],
      ['blank gap between a heading and text', '# H\n\n\n\ntext', 'heading,paragraph'],
      ['blank gap after a tight list', '- a\n- b\n\n\n\ntext', 'bulletList,paragraph'],
      ['blank gap before a tight list', 'text\n\n\n\n- a\n- b', 'paragraph,bulletList'],
      // Line-ending variants normalize first, so `\r`-only / CRLF blank runs collapse identically.
      ['CRLF between blocks', 'a\r\n\r\n\r\n\r\nb', 'paragraph,paragraph'],
      ['CR-only (classic Mac) between blocks', 'a\r\r\r\rb', 'paragraph,paragraph'],
    ])('collapses to no empty paragraphs: %s', (_label, md, expected) => {
      expect(shapeOf(md)).toBe(expected)
    })

    it('a pathological blank run does not explode into empty paragraph nodes', () => {
      // The production incident: an agent/paste artifact with a huge blank run became ~1959 empty
      // paragraphs baked into the doc. Collapsing on parse neutralizes any such source.
      const body = `Para A${'\n'.repeat(4000)}Para B`
      const content = parseMarkdownToDoc(body).content ?? []
      expect(content.filter(isEmptyPara).length).toBe(0)
      expect(content.map((n) => n.type)).toEqual(['paragraph', 'paragraph'])
    })
  })

  // Regression: a file with blank lines (leading, interior, or trailing) must stay EDITABLE. Collapsing
  // blank runs keeps serialize→parse idempotent, so the round-trip-safety probe reaches a fixed point
  // instead of flipping the file read-only.
  describe('blank lines stay editable (regression)', () => {
    it.each([
      ['plain paragraph', 'abc\n\n'],
      ['heading + text', '# Title\n\nSome text\n\n'],
      ['three trailing newlines', 'hello\n\n\n'],
      ['two paragraphs', 'para one\n\npara two\n\n'],
      ['interior blank run + trailing', 'a\n\n\n\nb\n\n'],
    ])('a file with blank lines is round-trip-safe: %s', (_label, md) => {
      expect(isRoundTripSafe(md)).toBe(true)
    })

    it('removes only structurally-empty paragraphs — a paragraph with content survives', () => {
      // The shape suite above already proves leading/interior/trailing blank runs collapse to zero empty
      // paragraphs; this pins the complementary guarantee — a real (non-empty) paragraph is never dropped.
      const trailing = parseMarkdownToDoc('abc\n\n').content ?? []
      expect(trailing.at(-1)?.type).toBe('paragraph')
      expect(isEmptyPara(trailing.at(-1) ?? {})).toBe(false)
    })
  })

  it('parses reference-style links whole (non-chunkable) without dropping the definition', () => {
    const body = 'See [the docs][ref] for details.\n\n[ref]: https://example.com/docs'
    expect(serializeMarkdownBody(body)).toBe(oneShot(body))
  })

  // Block-level HTML can wrap blank lines; it routes to the whole-document fallback so chunked output
  // still matches one-shot exactly. (Such docs open read-only via the round-trip-safety probe, so
  // they're never re-serialized — the editor itself isn't idempotent on raw HTML.)
  it.each([
    ['html block', '<div class="x">\n\ncontent\n\n</div>'],
    ['html comment', 'before\n\n<!-- a note -->\n\nafter'],
    ['html table', '<table>\n\n<tr><td>a</td></tr>\n\n</table>'],
  ])(
    'block HTML renders via the whole-document fallback, matching one-shot: %s',
    (_label, body) => {
      expect(serializeMarkdownBody(body)).toBe(oneShot(body))
    }
  )

  describe('splitMarkdownBlocks keeps ambiguous structures atomic', () => {
    it('a loose list (blank lines between items) stays one block', () => {
      expect(splitMarkdownBlocks('- a\n\n- b\n\n- c')).toEqual(['- a\n\n- b\n\n- c'])
    })
    it('a nested list (no blank lines) stays one block', () => {
      expect(splitMarkdownBlocks('1. First\n  - sub\n  - two\n2. Second')).toHaveLength(1)
    })
    it('independent paragraphs split into separate blocks', () => {
      expect(splitMarkdownBlocks('para one\n\npara two\n\npara three')).toHaveLength(3)
    })
    it('headings and paragraphs split; fenced code with blank lines stays one block', () => {
      expect(splitMarkdownBlocks('# H\n\ntext\n\n```\na\n\nb\n```')).toEqual([
        '# H',
        'text',
        '```\na\n\nb\n```',
      ])
    })
    it('a multi-paragraph list item (indented continuation) stays one block', () => {
      expect(splitMarkdownBlocks('1. first\n\n   second para\n\n2. next')).toHaveLength(1)
    })
    it('CRLF line endings still split (a closing fence ending in \\r must close)', () => {
      // A Windows-authored file with fenced code must not collapse to one block (which would defeat
      // the chunker); the closer ending in `\r` has to match. Assert block COUNT, not just fidelity.
      const crlf = '```ts\r\nx\r\n```\r\n\r\npara1\r\n\r\npara2\r\n\r\npara3'
      expect(splitMarkdownBlocks(crlf)).toEqual(['```ts\nx\n```', 'para1', 'para2', 'para3'])
    })
  })

  it('matches one-shot on a large mixed document (the case the chunker exists for)', () => {
    const blocks: string[] = ['# Big Doc']
    for (let i = 0; i < 300; i++) {
      blocks.push(
        `## Section ${i}\n\nProse with **bold** and a [link](https://x.com/${i}) and \`code\`.`
      )
      if (i % 10 === 0) blocks.push(`\`\`\`ts\nconst x = ${i}\n\`\`\``)
      if (i % 9 === 0) blocks.push('- item a\n\n- item b\n\n- item c')
      if (i % 7 === 0) blocks.push('| a | b |\n| --- | --- |\n| 1 | 2 |')
    }
    const body = blocks.join('\n\n')
    expect(serializeMarkdownBody(body)).toBe(oneShot(body))
  })
})

/** Deterministic PRNG (mulberry32) so a failure is always reproducible from its seed. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FUZZ_BLOCKS: Array<(r: () => number) => string> = [
  () => '# Heading one',
  () => '### Heading three',
  (r) =>
    `A paragraph with **bold**, *italic*, \`code\`, and a [link](https://x.com/${Math.floor(r() * 99)}).`,
  () => '- tight a\n- tight b\n- tight c',
  () => '- loose a\n\n- loose b\n\n- loose c',
  () => '1. ordered one\n2. ordered two\n3. ordered three',
  () => '1. First\n   - sub bullet\n   - another\n     1. deep ordered\n     2. item\n2. Second',
  () => '1. item\n\n   a second paragraph inside the item\n\n2. next item',
  () => '> a blockquote\n> spanning lines\n>\n> > and a nested one',
  () => '| col a | col b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |',
  () => '```ts\nconst x = 1\n\nfunction f() {\n  return x\n}\n```',
  () => '- [ ] todo one\n- [x] done two\n  - [ ] subtask',
  () => '---',
  () => '![alt](https://img.example/a.png)',
  () => '[![badge](https://img.shields.io/x.svg)](https://link.example)',
  () => 'Text with ~~strikethrough~~ and a soft  \nline break inside it.',
  // Raw HTML / reference defs route to the whole-document fallback, so fidelity must still hold even
  // though the doc itself opens read-only (idempotency is only asserted for editable docs).
  () => '<div class="note">\n\nwrapped content\n\n</div>',
  () => 'See [the docs][ref].\n\n[ref]: https://example.com/docs',
]

function buildFuzzDoc(seed: number): string {
  const r = rng(seed)
  const count = 2 + Math.floor(r() * 8)
  const parts: string[] = []
  for (let i = 0; i < count; i++) parts.push(FUZZ_BLOCKS[Math.floor(r() * FUZZ_BLOCKS.length)](r))
  return parts.join('\n\n')
}

describe('chunked parse — property test over randomized documents', () => {
  it('chunked === one-shot for every document, and idempotent for every editable one', () => {
    const failures: Array<{ seed: number; kind: string }> = []
    // Compare modulo trailing whitespace: `parseMarkdownToDoc` strips trailing empty paragraphs (they
    // can't be serialized stably — postProcess collapses trailing newlines — so keeping them would flip
    // the file read-only), whereas the raw one-shot parse keeps them. That trailing-only divergence is
    // intended and invisible after save; interior/leading fidelity is still compared exactly.
    const trimEnd = (md: string) => md.replace(/\n+$/, '')
    for (let seed = 1; seed <= 400; seed++) {
      const body = buildFuzzDoc(seed)
      const chunked = serializeMarkdownBody(body)
      // Fidelity is the load-bearing invariant — chunked must never diverge from the whole-document
      // parse, for ANY input; idempotency only needs to hold where the doc is editable (raw HTML is
      // non-idempotent in the underlying editor regardless of chunking, which is why it opens read-only).
      if (trimEnd(chunked) !== trimEnd(oneShot(body))) failures.push({ seed, kind: 'fidelity' })
      else if (isRoundTripSafe(body) && serializeMarkdownBody(chunked) !== chunked) {
        failures.push({ seed, kind: 'idempotency' })
      }
    }
    expect(failures).toEqual([])
    // 400 docs each parsed+serialized twice — generous timeout so it can't flake under parallel load.
  }, 30000)
})
