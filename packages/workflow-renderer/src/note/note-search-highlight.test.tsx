/**
 * @vitest-environment jsdom
 *
 * A workflow search match inside a Note has to be visible.
 *
 * The editor panel renders nothing for a Note, so a match in one counted
 * towards the result total and then highlighted nowhere — the first two of six
 * hits landed on a note and looked like a broken search. The card's read view
 * is the only surface that can answer, so these cover the two halves of that:
 * which occurrence the card is told to paint, and that the paint survives the
 * markdown pipeline (sanitization strips unknown tags, so a mark added in the
 * wrong place vanishes without a word).
 */

import { act } from 'react'
import { forEachSearchOccurrence } from '@sim/utils/string'
import type { Element, ElementContent, Root, RootContent } from 'hast'
import { createRoot, type Root as ReactRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  NoteBlockView,
  type NoteContentEditorProps,
  type NoteSearchHighlight,
  type NoteSearchRange,
} from '../index'
import {
  countNoteSearchOccurrencesBefore,
  noteSearchHighlightPlugin,
} from './note-search-highlight'

/* Assigned rather than `vi.stubGlobal`ed: the suite runs with `unstubGlobals`, which restores stubs
   before every test and would strip these back out after the first one. */
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

function renderTestContentEditor(_props: NoteContentEditorProps) {
  return null
}

let host: HTMLDivElement | null = null
let root: ReactRoot | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  host = null
  root = null
})

interface RenderNoteOptions {
  name?: string
  nameSearchRange?: NoteSearchRange | null
}

function noteElement(
  content: string,
  searchHighlight: NoteSearchHighlight | null,
  options: RenderNoteOptions
) {
  return (
    <NoteBlockView
      name={options.name ?? 'Note'}
      content={content}
      isEnabled
      isFocused={false}
      hasRing={false}
      ringStyles=''
      onSelect={() => undefined}
      renderContentEditor={renderTestContentEditor}
      searchHighlight={searchHighlight}
      nameSearchRange={options.nameSearchRange ?? null}
    />
  )
}

function renderNote(
  content: string,
  searchHighlight: NoteSearchHighlight | null,
  options: RenderNoteOptions = {}
): HTMLDivElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(noteElement(content, searchHighlight, options)))
  return host
}

/** Re-renders the mounted card, the way a live search changing does. */
function rerenderNote(
  content: string,
  searchHighlight: NoteSearchHighlight | null,
  options: RenderNoteOptions = {}
): void {
  act(() => root?.render(noteElement(content, searchHighlight, options)))
}

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
  it('matches case-insensitively, like the workflow search index', () => {
    const starts: number[] = []
    forEachSearchOccurrence('Secret and secret', 'SECRET', (start) => starts.push(start))
    expect(starts).toEqual([0, 11])
  })

  it('does not overlap a self-overlapping query', () => {
    const starts: number[] = []
    forEachSearchOccurrence('aaaa', 'aa', (start) => starts.push(start))
    expect(starts).toEqual([0, 2])
  })

  it('counts the occurrences that start before an offset', () => {
    const content = 'KEY one KEY two KEY'
    expect(countNoteSearchOccurrencesBefore(content, 'KEY', 0)).toBe(0)
    expect(countNoteSearchOccurrencesBefore(content, 'KEY', 8)).toBe(1)
    expect(countNoteSearchOccurrencesBefore(content, 'KEY', 16)).toBe(2)
  })

  it('reports no occurrences for an empty query', () => {
    expect(countNoteSearchOccurrencesBefore('anything', '', 4)).toBe(0)
  })
})

describe('note search rehype plugin', () => {
  it('numbers marks in document order across elements', () => {
    const tree = paragraphTree('one KEY here', 'and KEY again')
    noteSearchHighlightPlugin({ query: 'KEY' })(tree)

    const marks = tree.children.flatMap((paragraph) =>
      paragraph.type === 'element'
        ? paragraph.children.filter((child) => child.type === 'element' && child.tagName === 'mark')
        : []
    )
    expect(marks).toHaveLength(2)
    expect(
      marks.map((mark) => mark.type === 'element' && mark.properties.dataNoteSearchIndex)
    ).toEqual(['0', '1'])
  })

  it('keeps the text either side of a match', () => {
    const tree = paragraphTree('one KEY here')
    noteSearchHighlightPlugin({ query: 'KEY' })(tree)

    const paragraph = tree.children[0]
    const values =
      paragraph.type === 'element'
        ? paragraph.children.map((child) =>
            child.type === 'text'
              ? child.value
              : child.type === 'element' && child.children[0]?.type === 'text'
                ? child.children[0].value
                : ''
          )
        : []
    expect(values).toEqual(['one ', 'KEY', ' here'])
  })

  it('does not re-scan the text it just wrapped', () => {
    const tree = paragraphTree('KEYKEY')
    noteSearchHighlightPlugin({ query: 'KEY' })(tree)

    const paragraph = tree.children[0]
    expect(paragraph.type === 'element' && paragraph.children).toHaveLength(2)
  })

  it('leaves a tree without an occurrence untouched', () => {
    const tree = paragraphTree('nothing to see')
    const before = structuredClone(tree)
    noteSearchHighlightPlugin({ query: 'KEY' })(tree)
    expect(tree).toEqual(before)
  })

  it('does nothing for an empty query', () => {
    const tree = paragraphTree('KEY')
    const before = structuredClone(tree)
    noteSearchHighlightPlugin({ query: '' })(tree)
    expect(tree).toEqual(before)
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

  it('marks a phrase spanning a soft line break', () => {
    const tree = paragraphWithBreak('the quick', 'brown fox')
    noteSearchHighlightPlugin({ query: 'quick brown' })(tree)
    expect(markedTextsOf(tree)).toEqual(['quick', 'brown'])
  })

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
  it('does not join text across a block boundary', () => {
    const tree = paragraphTree('the quick', 'brown fox')
    noteSearchHighlightPlugin({ query: 'quick brown' })(tree)
    expect(markedTextsOf(tree)).toEqual([])
  })

  it('still marks a match wholly inside an inline element', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'strong',
              properties: {},
              children: [{ type: 'text', value: 'SB_ACTION' }],
            },
          ],
        },
      ],
    }
    noteSearchHighlightPlugin({ query: 'SB_ACTION' })(tree)
    expect(markedTextsOf(tree)).toEqual(['SB_ACTION'])
  })

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

describe('note search highlight rendering', () => {
  it('marks every occurrence in the read view', () => {
    const container = renderNote('first SB_SECRET line\n\nsecond SB_SECRET line', {
      query: 'SB_SECRET',
      occurrenceIndex: 0,
    })

    const marks = container.querySelectorAll('mark')
    expect(marks).toHaveLength(2)
    expect(Array.from(marks, (mark) => mark.textContent)).toEqual(['SB_SECRET', 'SB_SECRET'])
  })

  /* The ordinal reaches the mark component as a `data-*` prop only because hast
     spells the property `dataNoteSearchIndex` and the JSX runtime converts it
     back. Get that spelling wrong and every mark renders as a non-current one,
     silently. */
  it('paints only the current occurrence as active', () => {
    const container = renderNote('first SB_SECRET line\n\nsecond SB_SECRET line', {
      query: 'SB_SECRET',
      occurrenceIndex: 1,
    })

    const marks = Array.from(container.querySelectorAll('mark'))
    expect(marks.map((mark) => mark.hasAttribute('data-note-search-active'))).toEqual([false, true])
  })

  it('survives sanitization inside formatted markdown', () => {
    const container = renderNote('## Heading SB_SECRET\n\n- item **SB_SECRET**', {
      query: 'SB_SECRET',
      occurrenceIndex: 0,
    })

    expect(container.querySelectorAll('mark')).toHaveLength(2)
    expect(container.querySelector('h2 mark')).not.toBeNull()
    expect(container.querySelector('strong mark')).not.toBeNull()
  })

  it('renders no marks when no search points at the note', () => {
    const container = renderNote('first SB_SECRET line', null)
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  /* An env-var token is indexed as one `environment` match spanning the whole
     `{{…}}`, not as the plain text the user typed into the search box. The card
     marks what is on screen, so a partial query still has to land. */
  it('marks a partial query inside an environment token', () => {
    const container = renderNote('{{TE_SECRET}}', { query: '{{TE', occurrenceIndex: 0 })

    const mark = container.querySelector('mark')
    expect(mark?.textContent).toBe('{{TE')
    expect(mark?.hasAttribute('data-note-search-active')).toBe(true)
  })
})

/*
 * Every case above mounts the card fresh, which is the one situation that
 * cannot catch this: Streamdown is memoised behind a comparator that ignores
 * `rehypePlugins`, so on an already-mounted card a plugin change alone does not
 * re-render it. Marks then outlived the query that produced them — cleared the
 * search box and the note stayed highlighted.
 */
describe('note search highlight on an already-mounted card', () => {
  it('clears the marks when the query is cleared', () => {
    const container = renderNote('first SB_SECRET line', { query: 'SB_SECRET', occurrenceIndex: 0 })
    expect(container.querySelectorAll('mark')).toHaveLength(1)

    rerenderNote('first SB_SECRET line', null)

    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('re-marks as the query is edited down', () => {
    const container = renderNote('{{TE_SECRET}}', { query: '{{TE', occurrenceIndex: 0 })
    expect(container.querySelector('mark')?.textContent).toBe('{{TE')

    rerenderNote('{{TE_SECRET}}', { query: '{{T', occurrenceIndex: 0 })

    expect(container.querySelector('mark')?.textContent).toBe('{{T')
  })

  it('moves the current mark without dropping the others', () => {
    const container = renderNote('one KEY two KEY', { query: 'KEY', occurrenceIndex: 0 })
    const activeOf = () =>
      Array.from(container.querySelectorAll('mark'), (mark) =>
        mark.hasAttribute('data-note-search-active')
      )
    expect(activeOf()).toEqual([true, false])

    rerenderNote('one KEY two KEY', { query: 'KEY', occurrenceIndex: 1 })

    expect(activeOf()).toEqual([false, true])
  })
})

describe('note title search highlight', () => {
  it('marks the range inside the title', () => {
    const container = renderNote('body', null, {
      name: 'Handler Notes',
      nameSearchRange: { start: 8, end: 13 },
    })

    const mark = container.querySelector('mark')
    expect(mark?.textContent).toBe('Notes')
  })

  it('keeps the rest of the title intact', () => {
    const container = renderNote('body', null, {
      name: 'Handler Notes',
      nameSearchRange: { start: 8, end: 13 },
    })

    expect(container.querySelector('mark')?.parentElement?.textContent).toBe('Handler Notes')
  })

  it('leaves the title plain without a range', () => {
    const container = renderNote('body', null, { name: 'Handler Notes' })
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })
})
