/**
 * @vitest-environment jsdom
 *
 * Integration coverage for the collaborative agent-streaming surface with all the moving pieces:
 * multiple peers, undo isolation, the durable persist→reopen round-trip, empty-collapse on the live
 * streaming path, and a late joiner. Editors are wired as genuine Yjs peers (mesh update forwarding).
 * This exercises the CRDT/merge/convert LOGIC deterministically; it does NOT cover the realtime socket
 * transport, RAF-paced stream loop, or real browser timing (those need a live 2-browser E2E harness).
 * Run: bunx vitest run <thisfile> --disable-console-intercept
 */
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { markdownToYDoc, yDocToMarkdown } from '@/lib/collab-doc/converter'
import { createMarkdownEditorExtensions } from '../editor-extensions'
import { parseMarkdownToDoc } from '../markdown-parse'
import { applyAgentStreamFrame, beginAgentStream, endAgentStream } from './apply-streamed-markdown'

beforeAll(() => {
  if (!document.elementFromPoint) document.elementFromPoint = () => null
})

const teardown: Array<() => void> = []
afterEach(() => {
  for (const fn of teardown.splice(0)) fn()
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
  const t = { editor, doc, awareness }
  teardown.push(() => {
    editor.destroy()
    awareness.destroy()
    doc.destroy()
  })
  return t
}

/** Forward every local/agent update from each doc to all others (origin-guarded), a full mesh. */
function wireMesh(docs: Y.Doc[]) {
  const MESH = Symbol('mesh')
  for (const d of docs) {
    d.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === MESH) return
      for (const other of docs) if (other !== d) Y.applyUpdate(other, u, MESH)
    })
  }
}

function peerInsertNear(editor: Editor, needle: string, text: string): boolean {
  let pos: number | null = null
  editor.state.doc.descendants((node, p) => {
    if (pos !== null) return false
    if (node.isText && node.text?.includes(needle)) pos = p + node.text.indexOf(needle)
  })
  if (pos === null) return false
  return editor.commands.insertContentAt(pos, text)
}

const fragStr = (doc: Y.Doc) => doc.getXmlFragment('default').toString()
const countText = (hay: string, needle: string) => hay.split(needle).length - 1
function emptyParas(editor: Editor): number {
  let n = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'paragraph' && node.childCount === 0) n++
  })
  return n
}

describe('collab streaming integration — moving pieces', () => {
  it('THREE-WAY: agent + two peers editing different regions all converge, both peer edits survive', () => {
    const A = makeCollabEditor()
    A.editor.commands.setContent(parseMarkdownToDoc('# Title\n\nAlpha\n\nBeta\n\nGamma'), {
      contentType: 'json',
    })
    const B = makeCollabEditor()
    const C = makeCollabEditor()
    Y.applyUpdate(B.doc, Y.encodeStateAsUpdate(A.doc))
    Y.applyUpdate(C.doc, Y.encodeStateAsUpdate(A.doc))
    wireMesh([A.doc, B.doc, C.doc])

    const session = beginAgentStream(A.editor)!
    applyAgentStreamFrame(A.editor, session, '# Title\n\nAlpha\n\nBeta\n\nGamma\n\nDelta')
    expect(peerInsertNear(B.editor, 'Alpha', 'B_EDIT ')).toBe(true) // peer B edits the top
    expect(peerInsertNear(C.editor, 'Gamma', 'C_EDIT ')).toBe(true) // peer C edits the bottom
    applyAgentStreamFrame(
      A.editor,
      session,
      '# Title\n\nAlpha\n\nBeta\n\nGamma\n\nDelta\n\nEpsilon'
    )
    endAgentStream(session)

    const textA = A.editor.state.doc.textContent
    console.log(`\n[3-WAY] A: ${JSON.stringify(textA)}`)
    console.log(
      `[3-WAY] converged=${fragStr(A.doc) === fragStr(B.doc) && fragStr(B.doc) === fragStr(C.doc)} B_EDIT=${countText(textA, 'B_EDIT ')} C_EDIT=${countText(textA, 'C_EDIT ')} empty=${emptyParas(A.editor)}`
    )

    expect(fragStr(A.doc)).toBe(fragStr(B.doc))
    expect(fragStr(B.doc)).toBe(fragStr(C.doc))
    expect(countText(textA, 'B_EDIT ')).toBe(1)
    expect(countText(textA, 'C_EDIT ')).toBe(1)
    expect(textA).toContain('Epsilon')
    expect(emptyParas(A.editor)).toBe(0)
  })

  it('UNDO ISOLATION: a peer undo reverts only the peer’s own edit, never the agent’s stream', () => {
    const A = makeCollabEditor()
    A.editor.commands.setContent(parseMarkdownToDoc('# Title\n\nbase'), { contentType: 'json' })
    const B = makeCollabEditor()
    Y.applyUpdate(B.doc, Y.encodeStateAsUpdate(A.doc))
    wireMesh([A.doc, B.doc])

    expect(peerInsertNear(B.editor, 'base', 'PEER_UNDOABLE ')).toBe(true) // peer's own edit (undo stack)
    const session = beginAgentStream(A.editor)!
    applyAgentStreamFrame(
      A.editor,
      session,
      '# Title\n\nPEER_UNDOABLE base\n\nagent added this line'
    )
    endAgentStream(session)

    const undid = B.editor.commands.undo()
    const textB = B.editor.state.doc.textContent
    console.log(`\n[UNDO] undoRan=${undid} afterUndo=${JSON.stringify(textB)}`)

    expect(fragStr(A.doc)).toBe(fragStr(B.doc)) // still converged after undo
    expect(textB).toContain('agent added this line') // agent content NOT undone by the peer
    expect(textB).not.toContain('PEER_UNDOABLE') // peer's own edit was undone
  })

  it('PERSIST ROUND-TRIP: stream → serialize to durable markdown → reopen yields the same content, no empties', () => {
    const A = makeCollabEditor()
    const session = beginAgentStream(A.editor)!
    applyAgentStreamFrame(A.editor, session, '# Report\n\n## Section 1\n\nbody one')
    applyAgentStreamFrame(
      A.editor,
      session,
      '# Report\n\n## Section 1\n\nbody one\n\n## Section 2\n\nbody two'
    )
    endAgentStream(session)

    const durable = yDocToMarkdown(A.doc) // server-side projection to durable markdown
    const reopened = markdownToYDoc(durable) // cold reopen from durable
    const reopenedMd = yDocToMarkdown(reopened)
    const blankRuns = (durable.match(/\n{3,}/g) ?? []).length
    console.log(`\n[ROUND-TRIP] durable=${JSON.stringify(durable)}`)
    console.log(`[ROUND-TRIP] reopenStable=${reopenedMd === durable} blankRuns=${blankRuns}`)

    expect(durable).toContain('Section 1')
    expect(durable).toContain('Section 2')
    expect(durable).toContain('body two')
    expect(blankRuns).toBe(0) // no pathological blank runs in the persisted markdown
    expect(reopenedMd).toBe(durable) // reopen is a fixed point (stable)
    reopened.destroy()
  })

  it('EMPTY-COLLAPSE ON THE STREAM PATH: an agent body with a huge blank run does not strand empties', () => {
    const A = makeCollabEditor()
    A.editor.commands.setContent(parseMarkdownToDoc('# Title\n\nintro'), { contentType: 'json' })
    const session = beginAgentStream(A.editor)!
    // The agent emits a pathological blank run between two blocks (the original incident's shape).
    applyAgentStreamFrame(A.editor, session, `# Title\n\nintro${'\n'.repeat(400)}tail paragraph`)
    endAgentStream(session)

    console.log(
      `\n[STREAM-COLLAPSE] text=${JSON.stringify(A.editor.state.doc.textContent)} empty=${emptyParas(A.editor)}`
    )
    expect(emptyParas(A.editor)).toBe(0) // collapse protects the live streaming path, not just static open
    expect(A.editor.state.doc.textContent).toContain('tail paragraph')
  })

  it('LATE JOINER: a peer that syncs AFTER the stream sees the full, clean document', () => {
    const A = makeCollabEditor()
    A.editor.commands.setContent(parseMarkdownToDoc('# Doc\n\nstart'), { contentType: 'json' })
    const session = beginAgentStream(A.editor)!
    applyAgentStreamFrame(A.editor, session, '# Doc\n\nstart\n\nstreamed body')
    endAgentStream(session)

    // A brand-new client joins now and syncs from the current state.
    const D = makeCollabEditor()
    Y.applyUpdate(D.doc, Y.encodeStateAsUpdate(A.doc))

    console.log(
      `\n[LATE-JOIN] D: ${JSON.stringify(D.editor.state.doc.textContent)} converged=${fragStr(A.doc) === fragStr(D.doc)}`
    )
    expect(fragStr(A.doc)).toBe(fragStr(D.doc))
    expect(D.editor.state.doc.textContent).toContain('streamed body')
    expect(emptyParas(D.editor)).toBe(0)
  })
})
