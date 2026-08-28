/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '../extensions'
import { getFindTally, RichMarkdownFind, setFindQuery, stepFindMatch } from './find-extension'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function mountEditor(markdown: string): Editor {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({
    element,
    extensions: [...createMarkdownContentExtensions(), RichMarkdownFind],
  })
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  return editor
}

/** The painted highlights, in document order, with the active one marked. */
function paintedMatches(instance: Editor): string[] {
  return Array.from(instance.view.dom.querySelectorAll('.rich-find-match')).map((element) =>
    element.classList.contains('rich-find-match-active')
      ? `[${element.textContent}]`
      : (element.textContent ?? '')
  )
}

describe('RichMarkdownFind', () => {
  it('paints nothing until a term is set', () => {
    const instance = mountEditor('alpha beta alpha')
    expect(paintedMatches(instance)).toEqual([])
    expect(getFindTally(instance.state).matches).toHaveLength(0)
  })

  it('paints every match and marks the first one active', () => {
    const instance = mountEditor('alpha beta alpha')
    setFindQuery(instance, 'alpha')
    expect(paintedMatches(instance)).toEqual(['[alpha]', 'alpha'])
  })

  it('steps the active match forward and backward, wrapping at both ends', () => {
    const instance = mountEditor('one one one')
    setFindQuery(instance, 'one')

    stepFindMatch(instance, 1)
    expect(paintedMatches(instance)).toEqual(['one', '[one]', 'one'])

    stepFindMatch(instance, 1)
    expect(paintedMatches(instance)).toEqual(['one', 'one', '[one]'])

    // Past the end wraps to the first, and back past the start wraps to the last.
    stepFindMatch(instance, 1)
    expect(paintedMatches(instance)).toEqual(['[one]', 'one', 'one'])
    stepFindMatch(instance, -1)
    expect(paintedMatches(instance)).toEqual(['one', 'one', '[one]'])
  })

  it('re-searches when the document changes under a live search', () => {
    const instance = mountEditor('alpha')
    setFindQuery(instance, 'alpha')
    expect(getFindTally(instance.state).matches).toHaveLength(1)

    instance.commands.insertContentAt(instance.state.doc.content.size, ' and alpha again')
    expect(getFindTally(instance.state).matches).toHaveLength(2)
    expect(paintedMatches(instance)).toEqual(['[alpha]', 'alpha'])
  })

  it('drops a match the document no longer contains, without leaving a stale highlight', () => {
    const instance = mountEditor('alpha beta')
    setFindQuery(instance, 'beta')
    expect(paintedMatches(instance)).toEqual(['[beta]'])

    instance.commands.setContent('alpha only', { contentType: 'markdown' })
    expect(paintedMatches(instance)).toEqual([])
    expect(getFindTally(instance.state).matches).toHaveLength(0)
  })

  it('clamps the active index when an edit shrinks the match set', () => {
    const instance = mountEditor('x x x')
    setFindQuery(instance, 'x')
    stepFindMatch(instance, 2)
    expect(getFindTally(instance.state).activeIndex).toBe(2)

    instance.commands.setContent('x', { contentType: 'markdown' })
    const tally = getFindTally(instance.state)
    expect(tally.matches).toHaveLength(1)
    expect(tally.activeIndex).toBe(0)
    expect(paintedMatches(instance)).toEqual(['[x]'])
  })

  it('clears every highlight when the term is emptied', () => {
    const instance = mountEditor('alpha')
    setFindQuery(instance, 'alpha')
    expect(paintedMatches(instance)).toEqual(['[alpha]'])

    setFindQuery(instance, '')
    expect(paintedMatches(instance)).toEqual([])
  })

  it('never writes to the document, the selection, or the undo history', () => {
    const instance = mountEditor('alpha beta alpha')
    const before = instance.getMarkdown()
    const selectionBefore = instance.state.selection.from
    const undoBefore = undoDepth(instance.state)

    setFindQuery(instance, 'alpha')
    stepFindMatch(instance, 1)

    expect(instance.getMarkdown()).toBe(before)
    expect(instance.state.selection.from).toBe(selectionBefore)
    // A search that added an undo step would make the user's next Cmd+Z undo the search
    // instead of their real last edit.
    expect(undoDepth(instance.state)).toBe(undoBefore)
  })
})
