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

  it('rejects stable-loss constructs the idempotency probe cannot see', () => {
    expect(isRoundTripSafe('text[^1]\n\n[^1]: the note')).toBe(false)
    expect(isRoundTripSafe('<!-- a note -->\n\ntext')).toBe(false)
    expect(isRoundTripSafe('<details><summary>x</summary>body</details>')).toBe(false)
    expect(isRoundTripSafe('a <sub>b</sub> c')).toBe(false)
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
