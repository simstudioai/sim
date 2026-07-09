/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '../extensions'
import { insertBlockBelow, selectBlockAt } from './drag-handle'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function mount(markdown: string): Editor {
  const created = new Editor({ extensions: createMarkdownContentExtensions() })
  created.commands.setContent(markdown, { contentType: 'markdown' })
  return created
}

/** Position before the first top-level block whose text contains `word`, or -1. */
function blockPos(target: Editor, word: string): number {
  let pos = -1
  target.state.doc.forEach((node, offset) => {
    if (pos < 0 && node.textContent.includes(word)) pos = offset
  })
  return pos
}

describe('drag-handle block operations', () => {
  it('inserts a paragraph after the hovered block and opens the slash menu', () => {
    editor = mount('# One\n\nTwo para')
    insertBlockBelow(editor, blockPos(editor, 'Two para'))
    const md = editor.getMarkdown().trim()
    expect(md).toContain('Two para')
    expect(md.split('Two para')[1]).toContain('/')
  })

  it('inserts a sibling after a whole list, not a nested list item', () => {
    editor = mount('- a\n- b')
    insertBlockBelow(editor, blockPos(editor, 'a'))
    expect(editor.getJSON().content?.[0]?.type).toBe('bulletList')
    expect(editor.getJSON().content?.some((node) => node.type === 'paragraph')).toBe(true)
  })

  it('selects the block as a NodeSelection', () => {
    editor = mount('# One\n\nTwo para')
    selectBlockAt(editor, blockPos(editor, 'Two para'))
    const { selection } = editor.state
    expect(selection instanceof NodeSelection).toBe(true)
    expect((selection as NodeSelection).node.textContent).toBe('Two para')
  })

  it('is a no-op at an unresolved position', () => {
    editor = mount('# One')
    const before = editor.getMarkdown()
    insertBlockBelow(editor, -1)
    selectBlockAt(editor, -1)
    expect(editor.getMarkdown()).toBe(before)
  })
})
