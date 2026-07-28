import * as Y from 'yjs'
import { applyMarkdownToYDoc } from './converter'

/**
 * Compute the minimal Yjs diff that turns `docState` — the live collaborative document as the realtime
 * relay currently holds it — into `markdown`. This is the Stage C "copilot writes into the open doc"
 * primitive: the relay owns the doc but not the conversion engine, so it ships the current state here
 * and applies the returned diff, which Yjs merges with any concurrent user edits before relaying it to
 * every connected editor.
 *
 * `applyMarkdownToYDoc` performs a real `updateYFragment` diff (not a replace), so unrelated
 * paragraphs the user is editing are preserved. The returned update is relative to the document's
 * state at call time (`Y.encodeStateAsUpdate(doc, before)`), so it is exactly the change to apply — and
 * is empty (a no-op update) when `markdown` already matches the document.
 */
export function buildFileDocMergeUpdate(docState: Uint8Array, markdown: string): Uint8Array {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, docState)
    const before = Y.encodeStateVector(doc)
    applyMarkdownToYDoc(doc, markdown)
    return Y.encodeStateAsUpdate(doc, before)
  } finally {
    doc.destroy()
  }
}
