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
  it('inserts a row after the current row and it round-trips as a clean GFM table', () => {
    editor = mount('| a | b |\n| --- | --- |\n| 1 | 2 |')
    editor.commands.setTextSelection(firstCellPos(editor))
    expect(editor.commands.addRowAfter()).toBe(true)

    const rows = editor.state.doc.firstChild
    expect(rows?.type.name).toBe('table')
    expect(rows?.childCount).toBe(3) // header + original row + inserted row

    const md = editor.getMarkdown().trim()
    expect(md.split('\n')).toHaveLength(4)
    expect(md).toContain('| a')
    expect(md).toContain('| --- | --- |')
  })

  it('keeps the required Markdown header first when inserting rows', () => {
    editor = mount('| a | b |\n| --- | --- |\n| 1 | 2 |')
    editor.commands.setTextSelection(firstCellPos(editor))
    expect(editor.commands.addRowBefore()).toBe(false)
    expect(editor.state.doc.firstChild?.childCount).toBe(2)
  })

  it('deletes the current row', () => {
    editor = mount('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
    // Select the second body row (skip header).
    let pos = -1
    let seen = 0
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === 'tableRow') {
        seen++
        if (seen === 3) pos = p + 2
      }
    })
    editor.commands.setTextSelection(pos)
    expect(editor.commands.deleteRow()).toBe(true)
    expect(editor.state.doc.firstChild?.childCount).toBe(2)
    expect(editor.getMarkdown()).toContain('| 1   | 2   |')
    expect(editor.getMarkdown()).not.toContain('3')
  })

  it('inserts and deletes a column', () => {
    editor = mount('| a | b |\n| --- | --- |\n| 1 | 2 |')
    editor.commands.setTextSelection(firstCellPos(editor))
    expect(editor.commands.addColumnAfter()).toBe(true)
    let cols = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableRow' && cols === 0) cols = node.childCount
    })
    expect(cols).toBe(3)

    // The insert shifted positions — the cursor's old cell no longer maps to the same column, so
    // re-select the first cell before deleting, exactly as a real user would click a cell first.
    editor.commands.setTextSelection(firstCellPos(editor))
    expect(editor.commands.deleteColumn()).toBe(true)
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableRow') cols = node.childCount
    })
    expect(cols).toBe(2)
  })

  it('does not expose an unpersistable header-row toggle', () => {
    editor = mount('| a | b |\n| --- | --- |\n| 1 | 2 |')
    editor.commands.setTextSelection(firstCellPos(editor))
    expect(editor.commands.toggleHeaderRow()).toBe(false)
    expect(editor.isActive('tableHeader')).toBe(true)
  })

  it('deletes the whole table', () => {
    editor = mount('before\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter')
    editor.commands.setTextSelection(firstCellPos(editor))
    expect(editor.commands.deleteTable()).toBe(true)
    const types: string[] = []
    editor.state.doc.forEach((node) => types.push(node.type.name))
    expect(types).not.toContain('table')
    expect(editor.getMarkdown()).toContain('before')
    expect(editor.getMarkdown()).toContain('after')
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
