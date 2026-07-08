/**
 * @vitest-environment jsdom
 *
 * A select-all (`AllSelection`) maps through a whole-document `setContent` replace as "select
 * everything in the new doc" — a real, non-empty range. If that range happens to sweep a divider or
 * image, `keymap.ts`'s `richLeafSelectionHighlight` decoration paints it with `rich-leaf-in-selection`
 * (a thick highlight, see `rich-markdown-editor.css`), and nothing collapses it afterward. This is
 * exactly what `rich-markdown-editor.tsx`'s stream-settle handler works around by calling
 * `editor.commands.setTextSelection(editor.state.doc.content.size)` after every settle-time
 * `setContent` — this test locks in that the fix actually collapses the selection.
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'
import { parseMarkdownToDoc } from './markdown-parse'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('stream-settle selection collapse', () => {
  it('a select-all survives a whole-document setContent as a non-empty range', () => {
    editor = new Editor({
      extensions: createMarkdownContentExtensions(),
      content: '# Title\n\n---\n\nbody',
      contentType: 'markdown',
    })
    editor.commands.selectAll()
    expect(editor.state.selection.empty).toBe(false)

    editor.commands.setContent(parseMarkdownToDoc('# New title\n\n---\n\nnew body'), {
      contentType: 'json',
      emitUpdate: false,
    })
    // The bug: without an explicit selection reset, the mapped select-all still spans the new doc.
    expect(editor.state.selection.empty).toBe(false)
  })

  it('setTextSelection(doc size) after setContent collapses the selection (the fix)', () => {
    editor = new Editor({
      extensions: createMarkdownContentExtensions(),
      content: '# Title\n\n---\n\nbody',
      contentType: 'markdown',
    })
    editor.commands.selectAll()

    editor.commands.setContent(parseMarkdownToDoc('# New title\n\n---\n\nnew body'), {
      contentType: 'json',
      emitUpdate: false,
    })
    editor.commands.setTextSelection(editor.state.doc.content.size)

    expect(editor.state.selection.empty).toBe(true)
  })
})
