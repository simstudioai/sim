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

function pair(content = '## Todos\n\n- one\n- two\n- three', html = false): { a: Peer; b: Peer } {
  document.elementFromPoint ??= () => null
  const seed = markdownToYDoc(html ? '' : content)
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
  if (html) {
    a.editor.commands.setContent(content)
    Y.applyUpdate(seed, Y.encodeStateAsUpdate(a.doc))
    a.updates.length = 0
  }
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
  describe.each(['bullet', 'ordered', 'task'] as const)('%s list boundaries', (kind) => {
    it.each(
      [1, 2].flatMap((beforeCount) =>
        [false, true].flatMap((nested) =>
          [false, true].map((reversed) => ({ beforeCount, nested, reversed }))
        )
      )
    )(
      'retains both existing roots ($beforeCount items, nested=$nested, reversed=$reversed)',
      ({ beforeCount, nested, reversed }) => {
        const words = [...['one', 'two'].slice(0, beforeCount), 'three', 'four']
        const list = (items: string[], start: number) => {
          const tag = kind === 'ordered' ? 'ol' : 'ul'
          const attrs =
            kind === 'task'
              ? ' data-type="taskList"'
              : kind === 'ordered'
                ? ` start="${start}"`
                : ''
          const itemAttrs = kind === 'task' ? ' data-type="taskItem" data-checked="false"' : ''
          return `<${tag}${attrs}>${items.map((word) => `<li${itemAttrs}><p>${word}</p></li>`).join('')}</${tag}>`
        }
        const marker = kind === 'ordered' ? `${beforeCount + 1}.` : kind === 'task' ? '[ ]' : '-'
        const content = `${list(words.slice(0, beforeCount), 1)}<p>${marker}</p>${list(words.slice(beforeCount), beforeCount + 2)}`
        const { a, b } = pair(nested ? `<ul><li><p>parent</p>${content}</li></ul>` : content, true)
        for (const word of words) {
          b.editor.commands.insertContentAt(findText(b.editor, word), 'PEER ')
        }
        a.editor.commands.setTextSelection(findText(a.editor, marker) + marker.length)
        const { from, to } = a.editor.state.selection
        expect(
          a.editor.view.someProp('handleTextInput', (handler) =>
            handler(a.editor.view, from, to, ' ', () => a.editor.state.tr)
          )
        ).toBe(true)
        a.editor.commands.insertContent('new item')
        const container = nested ? a.editor.state.doc.firstChild!.firstChild! : a.editor.state.doc
        const listType =
          kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList'
        const lists = Array.from({ length: container.childCount }, (_, index) =>
          container.child(index)
        ).filter((node) => node.type.name === listType)
        expect(lists.map((node) => node.childCount)).toEqual([beforeCount + 1, 2])
        expect(a.editor.state.selection.$from.parent.textContent).toBe('new item')
        reconnect(a, b, reversed)
        for (const word of words) expect(a.editor.state.doc.textContent).toContain(`PEER ${word}`)
        expect(a.editor.state.doc.textContent).toContain('new item')
      }
    )
  })

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

  /**
   * The required empty paragraph before a nested list cannot be deleted in this schema. The current
   * Backspace remains a structural no-op: upstream lift/join instead discard delayed sibling edits.
   */
  describe.each(['bullet', 'ordered', 'task'] as const)(
    '%s empty parent with nested content',
    (kind) => {
      it.each([false, true])(
        'preserves delayed edits and a safe caret (reordered=%s)',
        (reversed) => {
          const tag = kind === 'ordered' ? 'ol' : 'ul'
          const listAttrs = kind === 'task' ? ' data-type="taskList"' : ''
          const itemAttrs = kind === 'task' ? ' data-type="taskItem" data-checked="false"' : ''
          const item = (content: string) => `<li${itemAttrs}>${content}</li>`
          const list = (content: string) => `<${tag}${listAttrs}>${content}</${tag}>`
          const { a, b } = pair(
            list(
              item('<p>before</p>') +
                item(`<p></p>${list(item('<p>child</p>'))}`) +
                item('<p>following</p>')
            ),
            true
          )
          a.editor.commands.setTextSelection(
            a.editor.state.doc.firstChild!.firstChild!.nodeSize + 3
          )
          for (const word of ['before', 'child', 'following']) {
            b.editor.commands.insertContentAt(findText(b.editor, word), `PEER-${word} `)
          }
          const expected = b.editor.getJSON()

          key(a.editor, 'Backspace')
          reconnect(a, b, reversed)

          expect(a.editor.getJSON()).toEqual(expected)
          expect(a.editor.state.selection.empty).toBe(true)
          expect(a.editor.state.selection.$from.parent.isTextblock).toBe(true)
        }
      )
    }
  )

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
  describe.each([
    { kind: 'bullet', content: '- one\n- two\n- three', listType: 'bulletList' },
    { kind: 'ordered', content: '7. one\n8. two\n9. three', listType: 'orderedList' },
    { kind: 'task', content: '- [x] one\n- [ ] two\n- [x] three', listType: 'taskList' },
  ])('$kind empty-item boundaries', ({ content, listType }) => {
    it.each(
      ['one', 'two'].flatMap((preceding) =>
        [false, true].map((reversed) => ({ preceding, reversed }))
      )
    )(
      'clearing a middle item after $preceding retains all peer edits (reordered=$reversed)',
      ({ preceding, reversed }) => {
        const { a, b } = pair(content)
        for (const word of ['one', 'two', 'three']) {
          b.editor.commands.insertContentAt(findText(b.editor, word), `PEER-${word} `)
        }
        const expectedList = b.editor.state.doc.firstChild!.toJSON()

        a.editor.commands.setTextSelection(findText(a.editor, preceding) + preceding.length)
        key(a.editor, 'Enter')
        expect(a.editor.state.selection.$from.parent.content.size).toBe(0)
        key(a.editor, 'Enter')
        expect(a.editor.state.selection.$from.parent.textContent).toBe(preceding)
        expect(a.editor.state.doc.firstChild!.childCount).toBe(3)
        reconnect(a, b, reversed)

        expect(a.editor.state.doc.firstChild!.type.name).toBe(listType)
        expect(a.editor.state.doc.firstChild!.toJSON()).toEqual(expectedList)
      }
    )

    it.each([false, true])(
      'exits a trailing empty item without losing peer edits (reordered=%s)',
      (reversed) => {
        const { a, b } = pair(content)
        for (const word of ['one', 'two', 'three']) {
          b.editor.commands.insertContentAt(findText(b.editor, word), `PEER-${word} `)
        }
        const expectedList = b.editor.state.doc.firstChild!.toJSON()

        a.editor.commands.setTextSelection(findText(a.editor, 'three') + 'three'.length)
        key(a.editor, 'Enter')
        key(a.editor, 'Enter')
        expect(a.editor.state.selection.$from.depth).toBe(1)
        expect(a.editor.state.selection.$from.parent.type.name).toBe('paragraph')
        a.editor.commands.insertContent('LOCAL AFTER LIST')
        reconnect(a, b, reversed)

        expect(a.editor.state.doc.firstChild!.type.name).toBe(listType)
        expect(a.editor.state.doc.firstChild!.toJSON()).toEqual(expectedList)
        expect(a.editor.state.doc.child(1).toJSON()).toEqual({
          type: 'paragraph',
          content: [{ type: 'text', text: 'LOCAL AFTER LIST' }],
        })
      }
    )
  })
})
