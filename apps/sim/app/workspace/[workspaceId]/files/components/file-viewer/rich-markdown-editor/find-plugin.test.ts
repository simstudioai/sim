/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  FindFlags,
  FindResult,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/find/types'
import { FileFindHighlight, getFindState } from './find-plugin'
import { createMarkdownFindController } from './use-markdown-find'

const flags = (overrides: Partial<FindFlags> = {}): FindFlags => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...overrides,
})

/** Minimal editor (core nodes + the find plugin) — avoids the full markdown extension set and its UI deps. */
function editorWith(content: string): Editor {
  return new Editor({ extensions: [StarterKit, FileFindHighlight], content })
}

function controllerFor(editor: Editor) {
  const results: FindResult[] = []
  const controller = createMarkdownFindController(editor, (r) => results.push(r))
  return { controller, results, last: () => results[results.length - 1] }
}

describe('markdown find plugin + controller', () => {
  let editor: Editor

  beforeEach(() => {
    editor = editorWith('<p>one two two three two</p>')
  })

  it('finds all matches and reports a count', () => {
    const { controller, last } = controllerFor(editor)
    controller.search('two', flags())
    expect(getFindState(editor.state).matches).toHaveLength(3)
    expect(last().count).toBe(3)
    expect(last().currentIndex).toBe(0)
  })

  it('renders inline decorations for the matches, current one distinct', () => {
    const { controller } = controllerFor(editor)
    controller.search('two', flags())
    const html = editor.view.dom.innerHTML
    expect(html).toContain('file-find-match-current')
    expect((html.match(/file-find-match/g) ?? []).length).toBe(3)
  })

  it('steps with wrap-around', () => {
    const { controller, last } = controllerFor(editor)
    controller.search('two', flags())
    controller.next()
    expect(last().currentIndex).toBe(1)
    controller.prev()
    controller.prev()
    expect(last().currentIndex).toBe(2) // wrapped past 0
  })

  it('is case-insensitive', () => {
    const cased = editorWith('<p>Two two TWO</p>')
    const { controller, last } = controllerFor(cased)
    controller.search('two', flags())
    expect(last().count).toBe(3)
  })

  it('clears matches on an empty query', () => {
    const { controller, last } = controllerFor(editor)
    controller.search('two', flags())
    controller.search('', flags())
    expect(getFindState(editor.state).matches).toHaveLength(0)
    expect(last().count).toBe(0)
  })

  it('recomputes matches when the document changes underneath an active find', () => {
    const { controller } = controllerFor(editor)
    controller.search('two', flags())
    expect(getFindState(editor.state).matches).toHaveLength(3)
    // Simulate an external edit (e.g. a collaborator) inserting another "two".
    editor.commands.insertContentAt(1, 'two ')
    expect(getFindState(editor.state).matches).toHaveLength(4)
  })
})
