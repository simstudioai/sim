/**
 * @vitest-environment jsdom
 *
 * Certainty corpus for the editability gate. A file opens editable for a permitted user iff
 * {@link isRoundTripSafe} returns true on its content, so this asserts that realistic, full-length
 * markdown documents — READMEs, notes, changelogs, docs with nested lists, tables, task lists,
 * blockquotes, fenced code, inline formatting — are ALL editable. The probe must only ever refuse
 * the genuinely lossy constructs (footnotes, raw HTML, >128KB), never ordinary prose.
 */
import { describe, expect, it } from 'vitest'
import { isRoundTripSafe } from './round-trip-safety'

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

describe('editability gate — realistic documents stay editable', () => {
  for (const [name, doc] of Object.entries(EDITABLE_CORPUS)) {
    it(`opens editable: ${name}`, () => {
      expect(isRoundTripSafe(doc)).toBe(true)
    })
  }

  it('a large-but-ordinary document (just under the probe limit) stays editable', () => {
    const big = `# Big Doc\n\n${'A paragraph of perfectly ordinary prose. '.repeat(500)}`
    expect(big.length).toBeLessThan(24 * 1024)
    expect(isRoundTripSafe(big)).toBe(true)
  })

  it('frontmatter does not gate editability', () => {
    expect(isRoundTripSafe('---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n\nText.')).toBe(true)
  })
})

/**
 * The flip side: constructs the WYSIWYG schema genuinely cannot represent open read-only so an edit
 * can't silently corrupt them. These are documented here as the EXACT boundary of the gate — common
 * in hand-authored GitHub READMEs, rare in agent-generated docs and ordinary notes.
 */
describe('editability gate — genuinely lossy constructs open read-only', () => {
  it('raw HTML blocks (<details>, <div align>) open read-only', () => {
    expect(isRoundTripSafe('<details><summary>More</summary>\n\nbody\n\n</details>')).toBe(false)
    expect(isRoundTripSafe('<div align="center">\n\ncentered\n\n</div>')).toBe(false)
  })

  it('HTML comments and footnotes open read-only', () => {
    expect(isRoundTripSafe('<!-- TODO: revise -->\n\ntext')).toBe(false)
    expect(isRoundTripSafe('a claim[^1]\n\n[^1]: the source')).toBe(false)
  })
})
