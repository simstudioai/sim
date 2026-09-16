/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { undoDepth } from '@tiptap/pm/history'
import { DOMParser } from '@tiptap/pm/model'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  beginImageUploads,
  findImageUpload,
  findImageUploadRange,
  finishImageUpload,
  ImageUploadPlaceholders,
  removeImageUpload,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-upload'
import { createRichMarkdownPasteAdmission } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/paste-admission'

let editor: Editor
afterEach(() => editor?.destroy())

function mount(content = '<p>abcd</p>') {
  editor = new Editor({
    extensions: [...createMarkdownContentExtensions(), ImageUploadPlaceholders],
    content,
  })
  return editor
}

describe('image upload anchors', () => {
  it('rechecks the paste budget when an uploaded fragment completes after intervening edits', () => {
    const rejected = vi.fn()
    editor = new Editor({
      extensions: [
        ...createMarkdownContentExtensions(),
        ImageUploadPlaceholders,
        createRichMarkdownPasteAdmission({
          maxResultBytes: 100,
          maxResultCharacters: 100,
          getCurrentText: () => editor.getMarkdown(),
          onRejected: rejected,
        }),
      ],
      content: '<p>Seed</p>',
    })
    const [id] = beginImageUploads(editor, { from: 5, to: 5 }, ['image'])
    editor.commands.insertContentAt(1, 'x'.repeat(70))
    const before = editor.getJSON()
    const container = document.createElement('div')
    container.innerHTML = '<p>Pasted caption <img src="/new.png"></p>'
    const fragment = DOMParser.fromSchema(editor.schema).parseSlice(container)
    expect(finishImageUpload(editor, id, '/new.png', 'image', fragment)).toBe(false)
    expect(rejected).toHaveBeenCalledWith('paste')
    expect(editor.getJSON()).toEqual(before)
    expect(findImageUpload(editor, id)).toBeNull()
  })

  it.each([false, true])(
    'safely cancels an anchor replaced by a peer update (unrelated paragraph=%s)',
    (unrelated) => {
      const localDoc = new Y.Doc()
      const remoteDoc = new Y.Doc()
      const extensions = (doc: Y.Doc) => [
        ...createMarkdownContentExtensions({}, { disableHistory: true }),
        Collaboration.configure({ document: doc }),
        ImageUploadPlaceholders,
      ]
      editor = new Editor({ extensions: extensions(localDoc) })
      editor.commands.setContent('<p>before TARGET after</p><p>other</p>')
      Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(localDoc))
      const peer = new Editor({ extensions: extensions(remoteDoc) })
      try {
        const [id] = beginImageUploads(editor, { from: 8, to: 14 }, ['image.png'])
        const position = unrelated ? peer.state.doc.content.size - 1 : 10
        peer.commands.insertContentAt(position, 'PEER ')
        Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(remoteDoc))
        const updated = editor.getJSON()
        expect(updated).toEqual(peer.getJSON())
        expect(editor.getText()).toContain('PEER ')
        expect(findImageUploadRange(editor, id)).toBeNull()
        expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
        expect(editor.getJSON()).toEqual(updated)
      } finally {
        peer.destroy()
        editor.destroy()
        localDoc.destroy()
        remoteDoc.destroy()
      }
    }
  )

  it('replaces selected text only on success and never serializes the placeholder', () => {
    const editor = mount('<p>before REPLACE after</p>')
    const [id] = beginImageUploads(editor, { from: 8, to: 15 }, ['image.png'])
    expect(editor.state.doc.textContent).toBe('before REPLACE after')
    expect(undoDepth(editor.state)).toBe(0)
    expect(editor.getMarkdown()).not.toContain('Uploading')
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(true)
    expect(editor.getMarkdown()).toContain('![image](/image.png)')
    expect(editor.state.doc.textContent).not.toContain('REPLACE')
    expect(findImageUpload(editor, id)).toBeNull()
  })

  it('leaves a selected replacement intact when the upload fails or is cancelled', () => {
    const editor = mount('<p>before REPLACE after</p>')
    const [id] = beginImageUploads(editor, { from: 8, to: 15 }, ['image.png'])
    removeImageUpload(editor, id)
    expect(editor.state.doc.textContent).toBe('before REPLACE after')
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
    expect(undoDepth(editor.state)).toBe(0)
  })

  it('cancels replacement when Undo removes the selected content', () => {
    const editor = mount('<p>before after</p>')
    editor.commands.insertContentAt(8, 'REPLACE ')
    const [id] = beginImageUploads(editor, { from: 8, to: 15 }, ['image.png'])
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.textContent).toBe('before after')
    expect(findImageUpload(editor, id)).toBeNull()
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
  })

  it('undoes successful replacement in one step without reviving the pending upload', () => {
    const editor = mount('<p>before REPLACE after</p>')
    const [id] = beginImageUploads(editor, { from: 8, to: 15 }, ['image.png'])
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(true)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.textContent).toBe('before REPLACE after')
    expect(editor.getMarkdown()).not.toContain('/image.png')
    expect(findImageUpload(editor, id)).toBeNull()
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getMarkdown()).toContain('/image.png')
  })

  it.each(['text', 'marks', 'deletion'] as const)(
    'cancels the entire replacement batch when selected %s changes',
    (change) => {
      const editor = mount('<p>before REPLACE after</p>')
      const ids = beginImageUploads(editor, { from: 8, to: 15 }, ['first', 'second'])
      const transaction = editor.state.tr
      if (change === 'text') transaction.insertText('new', 10)
      else if (change === 'marks') transaction.addMark(9, 11, editor.schema.marks.bold.create())
      else transaction.delete(9, 11)
      editor.view.dispatch(transaction)
      const edited = editor.getJSON()
      for (const id of ids) {
        expect(findImageUpload(editor, id)).toBeNull()
        expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
      }
      expect(editor.getJSON()).toEqual(edited)
    }
  )

  it('maps a replacement through edits before it and excludes typing at either boundary', () => {
    const editor = mount('<p>before REPLACE after</p>')
    const [id] = beginImageUploads(editor, { from: 8, to: 15 }, ['image.png'])
    editor.view.dispatch(editor.state.tr.insertText('PREFIX ', 1))
    editor.view.dispatch(editor.state.tr.insertText('LEFT ', 15))
    editor.view.dispatch(editor.state.tr.insertText(' RIGHT', 27))
    expect(findImageUpload(editor, id)).toBe(20)
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(true)
    expect(editor.state.doc.textContent).toBe('PREFIX before LEFT  RIGHT after')
    expect(editor.getMarkdown()).not.toContain('REPLACE')
  })

  it('hands the mapped picker range to a new upload without reducing it to a caret', () => {
    const editor = mount('<p>before REPLACE after</p>')
    const [picker] = beginImageUploads(editor, { from: 8, to: 15 }, [''])
    editor.view.dispatch(editor.state.tr.insertText('PREFIX ', 1))
    const range = findImageUploadRange(editor, picker)
    expect(range).toEqual({ from: 15, to: 22 })
    removeImageUpload(editor, picker)
    if (!range) throw new Error('Expected a surviving picker range')
    const [upload] = beginImageUploads(editor, range, ['image.png'])
    expect(finishImageUpload(editor, upload, '/image.png', 'image')).toBe(true)
    expect(editor.state.doc.textContent).toBe('PREFIX before  after')
    expect(findImageUploadRange(editor, picker)).toBeNull()
  })

  it('maps the anchor through typing before it and keeps the current caret', () => {
    const editor = mount()
    const [id] = beginImageUploads(editor, { from: 3, to: 3 }, ['image.png'])
    editor.view.dispatch(editor.state.tr.insertText('PREFIX ', 1))
    const position = findImageUpload(editor, id)
    expect(position).toBe(10)
    editor.commands.setTextSelection(2)
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(true)
    expect(editor.state.selection.from).toBe(2)
    expect(editor.state.doc.firstChild?.textContent).toBe('PREFIX ab')
    expect(editor.state.doc.child(1).type.name).toBe('image')
    expect(editor.state.doc.lastChild?.textContent).toBe('cd')
  })

  it('drops uploads whose surrounding content was deleted', () => {
    const editor = mount()
    const [id] = beginImageUploads(editor, { from: 3, to: 3 }, ['image.png'])
    editor.view.dispatch(editor.state.tr.delete(1, 5))
    expect(findImageUpload(editor, id)).toBeNull()
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
    expect(editor.getMarkdown()).not.toContain('/image.png')
  })

  it('maps every queued upload before any file finishes and preserves their order', () => {
    const editor = mount()
    const ids = beginImageUploads(editor, { from: 3, to: 3 }, ['first', 'second'])
    editor.view.dispatch(editor.state.tr.insertText('prefix', 1))
    for (const [index, id] of ids.entries()) {
      expect(finishImageUpload(editor, id, `/image-${index}.png`, String(index))).toBe(true)
    }
    const sources: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') sources.push(node.attrs.src)
    })
    expect(sources).toEqual(['/image-0.png', '/image-1.png'])
  })

  it('replaces a batch selection only once, even when the first upload fails', () => {
    const editor = mount('<p>before REPLACE after</p>')
    const ids = beginImageUploads(editor, { from: 8, to: 15 }, ['failed', 'second', 'third'])
    removeImageUpload(editor, ids[0])
    expect(editor.state.doc.textContent).toBe('before REPLACE after')
    for (const [index, id] of ids.slice(1).entries()) {
      expect(finishImageUpload(editor, id, `/image-${index}.png`, String(index))).toBe(true)
    }
    const sources: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') sources.push(node.attrs.src)
    })
    expect(sources).toEqual(['/image-0.png', '/image-1.png'])
    expect(editor.state.doc.textContent).toBe('before  after')
  })

  it('keeps queued images in an empty paragraph after the first image replaces that paragraph', () => {
    const editor = mount('<p></p>')
    const ids = beginImageUploads(editor, editor.state.selection, ['first', 'second'])
    for (const [index, id] of ids.entries()) {
      expect(finishImageUpload(editor, id, `/image-${index}.png`, String(index))).toBe(true)
    }
    expect(editor.state.doc.childCount).toBe(3)
    expect(editor.state.doc.firstChild?.attrs.src).toBe('/image-0.png')
    expect(editor.state.doc.child(1).attrs.src).toBe('/image-1.png')
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph')
  })

  it('does not add a document undo entry for a collapsed pending upload', () => {
    const editor = mount()
    const [id] = beginImageUploads(editor, { from: 3, to: 3 }, ['image.png'])
    expect(undoDepth(editor.state)).toBe(0)
    expect(editor.commands.undo()).toBe(false)
    expect(findImageUpload(editor, id)).toBe(3)
    editor.view.dom.querySelector<HTMLButtonElement>('button')?.click()
    expect(findImageUpload(editor, id)).toBeNull()
    expect(editor.state.doc.textContent).toBe('abcd')
  })

  it('cancels failed uploads without modifying document content', () => {
    const editor = mount()
    const [id] = beginImageUploads(editor, { from: 3, to: 3 }, ['image.png'])
    removeImageUpload(editor, id)
    expect(findImageUpload(editor, id)).toBeNull()
    expect(editor.state.doc.textContent).toBe('abcd')
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
  })

  it('cancels insertion without claiming to cancel the workspace upload', () => {
    const editor = mount()
    const [id] = beginImageUploads(editor, { from: 3, to: 3 }, ['image.png'])
    const cancel = editor.view.dom.querySelector<HTMLButtonElement>('button')
    expect(cancel?.textContent).toBe('Cancel insertion')
    expect(cancel?.getAttribute('aria-label')).toBe('Cancel insertion of image.png')
    expect(cancel?.title).toBe('The file may still finish uploading to the workspace.')
    expect(cancel?.classList.contains('focus-visible:outline-2')).toBe(true)
    expect(cancel?.classList.contains('focus-visible:outline-[var(--selection)]')).toBe(true)
    cancel?.click()
    expect(findImageUpload(editor, id)).toBeNull()
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
    expect(editor.state.doc.textContent).toBe('abcd')
    expect(undoDepth(editor.state)).toBe(0)
  })

  it('leaves Enter on the cancel button to native activation instead of editing the document', () => {
    const editor = mount('<p>before REPLACE after</p>')
    document.body.append(editor.view.dom)
    const before = editor.getJSON()
    const [id] = beginImageUploads(editor, { from: 8, to: 15 }, ['image.png'])
    const cancel = editor.view.dom.querySelector<HTMLButtonElement>('button')!
    cancel.focus()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    cancel.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    expect(editor.getJSON()).toEqual(before)
    cancel.click()
    expect(document.activeElement).toBe(editor.view.dom)
    expect(findImageUpload(editor, id)).toBeNull()
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
    expect(editor.getJSON()).toEqual(before)
    editor.view.dom.remove()
  })

  it('does not mutate a destroyed or newly read-only editor', () => {
    const editor = mount()
    const [id] = beginImageUploads(editor, { from: 3, to: 3 }, ['image.png'])
    editor.setEditable(false)
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
    editor.destroy()
    expect(() => removeImageUpload(editor, id)).not.toThrow()
    expect(finishImageUpload(editor, id, '/image.png', 'image')).toBe(false)
  })
})
