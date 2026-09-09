/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { dispatchEditorDrop } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-drop.test-helpers'
import { isImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function createEditor() {
  const editor = new Editor({
    extensions: createMarkdownContentExtensions(),
    content: '<h2>Heading</h2><img src="/image.png" alt="Original" width="120"><p>After</p>',
    editorProps: { handleScrollToSelection: () => false },
  })
  editors.push(editor)
  editor.commands.setNodeSelection(9)
  return editor
}

function images(editor: Editor) {
  const result: { type: string; src: string; alt: string; width: string | null }[] = []
  editor.state.doc.descendants((node) => {
    if (isImageNode(node))
      result.push({
        type: node.type.name,
        src: node.attrs.src,
        alt: node.attrs.alt,
        width: node.attrs.width,
      })
  })
  return result
}

describe('image drop ownership and placement', () => {
  it.each([
    ['heading', 4, 'inlineImage'],
    ['paragraph', 13, 'inlineImage'],
    ['block boundary', 0, 'image'],
  ])('moves to a %s without duplicating or changing text', (_label, position, type) => {
    const editor = createEditor()
    const text = editor.state.doc.textContent
    expect(dispatchEditorDrop(editor, Number(position)).defaultPrevented).toBe(true)
    expect(images(editor)).toEqual([{ type, src: '/image.png', alt: 'Original', width: '120' }])
    expect(editor.state.doc.textContent).toBe(text)
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(() => editor.state.doc.check()).not.toThrow()
    expect(editor.commands.undo()).toBe(true)
    expect(images(editor)[0].type).toBe('image')
  })

  it.each([0, 4])('copies with the platform modifier at position %s', (position) => {
    const editor = createEditor()
    dispatchEditorDrop(editor, position, { copy: true })
    expect(images(editor)).toHaveLength(2)
    expect(editor.state.doc.textContent).toBe('HeadingAfter')
  })

  it.each([0, 4])(
    'copies an external same-URL image instead of moving the selection at %s',
    (position) => {
      const editor = createEditor()
      dispatchEditorDrop(editor, position, {
        html: '<img src="/image.png" alt="External" width="240">',
      })
      expect(images(editor)).toHaveLength(2)
      expect(images(editor)).toContainEqual({
        type: 'image',
        src: '/image.png',
        alt: 'Original',
        width: '120',
      })
      expect(
        images(editor).some((image) => image.alt === 'External' && image.width === '240')
      ).toBe(true)
    }
  )

  it('preserves every image and accompanying text from an external rich drop', () => {
    const editor = createEditor()
    dispatchEditorDrop(editor, 0, {
      html: '<p>Caption</p><img src="/image.png"><p>Between</p><img src="/second.png"><p>End</p>',
    })
    expect(images(editor)).toHaveLength(3)
    expect(editor.state.doc.textContent).toBe('CaptionBetweenEndHeadingAfter')
  })

  it('moves an inline image back to a block boundary', () => {
    const editor = createEditor()
    dispatchEditorDrop(editor, 4)
    expect(images(editor)[0].type).toBe('inlineImage')
    dispatchEditorDrop(editor, 0)
    expect(images(editor)).toHaveLength(1)
    expect(editor.state.doc.firstChild?.type.name).toBe('image')
    expect(editor.state.doc.textContent).toBe('HeadingAfter')
  })

  it.each(['delete', 'resize'])(
    'does not overwrite a source that changed during the drag: %s',
    (action) => {
      const editor = createEditor()
      dispatchEditorDrop(editor, 4, {
        beforeDrop: () => {
          if (action === 'delete') editor.commands.deleteSelection()
          else editor.commands.updateAttributes('image', { width: '333' })
        },
      })
      expect(editor.state.doc.textContent).toBe('HeadingAfter')
      expect(images(editor)).toHaveLength(action === 'delete' ? 0 : 1)
      if (action === 'resize') expect(images(editor)[0].width).toBe('333')
    }
  )
})
