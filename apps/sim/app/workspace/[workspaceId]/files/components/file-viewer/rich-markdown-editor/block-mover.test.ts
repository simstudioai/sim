/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function mount(content: string): Editor {
  editor = new Editor({ extensions: createMarkdownEditorExtensions({ placeholder: '' }), content })
  return editor
}

function findText(ed: Editor, text: string): number {
  let position = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) position = pos
  })
  expect(position).toBeGreaterThan(-1)
  return position
}

function move(ed: Editor, direction: 'up' | 'down'): boolean {
  return direction === 'up' ? ed.commands.moveBlockUp() : ed.commands.moveBlockDown()
}

describe('block movement preserves selection intent', () => {
  it.each(['up', 'down'] as const)(
    'moves all selected blocks together %s, retaining their order',
    (direction) => {
      const ed = mount('<p>before</p><p>first</p><hr><p>second</p><p>after</p>')
      const start = findText(ed, 'first') + 2
      const end = findText(ed, 'second') + 4
      ed.commands.setTextSelection({ from: end, to: start })
      const selected = ed.state.doc.textBetween(start, end, '\n')

      expect(move(ed, direction)).toBe(true)
      const nodes: string[] = []
      ed.state.doc.forEach((node) => nodes.push(node.textContent || node.type.name))
      expect(nodes).toEqual(
        direction === 'up'
          ? ['first', 'horizontalRule', 'second', 'before', 'after']
          : ['before', 'after', 'first', 'horizontalRule', 'second']
      )
      expect(ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to, '\n')).toBe(
        selected
      )
      expect(ed.state.selection.anchor).toBeGreaterThan(ed.state.selection.head)
    }
  )

  it('keeps nested selection and descendant marks inside the moved list', () => {
    const ed = mount(
      '<p>before</p><ul><li><p>parent</p><ul><li><p><strong>child</strong></p></li></ul></li></ul><p>after</p>'
    )
    const pos = findText(ed, 'child')
    ed.commands.setTextSelection({ from: pos, to: pos + 5 })
    const listBefore = ed.state.doc.child(1).toJSON()

    expect(ed.commands.moveBlockUp()).toBe(true)
    expect(ed.state.doc.firstChild?.toJSON()).toEqual(listBefore)
    expect(ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to)).toBe('child')
    expect(ed.state.selection.$from.depth).toBe(5)
  })
})
