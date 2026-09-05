/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
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

describe('block movement across leaf siblings', () => {
  it.each(['<hr>', '<img src="https://example.com/picture.png">'])(
    'moves text across %s in both directions',
    (leaf) => {
      const ed = mount(`${leaf}<p>abcdef</p><p>tail</p>`)
      ed.commands.setTextSelection(findText(ed, 'abcdef') + 3)
      const before = ed.getJSON()

      expect(ed.commands.moveBlockUp()).toBe(true)
      expect(ed.state.doc.firstChild?.textContent).toBe('abcdef')
      expect(ed.state.selection.$from.parentOffset).toBe(3)
      expect(ed.commands.moveBlockDown()).toBe(true)
      expect(ed.getJSON()).toEqual(before)
      expect(ed.state.selection.$from.parentOffset).toBe(3)
    }
  )

  it.each(['<hr>', '<img src="https://example.com/picture.png">'])(
    'moves selected %s without replacing node selection with a caret',
    (leaf) => {
      const ed = mount(`<p>before</p>${leaf}<p>after</p>`)
      const leafPosition = ed.state.doc.firstChild?.nodeSize ?? 0
      ed.commands.setNodeSelection(leafPosition)
      const before = ed.getJSON()
      const selectedType = (ed.state.selection as NodeSelection).node.type.name

      expect(ed.commands.moveBlockUp()).toBe(true)
      expect(ed.state.selection instanceof NodeSelection).toBe(true)
      expect(ed.state.selection.from).toBe(0)
      expect(ed.state.doc.firstChild?.type.name).toBe(selectedType)
      expect(ed.commands.moveBlockDown()).toBe(true)
      expect(ed.getJSON()).toEqual(before)
      expect(ed.state.selection instanceof NodeSelection).toBe(true)
      expect(ed.state.selection.from).toBe(leafPosition)
    }
  )

  it('supports the actual keyboard chord on a selected divider', () => {
    const ed = mount('<p>before</p><hr><p>after</p>')
    ed.commands.setNodeSelection(8)
    ed.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    )

    expect(ed.state.doc.firstChild?.type.name).toBe('horizontalRule')
    expect(ed.state.selection instanceof NodeSelection).toBe(true)
    expect(ed.state.selection.from).toBe(0)
  })
})

describe('block movement preserves selection intent', () => {
  it.each(['up', 'down'] as const)(
    'preserves a backwards selected text range when moving %s',
    (direction) => {
      const ed = mount('<p>before</p><p>abcdef</p><p>after</p>')
      const pos = findText(ed, 'abcdef')
      ed.commands.setTextSelection({ from: pos + 5, to: pos + 1 })
      const before = ed.getJSON()

      expect(move(ed, direction)).toBe(true)
      expect(ed.state.selection instanceof TextSelection).toBe(true)
      expect(ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to)).toBe('bcde')
      expect(ed.state.selection.anchor).toBeGreaterThan(ed.state.selection.head)
      expect(ed.commands.undo()).toBe(true)
      expect(ed.getJSON()).toEqual(before)
      expect(ed.state.selection.anchor).toBe(pos + 5)
      expect(ed.state.selection.head).toBe(pos + 1)
      expect(ed.commands.redo()).toBe(true)
      expect(ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to)).toBe('bcde')
    }
  )

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

  it('returns false at the document edge and for a root gap without a selected block', () => {
    const ed = mount('<hr><p>last</p>')
    ed.commands.setNodeSelection(0)
    expect(ed.can().moveBlockUp()).toBe(false)
    expect(ed.commands.moveBlockUp()).toBe(false)
    ed.view.dispatch(ed.state.tr.setSelection(new GapCursor(ed.state.doc.resolve(0))))
    expect(ed.commands.moveBlockDown()).toBe(false)
    ed.commands.setTextSelection(findText(ed, 'last'))
    expect(ed.commands.moveBlockDown()).toBe(false)
  })
})
