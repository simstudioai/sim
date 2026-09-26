/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { initProseMirrorDoc, updateYFragment, ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createMarkdownEditorExtensions } from '../editor-extensions'
import { parseMarkdownToDoc } from '../markdown-parse'
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

/**
 * @vitest-environment jsdom
 *
 * Two-writer evaluation: does a PEER editing the shared doc WHILE the agent streams cause corruption,
 * clobbering, duplication, or stray empty paragraphs? The agent applies via the real
 * `beginAgentStream`/`applyAgentStreamFrame` path (a shadow doc diffed with `updateYFragment`, seeded
 * once and never shown the peer's edits). A second editor is wired as a genuine Yjs peer (bidirectional
 * update forwarding), so this reproduces the production two-client scenario, not a mock.
 *
 * Convergence is a hard invariant everywhere (CRDT MUST converge). Peer-edit survival is hard-asserted
 * only for the NON-overlapping case (an agent that appends must not clobber an unrelated peer edit); for
 * the overlapping case it is diagnostic (CRDT last-writer semantics are acceptable there), so those are
 * logged for judgement. Run: bun run --cwd apps/sim test <thisfile> --disable-console-intercept
 */
describe('two-writer: peer edits while the agent streams', () => {
  beforeAll(() => {
    if (!document.elementFromPoint) document.elementFromPoint = () => null
  })

  function makeCollabEditor() {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions({
        placeholder: '',
        collaboration: {
          doc,
          awareness,
          user: { name: 'U', color: '#fff', clientId: doc.clientID },
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

  /** Wire two Y.Docs as real peers: forward each update to the other, origin-guarded to avoid echo. */
  function wirePeers(a: Y.Doc, b: Y.Doc) {
    const A2B = Symbol('a->b')
    const B2A = Symbol('b->a')
    a.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== B2A) Y.applyUpdate(b, u, A2B)
    })
    b.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== A2B) Y.applyUpdate(a, u, B2A)
    })
  }

  /** Seed editor A with markdown (through the real parse), then bring up B as a synced peer. */
  function seededPair(markdown: string) {
    const A = track(makeCollabEditor())
    A.editor.commands.setContent(parseMarkdownToDoc(markdown), { contentType: 'json' })
    const B = track(makeCollabEditor())
    Y.applyUpdate(B.doc, Y.encodeStateAsUpdate(A.doc))
    wirePeers(A.doc, B.doc)
    return { A, B }
  }

  /** A peer edit: insert `text` at the start of the first text node containing `needle`. */
  function peerInsertNear(editor: Editor, needle: string, text: string): boolean {
    let pos: number | null = null
    editor.state.doc.descendants((node, p) => {
      if (pos !== null) return false
      if (node.isText && node.text?.includes(needle)) pos = p + node.text.indexOf(needle)
    })
    if (pos === null) return false
    return editor.commands.insertContentAt(pos, text)
  }

  function fragStr(doc: Y.Doc): string {
    return doc.getXmlFragment('default').toString()
  }
  function count(hay: string, needle: string): number {
    return hay.split(needle).length - 1
  }
  function emptyParas(editor: Editor): number {
    let n = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'paragraph' && node.childCount === 0) n++
    })
    return n
  }

  it('NON-OVERLAPPING: agent appends at the bottom while the peer edits the top — peer edit MUST survive', () => {
    const { A, B } = seededPair('# Title\n\nAlpha\n\nBeta')
    const session = beginAgentStream(A.editor)!

    // Frame 1: agent appends Gamma (region far from the peer's target).
    applyAgentStreamFrame(A.editor, session, '# Title\n\nAlpha\n\nBeta\n\nGamma')
    // Peer edits the TOP paragraph mid-stream (the agent never touches or knows about this).
    expect(peerInsertNear(B.editor, 'Alpha', 'PEER ')).toBe(true)
    // Frames 2-3: agent keeps appending. Its bodies say "Alpha" (no PEER) — the test is whether the
    // (aggressive) updateYFragment re-emits/clobbers the unchanged Alpha paragraph.
    applyAgentStreamFrame(A.editor, session, '# Title\n\nAlpha\n\nBeta\n\nGamma\n\nDelta')
    applyAgentStreamFrame(
      A.editor,
      session,
      '# Title\n\nAlpha\n\nBeta\n\nGamma\n\nDelta\n\nEpsilon'
    )
    endAgentStream(session)

    const textA = A.editor.state.doc.textContent
    console.log(`\n[NON-OVERLAP] A: ${JSON.stringify(textA)}`)
    console.log(
      `[NON-OVERLAP] converged=${fragStr(A.doc) === fragStr(B.doc)} peerCount=${count(textA, 'PEER ')} emptyParas=${emptyParas(A.editor)}`
    )

    expect(fragStr(A.doc)).toBe(fragStr(B.doc)) // CRDT convergence
    expect(count(textA, 'PEER ')).toBe(1) // peer edit survives, exactly once (no clobber, no dup)
    expect(textA).toContain('Epsilon') // agent's stream landed
    expect(textA).toContain('Beta') // untouched content intact
    expect(emptyParas(A.editor)).toBe(0) // no stray empties from the merge
  })

  it('POSITION DRIFT: agent inserts a paragraph ABOVE while the peer edits the paragraph BELOW', () => {
    // The exact scenario relative-position anchoring is meant to protect: the agent shifts positions by
    // inserting content above the region the peer is editing. Without anchoring, an offset-based writer
    // would misplace the edit; a whole-doc CRDT diff should not.
    const { A, B } = seededPair('# Title\n\nAlpha\n\nBeta')
    const session = beginAgentStream(A.editor)!

    applyAgentStreamFrame(A.editor, session, '# Title\n\nAlpha\n\nMIDDLE\n\nBeta')
    // Peer edits Beta, which just shifted down by the agent's inserted MIDDLE paragraph.
    expect(peerInsertNear(B.editor, 'Beta', 'PEER ')).toBe(true)
    applyAgentStreamFrame(A.editor, session, '# Title\n\nAlpha\n\nMIDDLE\n\nMIDDLE2\n\nBeta')
    endAgentStream(session)

    const textA = A.editor.state.doc.textContent
    console.log(`\n[POS-DRIFT] A: ${JSON.stringify(textA)}`)
    console.log(
      `[POS-DRIFT] converged=${fragStr(A.doc) === fragStr(B.doc)} peerCount=${count(textA, 'PEER ')} peerOnBeta=${textA.includes('PEER Beta')} emptyParas=${emptyParas(A.editor)}`
    )

    expect(fragStr(A.doc)).toBe(fragStr(B.doc)) // convergence
    expect(count(textA, 'PEER ')).toBe(1) // no duplication
    expect(textA).toContain('PEER Beta') // peer edit stayed attached to Beta despite the insert above
    expect(textA).toContain('MIDDLE2') // agent's inserts landed
    expect(emptyParas(A.editor)).toBe(0)
  })

  it('FULL REWRITE: peer edits original content that the agent then deletes in a full rewrite', () => {
    const { A, B } = seededPair('# Title\n\nAlpha\n\nBeta\n\nGamma')
    const session = beginAgentStream(A.editor)!

    // Peer edits Beta WHILE it still exists — genuinely concurrent with the impending rewrite.
    // (Asserting the insert landed guards against a false-green where the target was already gone.)
    expect(peerInsertNear(B.editor, 'Beta', 'PEER ')).toBe(true)
    // Agent replaces the WHOLE doc across two frames, deleting Alpha/Beta/Gamma.
    applyAgentStreamFrame(A.editor, session, '# Report\n\nOne\n\nTwo')
    applyAgentStreamFrame(A.editor, session, '# Report\n\nOne\n\nTwo\n\nThree')
    endAgentStream(session)

    const textA = A.editor.state.doc.textContent
    console.log(`\n[FULL-REWRITE] A: ${JSON.stringify(textA)}`)
    console.log(
      `[FULL-REWRITE] converged=${fragStr(A.doc) === fragStr(B.doc)} peerCount=${count(textA, 'PEER ')} oneCount=${count(textA, 'One')} threeCount=${count(textA, 'Three')} emptyParas=${emptyParas(A.editor)}`
    )

    expect(fragStr(A.doc)).toBe(fragStr(B.doc)) // convergence
    expect(count(textA, 'One')).toBe(1) // agent content not duplicated by the concurrent merge
    expect(count(textA, 'Three')).toBe(1)
    expect(emptyParas(A.editor)).toBe(0) // no stray empties from a delete/insert conflict
    // The peer's insert is NOT lost when the rewrite deletes its surrounding paragraph: Yjs preserves
    // the inserted text and reattaches it to the nearest surviving anchor (it relocates into the
    // rewritten content rather than vanishing). What matters is that it survives exactly once — never
    // duplicated, never silently dropped.
    expect(count(textA, 'PEER ')).toBe(1)
  })
})
