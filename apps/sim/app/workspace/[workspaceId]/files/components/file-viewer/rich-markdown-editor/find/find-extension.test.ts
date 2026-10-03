/**
 * @vitest-environment jsdom
 */

import { PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
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

describe('RichMarkdownFind', () => {
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

  it('refuses to label a capped partial replacement as replace all', () => {
    const instance = mountEditor(Array.from({ length: FIND_MATCH_LIMIT + 1 }, () => 'x').join(' '))
    setFindQuery(instance, 'x')
    expect(getFindTally(instance.state).truncated).toBe(true)

    expect(replaceAllFindMatches(instance, 'y')).toBe(0)
    expect(instance.getMarkdown().startsWith('x x x')).toBe(true)
  })
})
