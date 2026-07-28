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
    // Strip frontmatter exactly as the seed does — the collaborative body never includes it. Callers
    // pass full file content (copilot's `finalContent`), so merging it verbatim would inject the YAML
    // frontmatter as editor content, which the editor's autosave would then write back over the file.
    applyMarkdownToYDoc(doc, splitFrontmatter(markdown).body)
    return Y.encodeStateAsUpdate(doc, before)
  } finally {
    doc.destroy()
  }
}
