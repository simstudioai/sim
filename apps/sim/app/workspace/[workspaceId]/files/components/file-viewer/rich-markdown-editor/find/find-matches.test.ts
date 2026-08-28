/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '../extensions'
import { FIND_MATCH_LIMIT, findMatches } from './find-matches'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** Parses markdown through the real schema, so matches are checked against real document positions. */
function docFor(markdown: string) {
  editor = new Editor({ extensions: createMarkdownContentExtensions() })
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  return editor.state.doc
}

/** The text each match actually covers — the only assertion that proves the positions are right. */
function matchedText(markdown: string, query: string): string[] {
  const doc = docFor(markdown)
  return findMatches(doc, query).matches.map((match) => doc.textBetween(match.from, match.to))
}

describe('findMatches', () => {
  it('finds every occurrence across blocks, case-insensitively', () => {
    const doc = docFor('# Report\n\nthe report is ready')
    const { matches, truncated } = findMatches(doc, 'report')
    expect(matches).toHaveLength(2)
    expect(truncated).toBe(false)
    expect(matches.map((m) => doc.textBetween(m.from, m.to))).toEqual(['Report', 'report'])
  })

  it('returns nothing for an empty, whitespace-only, or unmatched term', () => {
    expect(findMatches(docFor('hello'), '').matches).toHaveLength(0)
    expect(findMatches(docFor('hello'), '   ').matches).toHaveLength(0)
    expect(findMatches(docFor('hello'), 'zzz').matches).toHaveLength(0)
  })

  it('folds whitespace the way the rest of the app\u2019s search does', () => {
    // Inherited from `forEachSearchOccurrence`: a typed space matches a non-breaking one, so a
    // term copied out of agent-written prose still finds itself.
    expect(matchedText('one\u00a0two', 'one two')).toEqual(['one\u00a0two'])
  })

  it('keeps positions correct after a code point that lowercases to two characters', () => {
    expect(matchedText('\u0130stanbul and target', 'target')).toEqual(['target'])
  })

  it('matches across a mark boundary within a block', () => {
    // `he**llo**` is two text nodes in one paragraph; a per-text-node search would miss it.
    expect(matchedText('he**llo** world', 'hello')).toEqual(['hello'])
  })

  it('never matches across a block boundary', () => {
    expect(matchedText('ab\n\ncd', 'abcd')).toEqual([])
  })

  it('never matches across an inline atom', () => {
    // The image between them occupies a position; joining `a` to `b` would be a phantom match.
    expect(matchedText('a![alt](https://x.com/i.png)b', 'ab')).toEqual([])
  })

  it('keeps positions correct after an inline atom', () => {
    expect(matchedText('![alt](https://x.com/i.png) target', 'target')).toEqual(['target'])
  })

  it('does not overlap matches of a self-overlapping term', () => {
    expect(matchedText('aaaa', 'aa')).toEqual(['aa', 'aa'])
  })

  it('caps the match set and reports it as truncated', () => {
    const doc = docFor(Array.from({ length: FIND_MATCH_LIMIT + 10 }, () => 'x').join(' '))
    const { matches, truncated } = findMatches(doc, 'x')
    expect(matches).toHaveLength(FIND_MATCH_LIMIT)
    expect(truncated).toBe(true)
  })

  it('honors a caller-supplied limit', () => {
    const { matches, truncated } = findMatches(docFor('x x x x'), 'x', 2)
    expect(matches).toHaveLength(2)
    expect(truncated).toBe(true)
  })
})
