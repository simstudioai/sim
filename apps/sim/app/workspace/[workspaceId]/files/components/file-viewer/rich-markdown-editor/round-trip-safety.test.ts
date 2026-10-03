/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  parseMarkdownToDoc,
  serializeMarkdownDocument,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { normalizeMarkdownContent } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/normalize-content'
import { isRoundTripSafe } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/round-trip-safety'

describe('isRoundTripSafe', () => {
  it.each([
    '<pre>[https://example.com](https://example.com)</pre>',
    '<!-- [https://example.com](https://example.com) -->',
    '<span>[https://example.com](https://example.com)</span>',
    '<details>\n> \\[!NOTE\\]\nparent\n  - \n</details>',
    '````\n```\n[https://example.com](https://example.com)\n```\n````',
  ])('preserves literal content on its first serialization: %s', (source) => {
    const once = serializeMarkdownDocument(source)
    expect(once.trimEnd()).toBe(source)
    expect(serializeMarkdownDocument(once)).toBe(once)
    expect(isRoundTripSafe(source)).toBe(true)
  })

  it.each([
    'See [label](/path "[unused]").',
    '`[unused]`',
    '<span>[unused]</span>',
    '<!-- [unused] -->',
    '    [unused]',
    '\\[unused]',
  ])('does not count literal reference labels as definition usage: %s', (body) => {
    expect(isRoundTripSafe(`${body}\n\n[unused]: https://example.com`)).toBe(false)
  })

  it.each([
    { field: 'alt', linked: false },
    { field: 'title', linked: false },
    { field: 'alt', linked: true },
    { field: 'title', linked: true },
  ])('keeps a resized image editable with quoted $field (linked: $linked)', ({ field, linked }) => {
    const attributes = {
      src: '/image.png',
      alt: 'Diagram',
      [field]: 'A "quoted" diagram',
      href: linked ? '/destination' : null,
    }
    const editor = new Editor({
      extensions: createMarkdownContentExtensions(),
      content: { type: 'doc', content: [{ type: 'image', attrs: attributes }] },
    })
    try {
      expect(isRoundTripSafe(editor.getMarkdown())).toBe(true)
      editor.commands.setNodeSelection(0)
      editor.commands.updateAttributes('image', { width: '320', height: null })
      const markdown = editor.getMarkdown()
      expect(markdown).toContain('&quot;')
      expect(isRoundTripSafe(markdown)).toBe(true)
      expect(parseMarkdownToDoc(markdown).content?.[0].attrs).toMatchObject({
        ...attributes,
        width: '320',
        height: null,
      })
    } finally {
      editor.destroy()
    }
  })

  it.each([
    '![literal <img src="/inner" alt="&quot;">](/outer)',
    "![outer](/outer \"literal <img src='/inner' alt='&quot;'>\")",
    "[text](/link \"literal <img src='/inner' alt='&quot;'>\")",
    '<img src="/inner" alt="`&quot;`" width="30">\n\n![x][id]\n\n[id]: /outer "&quot;"',
    '&quot;outside&quot;\n\n[<img src="/image" alt="&quot;inside&quot;" width="30">](/link)',
    '[<img src="/image" alt="&quot;&copy;&quot;" width="30">](/link)',
    '[<img src="/image" alt="&quot;inside&quot;" class="hero" width="30">](/link)',
  ])('does not exempt unsafe text or dropped attributes near image quotes: %s', (source) => {
    expect(isRoundTripSafe(source)).toBe(false)
  })

  it('does not let a preserved raw tag hide an identical image tag that loses attributes', () => {
    const tag = '<img src="/logo.svg" class="logo" width="200">'
    expect(isRoundTripSafe(`<div>\n${tag}\n</div>\n\n${tag}`)).toBe(false)
  })

  it.each([
    ['[![foo][image]](/dest)', '[image]: /url'],
    ['[![foo][]](/dest)', '[foo]: /url'],
    ['[![foo]](/dest)', '[foo]: /url'],
    ['[![foo](/url)][link]', '[link]: /dest'],
    ['[![foo][image]][link]', '[image]: /url\n[link]: /dest'],
    ['[![foo][image]][link]', '[image]: /url "Image"\n[link]: /dest "Link"'],
  ])('keeps %s in source mode when rich parsing loses its wrapping link', (body, definitions) => {
    for (const prefix of ['', '- ', '1. ']) {
      expect(isRoundTripSafe(`${prefix}${body}\n\n${definitions}`)).toBe(false)
    }
  })

  it.each([
    ['[foo][link]', '[link]: /dest'],
    ['[foo][]', '[foo]: /dest'],
    ['[foo]', '[foo]: /dest'],
    ['![foo][link]', '[link]: /image'],
  ])(
    'keeps task references in source mode regardless of definition order: %s',
    (body, definitions) => {
      const tasks = `- [x] ${body}\n  - [ ] ${body}`
      for (const source of [`${tasks}\n\n${definitions}`, `${definitions}\n\n${tasks}`]) {
        expect(isRoundTripSafe(source)).toBe(false)
        expect(normalizeMarkdownContent(source)).toBe(source)
      }
    }
  )

  it('does not let another link or image hide a lost wrapping link or duplicate table image', () => {
    expect(isRoundTripSafe('[other](/dest)\n\n1. [![foo][image]](/dest)\n\n[image]: /url')).toBe(
      false
    )
    expect(isRoundTripSafe('![kept](/image)\n\n| h |\n| --- |\n| <img src="/image"> |')).toBe(false)
  })

  it.each([
    '| Header |\n| --- |\n| Before ![Image](/image.png) after |',
    '| Before ![Image](/image.png) after |\n| --- |\n| Cell |',
    '| Header |\n| --- |\n| [![Image](/image.png)](/destination) |',
    '| Header |\n| --- |\n| ![Image][image] |\n\n[image]: /image.png',
    '| Header |\n| --- |\n| Before <img src="/image.png" width="320"> after |',
  ])('preserves unsupported table images in source mode: %s', (source) => {
    expect(isRoundTripSafe(source)).toBe(false)
    expect(normalizeMarkdownContent(source)).toBe(source)
  })

  it('preserves footnotes, HTML comments, and raw HTML tags via the verbatim snippet nodes', () => {
    expect(isRoundTripSafe('text[^1]\n\n[^1]: the note')).toBe(true)
    expect(isRoundTripSafe('<!-- a note -->\n\ntext')).toBe(true)
    expect(isRoundTripSafe('<details><summary>x</summary>body</details>')).toBe(true)
    expect(isRoundTripSafe('a <sub>b</sub> c')).toBe(true)
  })

  it('rejects a hard break inside a heading (serializer splits the heading)', () => {
    expect(isRoundTripSafe('# one  \ntwo')).toBe(false)
    expect(isRoundTripSafe('## title\\\nmore')).toBe(false)
  })

  it('rejects HTML entities other than the canonical three (escaped to literal source)', () => {
    expect(isRoundTripSafe('it&#39;s here')).toBe(false)
    expect(isRoundTripSafe('&copy; 2024')).toBe(false)
    expect(isRoundTripSafe('a&nbsp;b')).toBe(false)
    expect(isRoundTripSafe('a &amp; b &lt; c &gt; d')).toBe(true)
    expect(isRoundTripSafe('AT&T and R&D')).toBe(true)
    expect(isRoundTripSafe('a &AMP; b')).toBe(false)
    expect(isRoundTripSafe('a &LT; b &GT; c')).toBe(false)
  })

  it('rejects an orphan reference definition (serializer drops it) but allows used ones', () => {
    expect(isRoundTripSafe('Some text.\n\n[unused]: https://example.com "title"')).toBe(false)
    expect(isRoundTripSafe('[a]: u1\n[b]: u2\n\nuse only [a]')).toBe(false)
    expect(isRoundTripSafe('See [x][1].\n\n[1]: https://example.com "T"')).toBe(true)
    expect(isRoundTripSafe('A [shortcut] ref.\n\n[shortcut]: https://example.com')).toBe(true)
    expect(isRoundTripSafe('Case [Foo] insensitive.\n\n[foo]: https://example.com')).toBe(true)
    expect(isRoundTripSafe('A note.\n\n[^x]: the footnote body')).toBe(true)
    /** The installed lexer does not resolve the padded shortcut; its definition would be dropped. */
    expect(isRoundTripSafe('See [ foo ] here.\n\n[foo]: https://example.com')).toBe(false)
  })

  it('rejects non-idempotent churn', () => {
    expect(isRoundTripSafe('render `` a`b `` inline')).toBe(false)
  })

  it('keeps HTML images with unsupported attributes in source mode', () => {
    expect(isRoundTripSafe('<img src="/image" class="hero">')).toBe(false)
    expect(isRoundTripSafe('<img src="/image" height="20" data-x="y">')).toBe(false)
    expect(isRoundTripSafe('<img src="/image" style="width: 20px">')).toBe(false)
    expect(isRoundTripSafe('<img src="/image" alt="a" title="t" width="40" height="20">')).toBe(
      true
    )
  })

  it.each([
    '[<img src="a>b" class="hero">](/link)',
    '[<img src="/image" title="a>b" class="hero" width="30">](/link)',
    "[<img src='/image' title='a>b' data-credit='Alice' width='30'>](/link)",
  ])('checks attributes after quoted angle brackets without losing source: %s', (source) => {
    expect(isRoundTripSafe(source)).toBe(false)
    expect(normalizeMarkdownContent(source)).toBe(source)
  })

  it.each([
    '<img src="/image" alt="first" alt="second">',
    '[<img src="/image" alt="first" alt="second" width="30">](/link)',
    '[<img src="/image" alt="first" ALT="second" width="30">](/link)',
    '[<img src="/image" width="30" WIDTH="60">](/link)',
  ])('keeps duplicate image attributes in source mode: %s', (source) => {
    expect(isRoundTripSafe(source)).toBe(false)
    expect(normalizeMarkdownContent(source)).toBe(source)
  })

  it.each([
    '<img src="/image" width>',
    '<img src="/image" height>',
    '<img src="/image" width="">',
    "<img src='/image' height=''>",
    '<img WIDTH src="/image" height="20">',
    '[<img src="/image" width height>](/link)',
  ])('keeps valueless image dimensions in source mode: %s', (source) => {
    expect(isRoundTripSafe(source)).toBe(false)
    expect(normalizeMarkdownContent(source)).toBe(source)
  })

  it.each([
    '| <img src="/image.png"> |\n| --- |\n| body |',
    '| header |\n| --- |\n| <img src="/image.png"> |',
    '| header |\n| --- |\n| <IMG src="/image.png"> |',
    '| header |\n| --- |\n| [<img src="/image.png">](/dest) |',
    '| header |\n| --- |\n| <img title="a>b" src="/image.png"> |',
    "| header |\n| --- |\n| <img title='a>b' src=/image.png> |",
    '| header |\n| --- |\n| <img alt="example `code`" src=/image.png /> |',
    '| header |\n| --- |\n| <!-- <img src="/example.png"> --><img src="/image.png"> |',
  ])('refuses unsupported HTML images inside GFM tables: %s', (source) => {
    expect(isRoundTripSafe(source)).toBe(false)
  })

  it.each([
    '<!-- example: <img src="/image.png"> -->',
    '<!-- example: <IMG title="a>b" src=/image.png class="hero"> -->',
    '<span title="example <img>">text</span>',
  ])('preserves literal image markup in table comments and attributes: %s', (cell) => {
    for (const source of [`| ${cell} |\n| --- |\n| body |`, `| header |\n| --- |\n| ${cell} |`]) {
      const serialized = serializeMarkdownDocument(source)
      expect(serialized).toContain(cell)
      expect(serializeMarkdownDocument(serialized)).toBe(serialized)
      expect(isRoundTripSafe(source)).toBe(true)
    }
  })

  it('probes documents up to the size cap but falls back (read-only) above it', () => {
    // ~100KB of simple safe prose is under the 256KB cap → probed and editable.
    expect(isRoundTripSafe(`# Title\n\n${'word '.repeat(20000)}`)).toBe(true)
    // ~300KB is over the cap → opens read-only (too many DOM nodes to edit comfortably).
    expect(isRoundTripSafe(`# Title\n\n${'word '.repeat(60000)}`)).toBe(false)
  })
})

const README = `# Acme CLI

[![build](https://img.shields.io/badge/build-passing-green)](https://example.com)

Acme is a fast, friendly command-line tool.

## Installation

\`\`\`bash
npm install -g acme
acme --help
\`\`\`

## Usage

Run \`acme init\` to scaffold a project, then:

1. Edit \`acme.config.json\`
2. Run \`acme build\`
3. Ship it

> **Note:** requires Node 18+.

| Flag | Description | Default |
| --- | --- | --- |
| \`--watch\` | Rebuild on change | \`false\` |
| \`--out\` | Output directory | \`dist\` |

### Features

- Zero-config defaults
- Incremental builds
  - Caches by content hash
  - Skips unchanged files
- Plugin system

See the [docs](https://example.com/docs) for more.
`

const MEETING_NOTES = `# Weekly Sync — 2026-06-18

**Attendees:** Alice, Bob, Carol

## Agenda

1. Roadmap review
2. Incident retro
3. Open questions

## Notes

- Roadmap is *on track* for Q3.
- The **incident** on Monday was a config regression.
  1. Root cause: a stale cache key
  2. Fix: invalidate on deploy
- Carol will own the migration.

### Action items

- [x] Write the retro doc
- [ ] Schedule the migration window
- [ ] Email the customers affected

\`\`\`sql
SELECT count(*) FROM events WHERE created_at > now() - interval '7 days';
\`\`\`

That's all for today.
`

const CHANGELOG = `# Changelog

All notable changes are documented here.

## [1.4.0] - 2026-06-01

### Added
- New \`--json\` output mode
- Support for \`AT&T\` style names and \`R&D\` labels

### Fixed
- A crash when the input was empty
- Off-by-one in the progress bar

## [1.3.2] - 2026-05-12

### Changed
- Bumped dependencies

---

Older entries omitted.
`

const NESTED_AND_QUOTES = `# Deep Doc

> A blockquote
> spanning two lines.
>
> > And a nested one.

1. First
   - sub bullet with \`code\`
   - another
     1. deep ordered
     2. item
2. Second

\`\`\`typescript
function add(a: number, b: number): number {
  return a + b
}
\`\`\`

A paragraph with _emphasis_, **strong**, and ~~strikethrough~~ text.

Math-ish prose like value $x^2 + y$ stays literal.
`

const TABLES_AND_LINKS = `# Reference

| Method | Path | Auth |
| :----- | :--: | ---: |
| GET | \`/items\` | yes |
| POST | \`/items\` | yes |

Inline autolink: <https://sim.ai>

A normal link to [the site](https://sim.ai "title") and an image:

![diagram](https://example.com/diagram.png)

Use \`a &amp; b\` and \`x < y\` in code freely.
`

const EDITABLE_CORPUS: Record<string, string> = {
  README,
  MEETING_NOTES,
  CHANGELOG,
  NESTED_AND_QUOTES,
  TABLES_AND_LINKS,
}

// Certainty corpus for the editability gate: realistic, full-length markdown (READMEs, notes,
// changelogs, nested lists, tables, task lists, blockquotes, fenced code) must ALL stay editable —
// the probe may only ever refuse genuinely lossy constructs, never ordinary prose.
describe('editability gate — realistic documents stay editable', () => {
  for (const [name, doc] of Object.entries(EDITABLE_CORPUS)) {
    it(`opens editable: ${name}`, () => {
      expect(isRoundTripSafe(doc)).toBe(true)
    })
  }
})
