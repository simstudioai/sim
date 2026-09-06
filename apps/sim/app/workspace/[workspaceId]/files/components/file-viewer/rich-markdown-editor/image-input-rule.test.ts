/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { markdownToYDoc } from '@/lib/collab-doc/converter'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function createPeer(seed: Y.Doc) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed))
  const awareness = new Awareness(doc)
  const editor = new Editor({
    extensions: createMarkdownEditorExtensions({
      placeholder: '',
      collaboration: { doc, awareness, user: { name: 'User', color: '#ffffff' } },
    }),
    editorProps: { handleScrollToSelection: () => true },
  })
  cleanups.push(() => {
    editor.destroy()
    awareness.destroy()
    doc.destroy()
  })
  return { doc, editor }
}

/** Exercises the same input-rule ordering as character-by-character browser typing. */
function typeText(editor: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.view, from, to, character, () =>
        editor.state.tr.insertText(character, from, to)
      )
    )
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to))
  }
}

describe('typed images with the collaborative editor extensions', () => {
  it.each([
    { alt: 'Audit image', title: null },
    { alt: '', title: null },
    { alt: 'Logo', title: 'Brand' },
  ])('creates an image, not a bang plus a link ($alt, $title)', ({ alt, title }) => {
    const seed = markdownToYDoc('')
    const a = createPeer(seed)
    const b = createPeer(seed)
    seed.destroy()
    const source = `![${alt}](https://example.com/logo.png${title ? ` "${title}"` : ''})`
    typeText(a.editor, source)

    expect(a.editor.getJSON().content?.filter((node) => node.type === 'image')).toMatchObject([
      { type: 'image', attrs: { src: 'https://example.com/logo.png', alt, title } },
    ])
    expect(a.editor.getText()).not.toContain('!')
    expect(a.editor.getMarkdown().trim()).toBe(source)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    expect(b.editor.getJSON()).toEqual(a.editor.getJSON())
  })

  it('continues to create ordinary links during typing', () => {
    const seed = markdownToYDoc('')
    const { editor } = createPeer(seed)
    seed.destroy()
    typeText(editor, '[Audit link](https://example.com)')
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Audit link', marks: [{ type: 'link' }] }],
    })
  })
})
