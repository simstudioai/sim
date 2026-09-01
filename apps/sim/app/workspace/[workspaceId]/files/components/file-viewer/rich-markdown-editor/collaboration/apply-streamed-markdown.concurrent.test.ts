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
 * logged for judgement. Run: bunx vitest run <thisfile> --disable-console-intercept
 */
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createMarkdownEditorExtensions } from '../editor-extensions'
import { parseMarkdownToDoc } from '../markdown-parse'
import { applyAgentStreamFrame, beginAgentStream, endAgentStream } from './apply-streamed-markdown'

beforeAll(() => {
  if (!document.elementFromPoint) document.elementFromPoint = () => null
})

function makeCollabEditor() {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const editor = new Editor({
    extensions: createMarkdownEditorExtensions({
      placeholder: '',
      collaboration: { doc, awareness, user: { name: 'U', color: '#fff', clientId: doc.clientID } },
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

describe('two-writer: peer edits while the agent streams', () => {
  it('SANITY: peers converge on seed and a plain peer edit with no agent activity', () => {
    const { A, B } = seededPair('# Title\n\nAlpha\n\nBeta')
    expect(peerInsertNear(B.editor, 'Alpha', 'PEER ')).toBe(true)
    expect(fragStr(A.doc)).toBe(fragStr(B.doc))
    expect(A.editor.state.doc.textContent).toContain('PEER Alpha')
  })

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

  it('OVERLAPPING: agent rewrites the exact paragraph the peer is editing (diagnostic + must converge)', () => {
    const { A, B } = seededPair('# Title\n\noriginal body text')
    const session = beginAgentStream(A.editor)!

    applyAgentStreamFrame(A.editor, session, '# Title\n\noriginal body text extended')
    // Peer edits the SAME paragraph the agent is rewriting.
    expect(peerInsertNear(B.editor, 'original', 'PEER ')).toBe(true)
    applyAgentStreamFrame(A.editor, session, '# Title\n\nagent fully rewrote this paragraph')
    endAgentStream(session)

    const textA = A.editor.state.doc.textContent
    console.log(`\n[OVERLAP] A: ${JSON.stringify(textA)}`)
    console.log(
      `[OVERLAP] converged=${fragStr(A.doc) === fragStr(B.doc)} peerSurvived=${textA.includes('PEER')} emptyParas=${emptyParas(A.editor)}`
    )

    expect(fragStr(A.doc)).toBe(fragStr(B.doc)) // convergence is non-negotiable even in conflict
    expect(emptyParas(A.editor)).toBe(0) // conflict must not leave stray empty paragraphs
    // peer survival here is CRDT-dependent — reported above, not hard-asserted.
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
