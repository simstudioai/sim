/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { initProseMirrorDoc, updateYFragment, ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createMarkdownEditorExtensions } from '../editor-extensions'
import { applyAgentStreamFrame, beginAgentStream, endAgentStream } from './apply-streamed-markdown'

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

describe('agent-stream applier', () => {
  it('relies on y-tiptap internals that still exist (upgrade guardrail)', () => {
    // beginAgentStream/applyAgentStreamFrame reach into y-tiptap internals (not public TipTap API):
    // `ySyncPluginKey`, `updateYFragment`, `initProseMirrorDoc`. A y-tiptap bump that renames or drops
    // any of them can pass typecheck yet break at runtime — assert their runtime shape here so an upgrade
    // fails loudly at test time instead of in production. Pinned to an exact y-tiptap version in
    // package.json; bump that pin and this guard together.
    expect(typeof updateYFragment).toBe('function')
    expect(typeof initProseMirrorDoc).toBe('function')
    expect(ySyncPluginKey).toBeDefined()
    expect(typeof ySyncPluginKey.getState).toBe('function')
  })

  it('keeps agent-streamed ops out of the undo stack while user edits stay undoable', () => {
    const { editor } = track(makeCollabEditor())

    const session = beginAgentStream(editor)!
    applyAgentStreamFrame(editor, session, '# Streamed\n\nAgent wrote this.')
    endAgentStream(session)
    // The streamed op relayed under a non-`ySyncPluginKey` origin, which the Collaboration UndoManager
    // does not track — so there is nothing to undo, and an undo must not revert the agent's content.
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

  it('a shadow reused after the live doc advanced duplicates content; a fresh one does not', () => {
    // The invariant behind the component's leadership-regain teardown: a shadow tracks only ITS OWN
    // reconciles, so once the live doc advances under another writer, REUSING that stale shadow re-emits
    // ops for content already present (duplication). Seeding a FRESH shadow from the current doc fixes it.
    const stale = track(makeCollabEditor())
    const staleSession = beginAgentStream(stale.editor)! // seeded from the empty base
    applyAgentStreamFrame(stale.editor, staleSession, 'Alpha paragraph.')
    // Another writer advances the live doc while this shadow is NOT looking (a handoff to an interim leader).
    stale.editor.commands.focus('end')
    stale.editor.commands.insertContent('\n\nBeta paragraph.')
    // Reusing the stale shadow (only knows "Alpha") to reconcile toward the full body re-inserts "Beta".
    applyAgentStreamFrame(
      stale.editor,
      staleSession,
      'Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.'
    )
    endAgentStream(staleSession)
    const staleText = stale.editor.getText()
    expect(staleText.match(/Beta paragraph/g)?.length).toBe(2) // duplicated — what the teardown prevents

    // Fresh shadow re-seeded from the CURRENT doc (what a regaining leader does after teardown) emits only
    // the genuine delta, so no content duplicates.
    const fresh = track(makeCollabEditor())
    const first = beginAgentStream(fresh.editor)!
    applyAgentStreamFrame(fresh.editor, first, 'Alpha paragraph.')
    fresh.editor.commands.focus('end')
    fresh.editor.commands.insertContent('\n\nBeta paragraph.')
    endAgentStream(first)
    const regained = beginAgentStream(fresh.editor)! // re-seeded from the advanced doc
    applyAgentStreamFrame(
      fresh.editor,
      regained,
      'Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.'
    )
    endAgentStream(regained)
    const freshText = fresh.editor.getText()
    expect(freshText.match(/Beta paragraph/g)?.length).toBe(1)
    expect(freshText).toContain('Gamma paragraph')
  })
})
