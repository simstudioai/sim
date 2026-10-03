/** @vitest-environment jsdom */
import { Editor, getSchema } from '@tiptap/core'
import { Collaboration } from '@tiptap/extension-collaboration'
import { afterEach, describe, expect, it } from 'vitest'
import { markdownToYDoc, yDocToMarkdown } from '@/lib/collab-doc/converter'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  editorNormalForm,
  parseMarkdownToDoc,
  serializeMarkdownBody,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

const schema = getSchema(createMarkdownContentExtensions())
const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const BLOCK_FIRST_ITEMS = [
  ['nested bullet', '- Before\n- - Child\n- Following'],
  ['ordered parent', '7. Before\n8. - Child\n9. Following'],
  ['deeply nested bullet', '- - - Child'],
  ['nested task child', '- - [x] Child'],
  ['task parent', '- [x] Parent\n  - - Child\n- [ ] Following'],
  ['blockquote', '- > Child'],
  ['heading', '- # Child'],
  ['fenced code', '- ```ts\n  const child = 1\n  ```'],
] as const

describe('Markdown list item schema', () => {
  it('keeps the empty parent item and its nested child between its siblings', () => {
    const doc = schema.nodeFromJSON(parseMarkdownToDoc('- Before\n- - Child\n- Following'))
    const list = doc.firstChild!
    expect(list.childCount).toBe(3)
    expect(list.child(0).textContent).toBe('Before')
    expect(list.child(1).child(0).type.name).toBe('paragraph')
    expect(list.child(1).child(0).textContent).toBe('')
    expect(list.child(1).child(1).type.name).toBe('bulletList')
    expect(list.child(1).child(1).textContent).toBe('Child')
    expect(list.child(2).textContent).toBe('Following')
  })

  it('serializes an empty opening bullet without the trailing space the lexer misreads', () => {
    expect(serializeMarkdownBody('- - Child')).toBe('-\n  - Child\n\n')
  })

  it.each(BLOCK_FIRST_ITEMS)(
    'retains the %s subtree when a collaborative editor mounts',
    (_label, markdown) => {
      const doc = markdownToYDoc(markdown)
      const editor = new Editor({
        extensions: [
          ...createMarkdownContentExtensions({}, { disableHistory: true }),
          Collaboration.configure({ document: doc }),
        ],
      })
      cleanups.push(() => {
        editor.destroy()
        doc.destroy()
      })

      expect(() => editor.state.doc.check()).not.toThrow()
      expect(editor.getJSON()).toEqual(schema.nodeFromJSON(editorNormalForm(markdown)).toJSON())
      expect(yDocToMarkdown(doc)).toBe(serializeMarkdownBody(markdown))
    }
  )
})
