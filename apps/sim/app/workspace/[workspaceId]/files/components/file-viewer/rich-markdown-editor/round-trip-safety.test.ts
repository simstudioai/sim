/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { isRoundTripSafe } from './round-trip-safety'

describe('isRoundTripSafe', () => {
  it('passes ordinary markdown and lossless normalizations', () => {
    expect(isRoundTripSafe('# Title\n\nA **bold** word and a [link](https://sim.ai).')).toBe(true)
    expect(isRoundTripSafe('- one\n- two\n\n```js\nconst x = 1\n```')).toBe(true)
    expect(isRoundTripSafe('| a | b |\n| :-- | --: |\n| 1 | 2 |')).toBe(true)
    expect(isRoundTripSafe('- [ ] a\n  - [x] b')).toBe(true)
    expect(isRoundTripSafe('line one  \nline two')).toBe(true)
    expect(isRoundTripSafe('value $x^2 + y$ here')).toBe(true)
    expect(isRoundTripSafe('a &amp; b &lt; c')).toBe(true)
    expect(isRoundTripSafe('Title\n=====\n\nbody')).toBe(true)
    expect(isRoundTripSafe('')).toBe(true)
  })

  it('passes a linked image / badge (round-trips through the image node href)', () => {
    expect(isRoundTripSafe('[![alt](https://e.com/i.png)](https://e.com)')).toBe(true)
    expect(
      isRoundTripSafe('[![build](https://img.shields.io/badge/x-green)](https://ci.example.com)')
    ).toBe(true)
    expect(isRoundTripSafe('[![alt](https://e.com/i.png "t")](https://e.com "h")')).toBe(true)
  })

  it('passes inline code without an interior backtick', () => {
    expect(isRoundTripSafe('use `npm install` here')).toBe(true)
  })

  it('passes a code block followed by other content (idempotent block separation)', () => {
    expect(isRoundTripSafe('```\ncode\n```\n\ntext after')).toBe(true)
    expect(
      isRoundTripSafe('```markdown\n\n```\n\n![s](/api/files/serve/x.png?context=workspace)')
    ).toBe(true)
    expect(isRoundTripSafe('> ```\n> code\n> ```')).toBe(true)
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
  })

  it('does not flag HTML/comments/entities inside tilde or nested code fences', () => {
    expect(isRoundTripSafe('~~~html\n<!-- c -->\n~~~')).toBe(true)
    expect(isRoundTripSafe('````md\n```\n<div>x</div>\n```\n````')).toBe(true)
  })

  it('rejects non-idempotent churn', () => {
    expect(isRoundTripSafe('render `` a`b `` inline')).toBe(false)
  })

  it('does not flag <br> outside a table (converts losslessly to a hard break)', () => {
    expect(isRoundTripSafe('a<br>b')).toBe(true)
    expect(isRoundTripSafe('a line\n\nwith | a pipe but no break')).toBe(true)
    expect(isRoundTripSafe('Use a<br>break or the pipe | operator.')).toBe(true)
  })

  it('rejects <br> inside a table cell (flattened to a space)', () => {
    expect(isRoundTripSafe('| a | b |\n| --- | --- |\n| one<br>two | x |')).toBe(false)
  })

  it('allows <img> (a supported, resizable image node)', () => {
    expect(isRoundTripSafe('<img src="https://e.com/i.png" width="320">')).toBe(true)
  })

  it('does not flag a fenced block that merely contains html or backticks', () => {
    expect(isRoundTripSafe('```html\n<div>hi</div>\n```')).toBe(true)
    expect(isRoundTripSafe('````md\n```\ncode\n```\n````')).toBe(true)
  })

  it('does not flag markdown autolinks as raw html', () => {
    expect(isRoundTripSafe('see <https://sim.ai> for more')).toBe(true)
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

  it('a large-but-ordinary document (just under the probe limit) stays editable', () => {
    const big = `# Big Doc\n\n${'A paragraph of perfectly ordinary prose. '.repeat(5000)}`
    expect(big.length).toBeLessThan(256 * 1024)
    expect(big.length).toBeGreaterThan(128 * 1024)
    expect(isRoundTripSafe(big)).toBe(true)
  })

  it('frontmatter does not gate editability', () => {
    expect(isRoundTripSafe('---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n\nText.')).toBe(true)
  })
})

// The flip side and exact boundary of the gate: constructs the WYSIWYG schema genuinely cannot
// represent open read-only so an edit can't silently corrupt them. Raw HTML blocks, comments, and
// footnotes used to be the canonical examples here — `./raw-markdown-snippet.ts` now holds each
// verbatim (including a multi-line block spanning blank lines, via the same `NON_CHUNKABLE`
// whole-document parse path `markdown-parse.ts` already uses for these constructs), so they moved
// to the "preserved" test above instead of staying here.
describe('editability gate — genuinely lossy constructs open read-only', () => {
  it('raw HTML blocks (<details>, <div align>) are preserved verbatim, not locked read-only', () => {
    expect(isRoundTripSafe('<details><summary>More</summary>\n\nbody\n\n</details>')).toBe(true)
    expect(isRoundTripSafe('<div align="center">\n\ncentered\n\n</div>')).toBe(true)
  })

  it('HTML comments and footnotes are preserved verbatim, not locked read-only', () => {
    expect(isRoundTripSafe('<!-- TODO: revise -->\n\ntext')).toBe(true)
    expect(isRoundTripSafe('a claim[^1]\n\n[^1]: the source')).toBe(true)
  })
})
