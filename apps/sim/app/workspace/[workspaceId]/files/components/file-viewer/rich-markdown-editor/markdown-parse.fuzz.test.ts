/**
 * @vitest-environment jsdom
 *
 * Property test: for any document assembled from a palette of block constructs, the chunked parse
 * must round-trip byte-identically to the whole-document parse, and be idempotent. This fuzzes the
 * block splitter across thousands of randomized block combinations — the structures that a naive
 * splitter shatters (loose lists, nested lists, multi-paragraph items, blockquotes) appear adjacent
 * in every permutation — so a boundary bug surfaces here rather than on a user's file.
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'
import { serializeMarkdownBody } from './markdown-parse'
import { isRoundTripSafe } from './round-trip-safety'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function oneShot(body: string): string {
  editor = new Editor({ extensions: createMarkdownContentExtensions() })
  editor.commands.setContent(body, { contentType: 'markdown' })
  const out = editor.getMarkdown()
  editor.destroy()
  editor = null
  return out
}

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

const BLOCKS: Array<(r: () => number) => string> = [
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
  // Raw HTML / reference defs: these route to the whole-document fallback, so fidelity must still
  // hold even though the doc itself opens read-only (idempotency is only asserted for editable docs).
  () => '<div class="note">\n\nwrapped content\n\n</div>',
  () => 'See [the docs][ref].\n\n[ref]: https://example.com/docs',
]

function buildDoc(seed: number): string {
  const r = rng(seed)
  const count = 2 + Math.floor(r() * 8)
  const parts: string[] = []
  for (let i = 0; i < count; i++) parts.push(BLOCKS[Math.floor(r() * BLOCKS.length)](r))
  return parts.join('\n\n')
}

describe('markdown chunked-parse property test', () => {
  it('chunked === one-shot for every randomized document, and idempotent for every editable one', () => {
    const failures: Array<{ seed: number; kind: string }> = []
    for (let seed = 1; seed <= 400; seed++) {
      const body = buildDoc(seed)
      const chunked = serializeMarkdownBody(body)
      // Fidelity is the load-bearing invariant: the chunked parse must never diverge from the
      // whole-document parse, for ANY input. This is what guarantees no behavioral change.
      if (chunked !== oneShot(body)) failures.push({ seed, kind: 'fidelity' })
      // Idempotency (a re-parse changing nothing) only needs to hold where the doc is editable —
      // read-only docs are never re-serialized through the editor, and a few constructs (raw HTML)
      // are non-idempotent in the underlying editor regardless of chunking, which is exactly why
      // they open read-only.
      else if (isRoundTripSafe(body) && serializeMarkdownBody(chunked) !== chunked) {
        failures.push({ seed, kind: 'idempotency' })
      }
    }
    expect(failures).toEqual([])
  })
})
