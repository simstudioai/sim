/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { markdownToYDoc } from '@/lib/collab-doc/converter'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'

interface Peer {
  doc: Y.Doc
  editor: Editor
  updates: Uint8Array[]
}

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function pair(): { a: Peer; b: Peer } {
  document.elementFromPoint ??= () => null
  const seed = markdownToYDoc('## Todos\n\n- one\n- two\n- three')
  const make = (): Peer => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed))
    const awareness = new Awareness(doc)
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions({
        placeholder: '',
        collaboration: { doc, awareness, user: { name: 'User', color: '#ffffff' } },
      }),
    })
    const updates: Uint8Array[] = []
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') updates.push(update)
    })
    cleanups.push(() => {
      editor.destroy()
      awareness.destroy()
      doc.destroy()
    })
    return { doc, editor, updates }
  }
  const a = make()
  const b = make()
  seed.destroy()
  return { a, b }
}

function findText(editor: Editor, text: string): number {
  let position = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) position = pos
  })
  expect(position).toBeGreaterThan(-1)
  return position
}

function key(editor: Editor, name: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  )
}

/** Delivers independently authored changes, including patches arriving before their prerequisites. */
function reconnect(a: Peer, b: Peer, reversed: boolean): void {
  const changesA = a.updates.slice()
  const changesB = b.updates.slice()
  if (reversed) {
    changesA.reverse()
    changesB.reverse()
  }
  for (const update of changesA) Y.applyUpdate(b.doc, update, 'remote')
  for (const update of changesB) Y.applyUpdate(a.doc, update, 'remote')
  expect(a.editor.getJSON()).toEqual(b.editor.getJSON())
}

describe('list editing with delayed peer updates', () => {
  it.each([false, true])(
    'joining above a list retains every peer insertion (reordered=%s)',
    (reversed) => {
      const { a, b } = pair()
      for (const word of ['one', 'two', 'three']) {
        b.editor.commands.insertContentAt(findText(b.editor, word), 'PEER ')
      }
      a.editor.commands.setTextSelection(findText(a.editor, 'Todos') + 5)
      key(a.editor, 'Enter')
      a.editor.commands.insertContent('-')
      const { from, to } = a.editor.state.selection
      expect(
        a.editor.view.someProp('handleTextInput', (handler) =>
          handler(a.editor.view, from, to, ' ', () => a.editor.state.tr)
        )
      ).toBe(true)
      a.editor.commands.insertContent('new item')
      reconnect(a, b, reversed)

      for (const word of ['one', 'two', 'three']) {
        expect(a.editor.state.doc.textContent).toContain(`PEER ${word}`)
      }
      expect(a.editor.state.doc.textContent).toContain('new item')
    }
  )

  it('retains peer text when an empty middle item is removed without reparenting its siblings', () => {
    const { a, b } = pair()
    b.editor.commands.insertContentAt(findText(b.editor, 'one'), 'PEER ')
    a.editor.commands.setTextSelection(findText(a.editor, 'one') + 3)
    key(a.editor, 'Enter')
    const { $from } = a.editor.state.selection
    a.editor.commands.deleteRange({ from: $from.before(-1), to: $from.after(-1) })
    reconnect(a, b, true)

    expect(a.editor.state.doc.textContent).toContain('PEER one')
  })

  it('undoes a local bullet join without undoing received peer text', () => {
    const { a, b } = pair()
    const history: { undoManager: Y.UndoManager } = yUndoPluginKey.getState(a.editor.state)
    history.undoManager.clear()
    a.editor.commands.setTextSelection(findText(a.editor, 'Todos') + 5)
    key(a.editor, 'Enter')
    a.editor.commands.insertContent('-')
    const { from, to } = a.editor.state.selection
    a.editor.view.someProp('handleTextInput', (handler) =>
      handler(a.editor.view, from, to, ' ', () => a.editor.state.tr)
    )
    a.editor.commands.insertContent('new item')
    b.editor.commands.insertContentAt(findText(b.editor, 'one'), 'PEER ')
    reconnect(a, b, true)
    history.undoManager.stopCapturing()

    expect(a.editor.commands.undo()).toBe(true)
    reconnect(a, b, false)
    expect(a.editor.state.doc.textContent).toContain('PEER one')
    expect(a.editor.state.doc.textContent).not.toContain('new item')
  })

  /**
   * Keep the middle list intact until lifting can preserve delayed edits: the binding copies one
   * half of a split list into new CRDT identities. Convergence alone does not prove preservation.
   * https://github.com/yjs/y-prosemirror/blob/master/CAVEATS.md#node-splitting-merging-and-lifting
   */
  it.each([false, true])(
    'clearing a new middle item retains concurrent text in every sibling (reordered=%s)',
    (reversed) => {
      const { a, b } = pair()
      for (const word of ['one', 'two', 'three']) {
        b.editor.commands.insertContentAt(findText(b.editor, word), 'PEER ')
        expect(b.editor.state.doc.textContent).toContain(`PEER ${word}`)
      }
      a.editor.commands.setTextSelection(findText(a.editor, 'one') + 3)
      key(a.editor, 'Enter')
      key(a.editor, 'Enter')
      reconnect(a, b, reversed)

      for (const word of ['one', 'two', 'three']) {
        expect(a.editor.state.doc.textContent).toContain(`PEER ${word}`)
      }
    }
  )
})
