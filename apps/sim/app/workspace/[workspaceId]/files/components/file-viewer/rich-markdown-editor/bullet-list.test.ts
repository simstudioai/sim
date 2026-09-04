/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function mount(content: string): Editor {
  editor = new Editor({ extensions: createMarkdownContentExtensions(), content })
  return editor
}

/** Runs the real text-input rules; insertContent alone does not trigger them. */
function typeBullet(ed: Editor, marker = '-'): void {
  ed.commands.insertContent(marker)
  const { from, to } = ed.state.selection
  expect(
    ed.view.someProp('handleTextInput', (handler) =>
      handler(ed.view, from, to, ' ', () => ed.state.tr)
    )
  ).toBe(true)
}

describe('typed bullet list joining', () => {
  it.each(['-', '+', '*'])('joins %s typed after a heading to the following list', (marker) => {
    const ed = mount('<h2>Todos:</h2><ul><li><p>one</p></li><li><p>two</p></li></ul>')
    ed.commands.setTextSelection(7)
    ed.commands.keyboardShortcut('Enter')
    typeBullet(ed, marker)
    ed.commands.insertContent('new')

    expect(
      ed
        .getJSON()
        .content?.slice(0, 2)
        .map((node) => node.type)
    ).toEqual(['heading', 'bulletList'])
    expect(ed.getJSON().content?.filter((node) => node.type === 'bulletList')).toHaveLength(1)
    expect(ed.getJSON().content?.[1].content).toHaveLength(3)
    expect(ed.getMarkdown().trim()).toBe('## Todos:\n\n- new\n- one\n- two')
    expect(ed.state.selection.$from.parent.textContent).toBe('new')
    expect(ed.view.dom.querySelectorAll(':scope > ul')).toHaveLength(1)
  })

  it('joins both neighbors when turning their separating paragraph into a bullet', () => {
    const ed = mount('<ul><li><p>one</p></li></ul><p></p><ul><li><p>two</p></li></ul>')
    ed.commands.setTextSelection(10)
    typeBullet(ed)
    ed.commands.insertContent('new')

    expect(ed.getJSON().content?.filter((node) => node.type === 'bulletList')).toHaveLength(1)
    expect(ed.getMarkdown().trim()).toBe('- one\n- new\n- two')
  })

  it('does not join across an intentional blank paragraph', () => {
    const ed = mount('<p></p><p></p><ul><li><p>one</p></li></ul>')
    ed.commands.setTextSelection(1)
    typeBullet(ed)
    ed.commands.insertContent('new')

    expect(
      ed
        .getJSON()
        .content?.slice(0, 3)
        .map((node) => node.type)
    ).toEqual(['bulletList', 'paragraph', 'bulletList'])
  })

  it('joins a nested list without changing its depth or dropping formatted content', () => {
    const ed = mount(
      '<ul><li><p>parent</p><p></p><ul><li><p><strong>child</strong></p></li></ul></li></ul>'
    )
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) {
        ed.commands.setTextSelection(pos + 1)
      }
    })
    typeBullet(ed)
    ed.commands.insertContent('new child')

    const parent = ed.getJSON().content?.[0].content?.[0]
    expect(parent?.content?.map((node) => node.type)).toEqual(['paragraph', 'bulletList'])
    expect(parent?.content?.[1].content).toHaveLength(2)
    expect(ed.getMarkdown().trim()).toBe('- parent\n  - new child\n  - **child**')
    expect(ed.state.selection.$from.depth).toBe(5)
  })

  it('does not absorb a following numbered list', () => {
    const ed = mount('<p></p><ol start="3"><li><p>one</p></li></ol>')
    ed.commands.setTextSelection(1)
    typeBullet(ed)

    expect(
      ed
        .getJSON()
        .content?.slice(0, 2)
        .map((node) => node.type)
    ).toEqual(['bulletList', 'orderedList'])
    expect(ed.getJSON().content?.[1].attrs?.start).toBe(3)
  })

  it('undoes the input rule and its join together without losing the following items', () => {
    const ed = mount('<p></p><ul><li><p>one</p></li><li><p>two</p></li></ul>')
    ed.commands.setTextSelection(1)
    typeBullet(ed)
    expect(ed.commands.undoInputRule()).toBe(true)

    expect(
      ed
        .getJSON()
        .content?.slice(0, 2)
        .map((node) => node.type)
    ).toEqual(['paragraph', 'bulletList'])
    expect(ed.state.doc.firstChild?.textContent).toBe('- ')
    expect(ed.getJSON().content?.[1].content).toHaveLength(2)
  })

  it.each(['-', '+', '*'])(
    'Backspace restores the typed %s marker before a following list',
    (marker) => {
      editor = new Editor({
        extensions: createMarkdownEditorExtensions({ placeholder: '' }),
        content: '<h2>Todos:</h2><ul><li><p>one</p></li><li><p>two</p></li></ul>',
      })
      editor.commands.setTextSelection(7)
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
      typeBullet(editor, marker)
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
      )

      expect(
        editor
          .getJSON()
          .content?.slice(0, 3)
          .map((node) => node.type)
      ).toEqual(['heading', 'paragraph', 'bulletList'])
      expect(editor.state.selection.$from.parent.textContent).toBe(`${marker} `)
      expect(editor.state.selection.$from.parentOffset).toBe(2)
      expect(editor.state.doc.child(2).textContent).toBe('onetwo')
    }
  )
})
