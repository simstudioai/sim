/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
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
})
