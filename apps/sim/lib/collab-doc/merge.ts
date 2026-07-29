import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import * as Y from 'yjs'
import { splitFrontmatter } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
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
    // The collaborative body never includes frontmatter (callers pass full file content, e.g.
    // copilot's `finalContent`), so merge only the body, and update the frontmatter in the config map
    // — the editor re-attaches THAT on autosave, so a frontmatter change is reflected rather than
    // reverted by an open editor's stale, open-time copy.
    const { frontmatter, body } = splitFrontmatter(markdown)
    applyMarkdownToYDoc(doc, body)
    // Only write when it actually changed (treating "unset" as "") so an unchanged edit stays a true
    // no-op diff rather than churning the config map on every merge.
    const config = doc.getMap(FILE_DOC_SEED.configMap)
    if ((config.get(FILE_DOC_SEED.frontmatterKey) ?? '') !== frontmatter) {
      config.set(FILE_DOC_SEED.frontmatterKey, frontmatter)
    }
    return Y.encodeStateAsUpdate(doc, before)
  } finally {
    doc.destroy()
  }
}
