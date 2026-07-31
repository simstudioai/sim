import type { Editor } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { updateYFragment, ySyncPluginKey } from '@tiptap/y-tiptap'
import { parseMarkdownToDoc } from '../markdown-parse'

/**
 * Transaction origin for agent-streamed writes into a live collaborative doc. It is deliberately NOT
 * the `ySyncPluginKey` origin that local user edits use, so the Collaboration UndoManager — which
 * tracks only `ySyncPluginKey` — excludes streamed ops from the user's undo stack.
 */
const AGENT_STREAM_ORIGIN = Symbol('agent-stream')

/**
 * Apply a streamed markdown body into the editor's live collaborative Y.Doc as a minimal CRDT diff.
 *
 * Uses the running `ySyncPlugin` binding's {@link updateYFragment} — the same primitive TipTap runs on
 * every keystroke — so only the delta between the doc's current content and `body` is written, never a
 * full-document replace that would wipe collaborators. Each diff is a small Yjs op that renders locally
 * (via the binding's observer, the remote-edit render path) AND broadcasts to every peer, so the stream
 * is smooth here and on other clients alike. Runs under {@link AGENT_STREAM_ORIGIN} so the streamed ops
 * stay out of the user's undo stack. Returns `false` when the editor has no live ySync binding (e.g. a
 * non-collaborative editor); the caller gates seed-readiness separately via `collabReady`.
 */
export function applyStreamedMarkdownToLiveDoc(editor: Editor, body: string): boolean {
  const binding = ySyncPluginKey.getState(editor.state)?.binding
  if (!binding) return false
  const target = PMNode.fromJSON(editor.schema, parseMarkdownToDoc(body))
  binding.doc.transact(() => {
    updateYFragment(binding.doc, binding.type, target, binding)
  }, AGENT_STREAM_ORIGIN)
  return true
}
