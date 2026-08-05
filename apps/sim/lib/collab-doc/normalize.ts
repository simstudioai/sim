import * as Y from 'yjs'

/**
 * The Yjs `XmlFragment` name TipTap's Collaboration extension binds to (its default `field`). The
 * client configures `Collaboration.configure({ document })` with no explicit `field`, so it uses
 * TipTap's default, `'default'`. Server-side conversion, seeding, and persistence MUST target the same
 * fragment or the client would sync an empty document — so this is the single canonical source consumed
 * by both bundles (it imports only `yjs`, making it safe from client and server alike).
 */
export const COLLAB_DOC_FIELD = 'default'

/**
 * Remove every top-level empty paragraph (a `paragraph` element with no children) from a collaborative
 * document's body fragment, returning whether it deleted any.
 *
 * The markdown parse pipeline strips these from EVERY parse target (see `stripEmptyParagraphs` in
 * `markdown-parse.ts`): in markdown a run of blank lines between blocks is insignificant, so the static
 * placeholder, the download, and every standard renderer show no interior blank. A cached Yjs snapshot,
 * however, is a raw CRDT binary that bypasses that parse — so it can preserve an empty-paragraph node the
 * re-parse would have dropped. When a warm room seeds from such a snapshot, the empty paragraph surfaces
 * as a stray blank line appearing once the doc settles, diverging from the placeholder that was shown
 * first. Enforcing the same no-top-level-empty-paragraph invariant on the Yjs side keeps the live
 * collaborative doc rendering identically to the markdown re-parse.
 *
 * Idempotent, and only TOP-LEVEL paragraphs are touched — blank lines that carry meaning inside a
 * construct (e.g. a loose list) live below the fragment root and are left alone. Runs its own Yjs
 * transaction so the deletions commit atomically, iterating the fragment back-to-front so a deletion
 * never shifts a not-yet-checked index.
 */
export function stripEmptyTopLevelParagraphs(doc: Y.Doc): boolean {
  const fragment = doc.getXmlFragment(COLLAB_DOC_FIELD)
  let removed = false
  doc.transact(() => {
    for (let i = fragment.length - 1; i >= 0; i--) {
      const node = fragment.get(i)
      if (node instanceof Y.XmlElement && node.nodeName === 'paragraph' && node.length === 0) {
        fragment.delete(i, 1)
        removed = true
      }
    }
  })
  return removed
}
