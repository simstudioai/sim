/** @vitest-environment jsdom */
import { Editor, type EditorOptions } from '@tiptap/core'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { markdownToYDoc } from '@/lib/collab-doc/converter'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { isImageNode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-node'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.useRealTimers()
})

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
    inputText(editor, character)
  }
}

function inputText(
  editor: Editor,
  text: string,
  { from, to }: { from: number; to: number } = editor.state.selection
): void {
  const handled = editor.view.someProp('handleTextInput', (handler) =>
    handler(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to))
  )
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to))
}

function createEditors(
  collaborative: boolean,
  content: string,
  options: Partial<EditorOptions> = {}
) {
  if (collaborative) {
    const seed = markdownToYDoc('')
    const a = createPeer(seed)
    const b = createPeer(seed)
    seed.destroy()
    a.editor.commands.setContent(content)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    return {
      editor: a.editor,
      assertSynced: () => {
        Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
        expect(b.editor.getJSON()).toEqual(a.editor.getJSON())
      },
    }
  }
  const editor = new Editor({
    extensions: createMarkdownEditorExtensions({ placeholder: '' }),
    content,
    editorProps: { handleScrollToSelection: () => true },
    ...options,
  })
  cleanups.push(() => editor.destroy())
  return { editor, assertSynced: () => {} }
}

function selectText(editor: Editor, text: string) {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) from = pos + node.text.indexOf(text)
  })
  expect(from).toBeGreaterThanOrEqual(0)
  editor.commands.setTextSelection({ from, to: from + text.length })
}

const IMAGE_SOURCE = '![Audit image](https://example.com/logo.png "Brand")'
const INPUT_CHUNKS = [
  { name: 'characters', chunks: Array.from(IMAGE_SOURCE) },
  { name: 'whole syntax', chunks: [IMAGE_SOURCE] },
  { name: 'closing delimiter', chunks: [IMAGE_SOURCE.slice(0, -1), ')'] },
  { name: 'alt chunk', chunks: [IMAGE_SOURCE.slice(0, 6), IMAGE_SOURCE.slice(6)] },
  { name: 'after bang', chunks: ['!', IMAGE_SOURCE.slice(1)] },
]

describe.each([false, true])('image input rules (collaborative=%s)', (collaborative) => {
  describe.each([
    { name: 'paragraph', html: '<p>TARGET</p>' },
    { name: 'heading', html: '<h2>TARGET</h2>' },
    { name: 'blockquote', html: '<blockquote><p>TARGET</p></blockquote>' },
    { name: 'list', html: '<ul><li><p>TARGET</p></li></ul>' },
  ])('$name', ({ html }) => {
    it.each(INPUT_CHUNKS)('converts $name without dropping text', ({ chunks }) => {
      const { editor, assertSynced } = createEditors(
        collaborative,
        `<p>Earlier document</p>${html}<p>Later document</p>`
      )
      selectText(editor, 'TARGET')
      for (const chunk of chunks) inputText(editor, chunk)
      const images: unknown[] = []
      editor.state.doc.descendants((node) => {
        if (isImageNode(node)) images.push(node.attrs)
      })
      expect(images).toMatchObject([
        { src: 'https://example.com/logo.png', alt: 'Audit image', title: 'Brand' },
      ])
      expect(editor.getText()).not.toContain('![')
      expect(editor.getText()).not.toContain('TARGET')
      expect(editor.getText()).toContain('Earlier document')
      expect(editor.getText()).toContain('Later document')
      expect(editor.getMarkdown()).toContain(IMAGE_SOURCE)
      assertSynced()
    })
  })
})

describe.each([
  { name: 'image', extension: 'image', source: '![Audit image](https://example.com/logo.png)' },
  { name: 'link', extension: 'markdownLinkInputRule', source: '[Audit link](https://example.com)' },
])('$name input-rule event boundaries', ({ name, extension, source }) => {
  function assertConverted(editor: Editor) {
    expect(editor.getHTML()).toContain(
      name === 'image' ? 'src="https://example.com/logo.png"' : 'href="https://example.com"'
    )
    expect(editor.getText()).not.toContain(source)
  }

  it.each([false, true])(
    'replaces a marked selection and preserves the incoming prefix (collaborative=%s)',
    (collaborative) => {
      const selected = `oldpre ${source.slice(0, -1)}${' obsolete'.repeat(20)}`
      const { editor, assertSynced } = createEditors(
        collaborative,
        `<p><strong>Before </strong>${selected}<em> After</em></p>`
      )
      selectText(editor, selected)
      inputText(editor, `newpre ${source}`)
      assertConverted(editor)
      expect(editor.getText()).toContain('newpre ')
      expect(editor.getText()).not.toContain('oldpre')
      expect(editor.getText()).not.toContain('obsolete')
      expect(editor.getHTML()).toContain('<strong>Before </strong>')
      expect(editor.getHTML()).toContain('<em> After</em>')
      assertSynced()
      expect(editor.commands.undoInputRule()).toBe(true)
      expect(editor.getText()).toBe(`Before newpre ${source} After`)
      assertSynced()
    }
  )

  it('uses the event range rather than an unrelated current selection', () => {
    const { editor } = createEditors(false, '<p>oldpre ![a](src</p><p>After</p>')
    selectText(editor, 'After')
    inputText(editor, `newpre ${source}`, { from: 1, to: 1 + 'oldpre ![a](src'.length })
    assertConverted(editor)
    expect(editor.getText()).toContain('newpre ')
    expect(editor.getText()).not.toContain('oldpre')
    expect(editor.getText()).toContain('After')
  })

  it.each(['<pre><code>TARGET</code></pre>', '<p><code>TARGET</code></p>'])(
    'leaves code literal in %s',
    (content) => {
      const { editor } = createEditors(false, content)
      selectText(editor, 'TARGET')
      inputText(editor, source)
      expect(editor.state.doc.firstChild?.textContent).toBe(source)
      expect(editor.getHTML()).not.toContain('<img')
      expect(editor.getHTML()).not.toContain('<a ')
    }
  )

  it('converts completed composition without inserting its text twice', () => {
    vi.useFakeTimers()
    const { editor } = createEditors(false, '<p>TARGET</p><p>After</p>')
    selectText(editor, 'TARGET')
    const composing = vi.spyOn(editor.view, 'composing', 'get').mockReturnValue(true)
    inputText(editor, `Prefix ${source}`)
    expect(editor.getText()).toBe(`Prefix ${source}\n\nAfter`)
    composing.mockRestore()
    editor.view.someProp('handleDOMEvents', (handlers) =>
      handlers.compositionend?.(editor.view, new CompositionEvent('compositionend'))
    )
    vi.runOnlyPendingTimers()
    assertConverted(editor)
    expect(editor.getText()).toContain('Prefix ')
    expect(editor.commands.undoInputRule()).toBe(true)
    expect(editor.getText()).toBe(`Prefix ${source}\n\nAfter`)
  })

  it('converts insertContent applyInputRules without reinserting materialized text', () => {
    vi.useFakeTimers()
    const { editor } = createEditors(false, '<p>TARGET</p><p>After</p>')
    selectText(editor, 'TARGET')
    editor.commands.insertContent(`Prefix ${source}`, { applyInputRules: true })
    vi.runOnlyPendingTimers()
    assertConverted(editor)
    expect(editor.getText()).toContain('Prefix ')
    expect(editor.getText()).toContain('After')
    expect(editor.commands.undoInputRule()).toBe(true)
    expect(editor.getText()).toBe(`Prefix ${source}\n\nAfter`)
  })

  it('undoes a collaborative conversion without removing peer text', () => {
    const seed = markdownToYDoc('TARGET\n\nAfter')
    const a = createPeer(seed)
    const b = createPeer(seed)
    seed.destroy()
    selectText(a.editor, 'TARGET')
    yUndoPluginKey.getState(a.editor.state).undoManager.stopCapturing()
    inputText(a.editor, `Prefix ${source}`)
    assertConverted(a.editor)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    selectText(b.editor, 'After')
    b.editor.commands.insertContent('Peer text')
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc))
    expect(a.editor.commands.undo()).toBe(true)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    expect(a.editor.getText()).toBe('TARGET\n\nPeer text')
    expect(b.editor.getJSON()).toEqual(a.editor.getJSON())
    expect(a.editor.commands.redo()).toBe(true)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    assertConverted(a.editor)
    expect(a.editor.getText()).toContain('Peer text')
    expect(b.editor.getJSON()).toEqual(a.editor.getJSON())
  })
})

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

  it('leaves refused link schemes literal and clears the previous input event', () => {
    const { editor } = createEditors(false, '<p>TARGET</p><p>After</p>')
    selectText(editor, 'TARGET')
    inputText(editor, '[Unsafe](javascript:alert)')
    expect(editor.getText()).toContain('[Unsafe](javascript:alert)')
    selectText(editor, 'After')
    inputText(editor, '[Safe](https://example.com)')
    expect(editor.getText()).toBe('[Unsafe](javascript:alert)\n\nSafe')
    expect(editor.getHTML()).toContain('href="https://example.com"')
  })
})
