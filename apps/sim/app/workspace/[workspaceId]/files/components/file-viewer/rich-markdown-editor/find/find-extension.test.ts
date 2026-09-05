/**
 * @vitest-environment jsdom
 */

import { PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import { Editor } from '@tiptap/core'
import { redoDepth, undoDepth } from '@tiptap/pm/history'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { markdownToYDoc } from '@/lib/collab-doc/converter'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  getFindTally,
  RichMarkdownFind,
  replaceActiveFindMatch,
  replaceAllFindMatches,
  setFindQuery,
  stepFindMatch,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/find/find-extension'
import { FIND_MATCH_LIMIT } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/find/find-matches'

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

  it('searches a term applied before any other transaction', () => {
    // The hook re-applies a pending term the moment the editor exists; setting a query as the very
    // first thing that happens to a fresh editor must land, not wait for a later transaction.
    const instance = mountEditor('alpha beta')
    setFindQuery(instance, 'beta')
    expect(getFindTally(instance.state).matches).toHaveLength(1)
    expect(paintedMatches(instance)).toEqual(['[beta]'])
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

  it('replaces the active match while preserving its inline marks', () => {
    const instance = mountEditor('**alpha** and alpha')
    setFindQuery(instance, 'alpha')

    expect(replaceActiveFindMatch(instance, 'beta')).toBe(true)
    expect(instance.getMarkdown()).toBe('**beta** and alpha')
    expect(getFindTally(instance.state).matches).toHaveLength(1)
  })

  it('uses the matched text formatting instead of an unrelated typing mark', () => {
    const instance = mountEditor('alpha and beta')
    instance.commands.setTextSelection(instance.state.doc.content.size - 1)
    instance.commands.toggleBold()
    setFindQuery(instance, 'alpha')

    expect(replaceActiveFindMatch(instance, 'gamma')).toBe(true)
    expect(instance.getMarkdown()).toBe('gamma and beta')
  })

  it.each([
    ['he**llo**', 'world'],
    ['**he**llo', '**world**'],
  ])('follows native ProseMirror replacement formatting for %s', (source, expected) => {
    const instance = mountEditor(source)
    setFindQuery(instance, 'hello')
    const { from, to } = getFindTally(instance.state).matches[0]
    const nativeResult = instance.state.tr.setStoredMarks(null).insertText('world', from, to).doc

    expect(replaceActiveFindMatch(instance, 'world')).toBe(true)
    expect(instance.state.doc.eq(nativeResult)).toBe(true)
    expect(instance.getMarkdown()).toBe(expected)
  })

  it('preserves each matched range formatting during Replace All', () => {
    const instance = mountEditor('**alpha** and alpha and *alpha*')
    instance.commands.setTextSelection(instance.state.doc.content.size - 1)
    instance.commands.toggleStrike()
    setFindQuery(instance, 'alpha')

    expect(replaceAllFindMatches(instance, 'beta')).toBe(3)
    expect(instance.getMarkdown()).toBe('**beta** and beta and *beta*')
  })

  it('supports deleting matches with an empty replacement', () => {
    const instance = mountEditor('alpha beta alpha')
    setFindQuery(instance, 'alpha ')

    expect(replaceActiveFindMatch(instance, '')).toBe(true)
    expect(instance.getMarkdown()).toBe('beta alpha')
  })

  it('rejects oversized individual and aggregate replacements before dispatching a transaction', () => {
    const instance = mountEditor(Array.from({ length: FIND_MATCH_LIMIT }, () => 'x').join(' '))
    setFindQuery(instance, 'x')
    const onLimitExceeded = vi.fn()
    const dispatch = vi.spyOn(instance.view, 'dispatch')
    const documentBefore = instance.state.doc

    expect(
      replaceActiveFindMatch(
        instance,
        'y'.repeat(PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS),
        onLimitExceeded
      )
    ).toBe(false)
    expect(replaceAllFindMatches(instance, 'y'.repeat(600), onLimitExceeded)).toBe(0)

    expect(onLimitExceeded).toHaveBeenCalledTimes(2)
    expect(dispatch).not.toHaveBeenCalled()
    expect(instance.state.doc).toBe(documentBefore)
  })

  it('advances past a replacement that still contains the search term', () => {
    const instance = mountEditor('alpha alpha')
    setFindQuery(instance, 'alpha')

    expect(replaceActiveFindMatch(instance, 'alphaX')).toBe(true)
    expect(replaceActiveFindMatch(instance, 'alphaX')).toBe(true)

    expect(instance.getMarkdown()).toBe('alphaX alphaX')
  })

  it('keeps each collaborative replacement as a separate undo item', () => {
    const doc = markdownToYDoc('alpha alpha')
    const awareness = new Awareness(doc)
    editor = new Editor({
      extensions: createMarkdownEditorExtensions({
        placeholder: '',
        collaboration: { doc, awareness, user: { name: 'User', color: '#fff' } },
      }),
    })
    const history = yUndoPluginKey.getState(editor.state) as { undoManager: Y.UndoManager }
    history.undoManager.clear()
    setFindQuery(editor, 'alpha')

    replaceActiveFindMatch(editor, 'beta')
    replaceActiveFindMatch(editor, 'gamma')
    expect(editor.getMarkdown()).toBe('beta gamma')

    expect(editor.commands.undo()).toBe(true)
    expect(editor.getMarkdown()).toBe('beta alpha')
    editor.destroy()
    editor = null
    awareness.destroy()
    doc.destroy()
  })

  it('replaces every match in one undo step', () => {
    const instance = mountEditor('alpha alpha alpha')
    setFindQuery(instance, 'alpha')
    const undoBefore = undoDepth(instance.state)

    expect(replaceAllFindMatches(instance, 'beta')).toBe(3)
    expect(instance.getMarkdown()).toBe('beta beta beta')
    expect(undoDepth(instance.state)).toBe(undoBefore + 1)
    expect(redoDepth(instance.state)).toBe(0)
    expect(instance.commands.undo()).toBe(true)
    expect(instance.getMarkdown()).toBe('alpha alpha alpha')
  })

  it('refuses to label a capped partial replacement as replace all', () => {
    const instance = mountEditor(Array.from({ length: FIND_MATCH_LIMIT + 1 }, () => 'x').join(' '))
    setFindQuery(instance, 'x')
    expect(getFindTally(instance.state).truncated).toBe(true)

    expect(replaceAllFindMatches(instance, 'y')).toBe(0)
    expect(instance.getMarkdown().startsWith('x x x')).toBe(true)
  })
})
