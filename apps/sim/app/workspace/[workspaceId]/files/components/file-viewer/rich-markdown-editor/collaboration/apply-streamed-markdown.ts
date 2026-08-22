import type { Editor } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { initProseMirrorDoc, updateYFragment, ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { COLLAB_DOC_FIELD } from '@/lib/collab-doc/field'
import { editorNormalForm } from '../markdown-parse'

/**
 * Transaction origin for agent-streamed writes into a live collaborative doc. It is deliberately NOT
 * the `ySyncPluginKey` origin that local user edits use, so the Collaboration UndoManager — which
 * tracks only `ySyncPluginKey` — excludes streamed ops from the user's undo stack.
 */
export const AGENT_STREAM_ORIGIN = Symbol('agent-stream')

/**
 * A private Yjs replica the agent stream reconciles against, so a stream writes into the live doc as a
 * TRUE peer: only the agent's own delta reaches the shared doc, never a whole-document reconcile that
 * would revert a collaborator's concurrent edit. Seeded from the live doc at stream start; it receives
 * ONLY agent reconciles (never peer updates), so `shadow → nextTarget` yields exactly the agent's change.
 */
export interface AgentStreamSession {
  shadow: Y.Doc
  fragment: Y.XmlFragment
  /**
   * The fragment↔PM binding metadata (`mapping`/`isOMark`) `updateYFragment` diffs against. Built ONCE
   * from the seeded fragment on the first frame, then maintained IN PLACE by `updateYFragment` on every
   * subsequent frame — the same persistent structure y-tiptap's own `ProsemirrorBinding` keeps for a
   * doc's whole life. Caching it avoids an O(doc) `initProseMirrorDoc` tree rebuild per streamed frame.
   * Safe ONLY because the shadow receives the agent's OWN reconciles and nothing else (never peer
   * updates), so the fragment never changes outside `updateYFragment`; it is torn down with the session
   * on leadership loss, so it can't outlive its fragment. A future change that ever applies an external
   * update to `shadow` MUST reset this to `null`.
   */
  meta: ReturnType<typeof initProseMirrorDoc>['meta'] | null
}

/**
 * Begin an agent stream by snapshotting the live doc into a private shadow replica. Returns `null` when
 * the editor has no live ySync binding (e.g. a non-collaborative editor).
 */
export function beginAgentStream(editor: Editor): AgentStreamSession | null {
  const binding = ySyncPluginKey.getState(editor.state)?.binding
  if (!binding) return null
  const shadow = new Y.Doc()
  Y.applyUpdate(shadow, Y.encodeStateAsUpdate(binding.doc))
  return { shadow, fragment: shadow.getXmlFragment(COLLAB_DOC_FIELD), meta: null }
}

/**
 * Apply one streamed markdown body. Reconciles the shadow toward `body` with `updateYFragment` (the same
 * minimal-diff primitive TipTap runs per keystroke), captures ONLY the resulting agent delta, and relays
 * it into the live doc under {@link AGENT_STREAM_ORIGIN}. Because the shadow never sees peer updates, the
 * delta touches only what the agent changed — so concurrent peer edits elsewhere in the live doc survive,
 * the change renders locally (via the binding's observer, the remote-edit path), broadcasts to every
 * peer, and stays out of the user's undo stack. Returns `false` when the editor has no live ySync binding.
 */
export function applyAgentStreamFrame(
  editor: Editor,
  session: AgentStreamSession,
  body: string
): boolean {
  const binding = ySyncPluginKey.getState(editor.state)?.binding
  if (!binding) return false
  // Through the editor's normal form, like every other writer to the shared document. A frame whose
  // body ends on a list, heading, table, or rule parses WITHOUT the editor's trailing paragraph, so
  // reconciling toward the bare parse deletes the one the seed put there — and the next client to bind
  // writes it back, which is the divergence this normalization exists to prevent.
  const target = PMNode.fromJSON(editor.schema, editorNormalForm(body))
  let delta: Uint8Array | null = null
  const capture = (update: Uint8Array, origin: unknown) => {
    if (origin === AGENT_STREAM_ORIGIN) delta = update
  }
  session.shadow.on('update', capture)
  try {
    session.shadow.transact(() => {
      // Build the binding metadata once, then reuse it; updateYFragment maintains it in place. See
      // AgentStreamSession.meta for why per-frame reuse is safe (and why a rebuild would be wasteful).
      session.meta ??= initProseMirrorDoc(session.fragment, editor.schema).meta
      updateYFragment(session.shadow, session.fragment, target, session.meta)
    }, AGENT_STREAM_ORIGIN)
  } finally {
    session.shadow.off('update', capture)
  }
  if (delta) Y.applyUpdate(binding.doc, delta, AGENT_STREAM_ORIGIN)
  return true
}

/** End an agent stream and free its shadow replica. */
export function endAgentStream(session: AgentStreamSession): void {
  session.shadow.destroy()
}
