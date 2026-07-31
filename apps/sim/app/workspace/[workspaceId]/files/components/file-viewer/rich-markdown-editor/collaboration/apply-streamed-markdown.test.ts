/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createMarkdownEditorExtensions } from '../editor-extensions'
import { applyStreamedMarkdownToLiveDoc } from './apply-streamed-markdown'

beforeAll(() => {
  // jsdom does not implement elementFromPoint; the Placeholder extension's viewport tracking calls it
  // on view mount. Returning null makes ProseMirror's posAtCoords fall back gracefully.
  if (!document.elementFromPoint) {
    document.elementFromPoint = () => null
  }
})

/** A headless collaborative editor bound to a fresh Y.Doc — the same extension wiring the component uses. */
function makeCollabEditor() {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const editor = new Editor({
    extensions: createMarkdownEditorExtensions({
      placeholder: '',
      collaboration: {
        doc,
        awareness,
        user: { name: 'Tester', color: '#ffffff', clientId: doc.clientID },
      },
    }),
    content: '',
  })
  return { editor, doc, awareness }
}

const teardown: Array<() => void> = []
afterEach(() => {
  for (const fn of teardown.splice(0)) fn()
})

function track(t: { editor: Editor; doc: Y.Doc; awareness: Awareness }) {
  teardown.push(() => {
    t.editor.destroy()
    t.awareness.destroy()
    t.doc.destroy()
  })
  return t
}

describe('applyStreamedMarkdownToLiveDoc', () => {
  it('streams agent content into the live collaborative doc and broadcasts it as Yjs ops', () => {
    const { editor, doc } = track(makeCollabEditor())

    expect(applyStreamedMarkdownToLiveDoc(editor, '# Title\n\nHello world.')).toBe(true)
    expect(editor.getText()).toContain('Hello world')

    // The write lands as ops on the shared doc, so any peer receives it (this is what makes a
    // collaborator on /files see the stream without ever holding `streamingContent`).
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    expect(peer.getXmlFragment('default').toString()).toContain('Hello world')
    peer.destroy()
  })

  it('returns false when the doc is not yet bound (no ySync binding)', () => {
    // A plain editor with no collaboration has no ySync binding, so the applier reports "not ready"
    // rather than throwing — the streaming tick re-arms until the doc is seeded.
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions({ placeholder: '' }),
      content: '',
    })
    teardown.push(() => editor.destroy())
    expect(applyStreamedMarkdownToLiveDoc(editor, '# Nope')).toBe(false)
  })

  it('keeps agent-streamed ops out of the undo stack while user edits stay undoable', () => {
    const { editor } = track(makeCollabEditor())

    applyStreamedMarkdownToLiveDoc(editor, '# Streamed\n\nAgent wrote this.')
    // The streamed op used AGENT_STREAM_ORIGIN, which the Collaboration UndoManager does not track —
    // so there is nothing to undo, and an undo must not revert the agent's content.
    expect(editor.can().undo()).toBe(false)
    editor.commands.undo()
    expect(editor.getText()).toContain('Agent wrote this')

    // A genuine user edit IS captured (origin ySyncPluginKey) — proving the test isn't vacuous:
    // undo works, and it reverts only the user edit, leaving the agent content intact.
    editor.commands.focus('end')
    editor.commands.insertContent(' USER-TYPED')
    expect(editor.getText()).toContain('USER-TYPED')
    expect(editor.can().undo()).toBe(true)
    editor.commands.undo()
    expect(editor.getText()).not.toContain('USER-TYPED')
    expect(editor.getText()).toContain('Agent wrote this')
  })

  it('merges an agent write with a concurrent peer edit (minimal diff, no clobber)', () => {
    const { editor, doc } = track(makeCollabEditor())
    applyStreamedMarkdownToLiveDoc(editor, 'Alpha paragraph.\n\nBeta paragraph.')

    // A peer forks the current state and edits the FIRST paragraph directly on the shared type…
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
    const remoteFrag = remote.getXmlFragment('default')
    remote.transact(() => {
      const firstPara = remoteFrag.get(0) as Y.XmlElement
      const textNode = firstPara.get(0) as Y.XmlText
      textNode.insert(textNode.toString().length, ' EDITED')
    })

    // …while the agent rewrites the SECOND paragraph through the live editor binding.
    applyStreamedMarkdownToLiveDoc(editor, 'Alpha paragraph.\n\nBeta paragraph, expanded.')

    // Exchange updates both ways (as the relay would); a full-document replace would have clobbered
    // the peer's concurrent edit — a minimal `updateYFragment` diff preserves both.
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)))
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(remote)))

    const merged = doc.getXmlFragment('default').toString()
    expect(merged).toContain('EDITED')
    expect(merged).toContain('expanded')
    remote.destroy()
  })
})
