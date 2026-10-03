/**
 * A workflow search match inside a Note has to land on the occurrence the search index counted.
 * These cover which occurrence the card is told to paint and how the rehype plugin wraps it.
 */
import { forEachSearchOccurrence } from '@sim/utils/string'
import type { Element, ElementContent, Root, RootContent } from 'hast'
import { describe, expect, it } from 'vitest'
import { noteSearchHighlightPlugin } from './note-search-highlight'

function paragraphTree(...values: string[]): Root {
  return {
    type: 'root',
    children: values.map((value) => ({
      type: 'element',
      tagName: 'p',
      properties: {},
      children: [{ type: 'text', value }],
    })),
  }
}

describe('note search occurrence scanning', () => {
  it('does not overlap a self-overlapping query', () => {
    const starts: number[] = []
    forEachSearchOccurrence('aaaa', 'aa', (start) => starts.push(start))
    expect(starts).toEqual([0, 2])
  })
})

describe('note search rehype plugin', () => {
  it('does not re-scan the text it just wrapped', () => {
    const tree = paragraphTree('KEYKEY')
    noteSearchHighlightPlugin({ query: 'KEY' })(tree)

    const paragraph = tree.children[0]
    expect(paragraph.type === 'element' && paragraph.children).toHaveLength(2)
  })
})

/*
 * The indexer folds every `\s` to a space before matching, so a phrase can match
 * across a soft line break — which `remark-breaks` renders as a `<br>` splitting
 * the phrase over two text nodes. A per-node scan saw neither half, leaving the
 * hit counted in the panel and highlighted nowhere on the card.
 */
describe('note search across inline boundaries', () => {
  function markedTextsOf(tree: Root): string[] {
    const texts: string[] = []
    const walk = (node: Root | Element) => {
      /* `Root['children']` and `Element['children']` are different unions, so iterating the
         parameter directly widens each child to their intersection and drops narrowing. */
      const children: Array<RootContent | ElementContent> = node.children
      for (const child of children) {
        if (child.type !== 'element') continue
        if (child.tagName === 'mark') {
          const [first] = child.children
          texts.push(first?.type === 'text' ? first.value : '')
          continue
        }
        walk(child)
      }
    }
    walk(tree)
    return texts
  }

  function paragraphWithBreak(before: string, after: string): Root {
    return {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'text', value: before },
            { type: 'element', tagName: 'br', properties: {}, children: [] },
            { type: 'text', value: after },
          ],
        },
      ],
    }
  }

  it('gives both halves of one hit the same ordinal', () => {
    const tree = paragraphWithBreak('the quick', 'brown fox')
    noteSearchHighlightPlugin({ query: 'quick brown' })(tree)

    const ordinals: unknown[] = []
    const walk = (node: Root | Element) => {
      /* `Root['children']` and `Element['children']` are different unions, so iterating the
         parameter directly widens each child to their intersection and drops narrowing. */
      const children: Array<RootContent | ElementContent> = node.children
      for (const child of children) {
        if (child.type !== 'element') continue
        if (child.tagName === 'mark') ordinals.push(child.properties.dataNoteSearchIndex)
        else walk(child)
      }
    }
    walk(tree)
    expect(ordinals).toEqual(['0', '0'])
  })

  /* A match spanning `a**b**c` cannot exist in the source the indexer scans — the asterisks are
     between the words there. Joining across the element would invent one, and because the ordinal
     counts source occurrences, an invented hit appearing earlier steals the current mark. */
  it('does not join text across a bold word', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'text', value: 'a ' },
            {
              type: 'element',
              tagName: 'strong',
              properties: {},
              children: [{ type: 'text', value: 'bold' }],
            },
            { type: 'text', value: ' word' },
          ],
        },
      ],
    }
    noteSearchHighlightPlugin({ query: 'a bold word' })(tree)
    expect(markedTextsOf(tree)).toEqual([])
  })

  /* Two paragraphs are not one phrase on screen. Joining them would invent a hit
     the reader cannot see — and one the indexer never counted, since the source
     carries a blank line there, not a single space. */

  /* The ordinal counts SOURCE occurrences. A hit that only exists once formatting is stripped
     would take ordinal 0 here while the real one — the one the panel is pointing at — became 1,
     so the card would paint the current mark on text the search never matched. */
  it('does not let a formatted concatenation steal the current ordinal', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'text', value: 'a' },
            {
              type: 'element',
              tagName: 'strong',
              properties: {},
              children: [{ type: 'text', value: 'b' }],
            },
            { type: 'text', value: 'c' },
          ],
        },
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [{ type: 'text', value: 'abc' }],
        },
      ],
    }
    noteSearchHighlightPlugin({ query: 'abc' })(tree)

    const marks: Array<[string, unknown]> = []
    const walk = (node: Root | Element) => {
      const children: Array<RootContent | ElementContent> = node.children
      for (const child of children) {
        if (child.type !== 'element') continue
        if (child.tagName === 'mark') {
          const [first] = child.children
          marks.push([
            first?.type === 'text' ? first.value : '',
            child.properties.dataNoteSearchIndex,
          ])
          continue
        }
        walk(child)
      }
    }
    walk(tree)
    expect(marks).toEqual([['abc', '0']])
  })

  it('folds a non-breaking space the way the indexer does', () => {
    const tree = paragraphTree('a b')
    noteSearchHighlightPlugin({ query: 'a b' })(tree)
    expect(markedTextsOf(tree)).toEqual(['a b'])
  })
})
