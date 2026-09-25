/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  FIND_MATCH_LIMIT,
  findMatches,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/find/find-matches'

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
  it('keeps positions correct after a code point that lowercases to two characters', () => {
    expect(matchedText('\u0130stanbul and target', 'target')).toEqual(['target'])
  })

  it('never matches across a block boundary', () => {
    expect(matchedText('ab\n\ncd', 'abcd')).toEqual([])
  })

  it.each(['\uFFFF', 'a\uFFFFb'])('never matches an inline atom using %j', (query) => {
    const doc = docFor('a<br>b')
    expect(() => doc.check()).not.toThrow()
    expect(findMatches(doc, query)).toEqual({ matches: [], truncated: false })
  })

  it('never matches across an inline atom', () => {
    // The image between them occupies a position; joining `a` to `b` would be a phantom match.
    expect(matchedText('a![alt](https://x.com/i.png)b', 'ab')).toEqual([])
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
})
