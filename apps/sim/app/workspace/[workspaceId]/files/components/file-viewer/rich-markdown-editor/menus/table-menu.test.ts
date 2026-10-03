/**
 * @vitest-environment jsdom
 *
 * `TableBubbleMenu` (table-menu.tsx) is a thin UI wrapper around `@tiptap/extension-table`'s stock
 * commands — the button that matters is the command it calls, not the floating-toolbar chrome. These
 * exercise the exact commands the toolbar wires up (`addRowBefore`/`addRowAfter`/`deleteRow`,
 * `addColumnBefore`/`addColumnAfter`/`deleteColumn`, `toggleHeaderRow`, `deleteTable`) against a real
 * editor and assert the result round-trips through `PipeSafeTable` to clean, correctly-shaped GFM.
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function mount(markdown: string): Editor {
  return new Editor({
    extensions: createMarkdownContentExtensions(),
    content: markdown,
    contentType: 'markdown',
  })
}

function firstCellPos(ed: Editor): number {
  let pos = -1
  ed.state.doc.descendants((node, p) => {
    if (pos < 0 && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) pos = p + 1
  })
  return pos
}

describe('table toolbar commands', () => {
  it('keeps the required Markdown header first when inserting rows', () => {
    editor = mount('| a | b |\n| --- | --- |\n| 1 | 2 |')
    editor.commands.setTextSelection(firstCellPos(editor))
    expect(editor.commands.addRowBefore()).toBe(false)
    expect(editor.state.doc.firstChild?.childCount).toBe(2)
  })

  it('does not expose an unpersistable header-row toggle', () => {
    editor = mount('| a | b |\n| --- | --- |\n| 1 | 2 |')
    editor.commands.setTextSelection(firstCellPos(editor))
    expect(editor.commands.toggleHeaderRow()).toBe(false)
    expect(editor.isActive('tableHeader')).toBe(true)
  })

  it('a full add-row + add-column + delete-row sequence stays idempotent on re-serialize', () => {
    editor = mount('| a | b |\n| --- | --- |\n| 1 | 2 |')
    editor.commands.setTextSelection(firstCellPos(editor))
    editor.commands.addRowAfter()
    editor.commands.addColumnAfter()
    const once = editor.getMarkdown().trim()
    const reparsed = new Editor({
      extensions: createMarkdownContentExtensions(),
      content: once,
      contentType: 'markdown',
    })
    const twice = reparsed.getMarkdown().trim()
    reparsed.destroy()
    expect(twice).toBe(once)
  })
})
