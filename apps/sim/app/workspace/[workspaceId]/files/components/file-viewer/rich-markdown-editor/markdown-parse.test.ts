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

  /** Block-type shape of a doc after `parseMarkdownToDoc`, `∅` for each empty paragraph. */
  function shapeOf(md: string): string {
    return (parseMarkdownToDoc(md).content ?? [])
      .map((n) => (isEmptyPara(n) ? '∅' : n.type))
      .join(',')
  }

  // A blank line an author left between two blocks is part of the document, so parse must read back the
  // exact count the serializer wrote (`blocks.join('\n\n')` ⇒ an empty paragraph costs TWO blank lines,
  // the first separator is free). Getting this wrong is visible: the static placeholder is built from
  // markdown while the live collaborative doc is the CRDT, so any drift shows up as the doc reflowing
  // its spacing a beat after the file appears.
  describe('preserves authored blank lines', () => {
    it.each([
      ['single separator — no empty paragraph', 'a\n\nb', 'paragraph,paragraph'],
      ['odd blank line is insignificant', 'a\n\n\nb', 'paragraph,paragraph'],
      ['one authored blank line', 'a\n\n\n\nb', 'paragraph,∅,paragraph'],
      ['three authored blank lines', 'a\n\n\n\n\n\n\n\nb', 'paragraph,∅,∅,∅,paragraph'],
      ['leading blank lines', '\n\n\n\na', '∅,∅,paragraph'],
      ['leading + interior', '\n\n\na\n\n\n\nb', '∅,paragraph,∅,paragraph'],
      ['between a heading and text', '# H\n\n\n\ntext', 'heading,∅,paragraph'],
      ['after a tight list', '- a\n- b\n\n\n\ntext', 'bulletList,∅,paragraph'],
      ['before a tight list', 'text\n\n\n\n- a\n- b', 'paragraph,∅,bulletList'],
      // Line-ending variants normalize first, so `\r`-only / CRLF runs count identically.
      ['CRLF between blocks', 'a\r\n\r\n\r\n\r\nb', 'paragraph,∅,paragraph'],
      ['CR-only (classic Mac) between blocks', 'a\r\r\r\rb', 'paragraph,∅,paragraph'],
    ])('%s', (_label, md, expected) => {
      expect(shapeOf(md)).toBe(expected)
    })

    // A loose list's own internal blank lines are absorbed into its merged block, so they stay list
    // spacing rather than becoming top-level paragraphs that would split the list in two.
    it('a loose list keeps its internal blank lines as one list', () => {
      expect(shapeOf('- a\n\n- b\n\n- c')).toBe('bulletList')
    })

    // …but a gap WIDE enough to carry an empty paragraph is a top-level block boundary: the serializer
    // only writes one by emitting the two sides as separate blocks, so re-merging them made parse stop
    // inverting serialize. That swallowed the paragraph, fused the two blocks, and — because the file
    // then never reached a fixpoint — silently opened it READ-ONLY.
    it.each([
      ['between two bullet lists', '- a\n\n\n\n- b', 'bulletList,∅,bulletList'],
      ['between two blockquotes', '> a\n\n\n\n> b', 'blockquote,∅,blockquote'],
      ['before an indented continuation', 'a\n\n\n\n  indented', 'paragraph,∅,paragraph'],
    ])('a gap that carries a paragraph breaks the merge: %s', (_label, md, expected) => {
      expect(shapeOf(md)).toBe(expected)
    })

    it('a pathological blank run does not explode into empty paragraph nodes', () => {
      // The production incident: an agent/paste artifact with a huge blank run became ~1959 empty
      // paragraphs baked into the doc. The run is bounded on parse, so no source can reach that.
      const body = `Para A${'\n'.repeat(4000)}Para B`
      const content = parseMarkdownToDoc(body).content ?? []
      expect(content.filter(isEmptyPara).length).toBe(20)
      expect(content.length).toBe(22)
    })

    // The per-gap ceiling bounds one run; the realistic artifact shape is a moderate run between EVERY
    // paragraph, which scales with file size. Without a document budget an 86KB body produced ~40k empty
    // paragraphs — twenty times the incident the per-gap ceiling exists to prevent.
    it('many blank runs cannot explode the document either', () => {
      const body = `${'x'.padEnd(1)}${`${'\n'.repeat(42)}x`.repeat(2000)}`
      const content = parseMarkdownToDoc(body).content ?? []
      expect(content.filter(isEmptyPara).length).toBe(500)
    })

    // The bounds have to be fixpoints too, or a clamped file would churn on every save.
    it.each([
      ['one huge run', `Para A${'\n'.repeat(4000)}Para B`],
      ['many runs past the document budget', `x${`${'\n'.repeat(42)}x`.repeat(2000)}`],
    ])('a bounded document re-serializes to itself: %s', (_label, md) => {
      const once = serializeMarkdownBody(md)
      expect(serializeMarkdownBody(once)).toBe(once)
    })

    // The whole-document path hands blank runs to @tiptap/markdown, which keeps them after a paragraph
    // but swallows them after a heading/ordered list/table. Preserving only some would break the fixpoint
    // for the same document, so that path keeps none — consistently zero, which IS a fixpoint.
    it.each([
      ['block HTML', '# H\n\n\n\ntext\n\n<div>x</div>', 'heading,paragraph,rawHtmlBlock'],
      [
        'a reference definition',
        '# H\n\n\n\nsee [y][r]\n\n[r]: https://e.com',
        'heading,paragraph',
      ],
    ])('a document that must parse whole keeps no empty paragraphs: %s', (_label, md, expected) => {
      expect(shapeOf(md)).toBe(expected)
      const once = serializeMarkdownBody(md)
      expect(serializeMarkdownBody(once)).toBe(once)
    })
  })

  // Regression: a file with blank lines (leading, interior, or trailing) must stay EDITABLE — parse and
  // serialize have to agree on the blank count, or the round-trip-safety probe never reaches a fixed
  // point and the file silently opens read-only.
  describe('blank lines stay editable (regression)', () => {
    it.each([
      ['plain paragraph', 'abc\n\n'],
      ['heading + text', '# Title\n\nSome text\n\n'],
      ['three trailing newlines', 'hello\n\n\n'],
      ['two paragraphs', 'para one\n\npara two\n\n'],
      ['interior blank run + trailing', 'a\n\n\n\nb\n\n'],
      ['many interior blank runs', '# T\n\n\n\na\n\n\n\n\n\nb\n\n\n\n- x\n- y\n\n'],
      ['leading blank run', '\n\n\n\nabc\n'],
      // These regressed to read-only when a gap carrying a paragraph was still merged away: the merge
      // fused the two blocks, so the second pass produced different markdown from the first.
      ['gap before a list glued to a lead-in line', 'text\n1. one\n\n\n\n- bullet'],
      ['gap between two glued list kinds', 'text\n- bullet\n\n\n\n1. one'],
      ['gap between two blockquotes after a lead-in', 'text\n> a\n\n\n\n> b'],
      [
        'changelog shape',
        '## v2\n\nHighlights:\n1. faster\n2. smaller\n\n\n\n- also: fixed a crash\n',
      ],
    ])('a file with blank lines is round-trip-safe: %s', (_label, md) => {
      expect(isRoundTripSafe(md)).toBe(true)
    })

    // Trailing empties are the one kind that cannot round-trip: `postProcessSerializedMarkdown`
    // collapses trailing blank lines, so keeping them would make the doc differ from its own output.
    it('drops trailing empty paragraphs', () => {
      expect(shapeOf('abc\n\n')).toBe('paragraph')
      expect(shapeOf('abc\n\n\n\n\n\n')).toBe('paragraph')
      const trailing = parseMarkdownToDoc('abc\n\n').content ?? []
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

/**
 * `blankRuns` widens the separator from a single blank line to a run of up to three, so the corpus
 * exercises authored spacing. The single-separator corpus structurally could not: every document it
 * built was `parts.join('\n\n')`, which is exactly the one gap width that carries no empty paragraph —
 * so the whole blank-line design was invisible to the property test that claims to cover any input.
 */
function buildFuzzDoc(seed: number, blankRuns: boolean): string {
  const r = rng(seed)
  const count = 2 + Math.floor(r() * 8)
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    if (i > 0) parts.push('\n'.repeat(blankRuns ? 2 + Math.floor(r() * 4) : 2))
    parts.push(FUZZ_BLOCKS[Math.floor(r() * FUZZ_BLOCKS.length)](r))
  }
  return parts.join('')
}

describe('chunked parse — property test over randomized documents', () => {
  it('chunked === one-shot on single-separator documents, and idempotent for every editable one', () => {
    const failures: Array<{ seed: number; kind: string }> = []
    // Compare modulo trailing whitespace: `parseMarkdownToDoc` strips trailing empty paragraphs (they
    // can't be serialized stably — postProcess collapses trailing newlines — so keeping them would flip
    // the file read-only), whereas the raw one-shot parse keeps them. That trailing-only divergence is
    // intended and invisible after save; interior/leading fidelity is still compared exactly.
    const trimEnd = (md: string) => md.replace(/\n+$/, '')
    for (let seed = 1; seed <= 400; seed++) {
      const body = buildFuzzDoc(seed, false)
      const chunked = serializeMarkdownBody(body)
      // On documents with no authored blank run the two paths must still agree exactly. They are allowed
      // to differ once a gap carries an empty paragraph: the chunked path reconstructs it and the
      // whole-document path deliberately keeps none (see `parseMarkdownToDoc`), and only ONE path ever
      // runs for a given document. Idempotency is the invariant that must hold for both, and it is
      // asserted for every editable document in the blank-run corpus below.
      if (trimEnd(chunked) !== trimEnd(oneShot(body))) failures.push({ seed, kind: 'fidelity' })
      else if (isRoundTripSafe(body) && serializeMarkdownBody(chunked) !== chunked) {
        failures.push({ seed, kind: 'idempotency' })
      }
    }
    expect(failures).toEqual([])
    // 400 docs each parsed+serialized twice. Measured ~10s alone; the whole-suite run gives each worker
    // a fraction of a core, and at 30s BOTH property tests in this file timed out there while passing
    // standalone. Sized off the loaded number, not the isolated one.
  }, 60000)

  /**
   * Idempotency is what keeps a file editable: `isRoundTripSafe` opens a document read-only unless
   * serializing twice is byte-identical. Preserving blank lines put every gap width on that path, and a
   * merge rule that swallowed a gap silently flipped ordinary documents (a changelog, a lead-in line
   * followed by a list) to read-only. Fuzz the separator width so that class cannot come back.
   *
   * Gated on `isRoundTripSafe` for the same reason the single-separator test above is: a document the
   * probe rejects opens read-only and is never re-serialized, so its instability is contained by design.
   * This corpus does surface such documents — a blank run INSIDE a loose list parses to an empty
   * paragraph nested in a list item, which `getMarkdown` writes as an indented `'  '` marker line rather
   * than a blank one, and that does not round-trip. That defect predates blank-line preservation (it
   * reproduces identically with the empty-paragraph strip in place) and is only reachable through a gap
   * width the old corpus could not generate; the probe correctly holds those files read-only.
   */
  it('stays idempotent with authored blank runs of every width', () => {
    const failures: Array<{ seed: number; body: string }> = []
    for (let seed = 1; seed <= 400; seed++) {
      const body = buildFuzzDoc(seed, true)
      if (!isRoundTripSafe(body)) continue
      const once = serializeMarkdownBody(body)
      if (serializeMarkdownBody(once) !== once) failures.push({ seed, body })
    }
    expect(failures).toEqual([])
    // Same budget as the corpus above, for the same reason — this is the second ~10s property test in
    // the file, and adding it is what pushed both past 30s under whole-suite parallelism.
  }, 60000)
})
