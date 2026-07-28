import { getSchema } from '@tiptap/core'
import { Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import {
  initProseMirrorDoc,
  prosemirrorJSONToYDoc,
  updateYFragment,
  yDocToProsemirrorJSON,
} from '@tiptap/y-tiptap'
import type * as Y from 'yjs'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  parseMarkdownToDoc,
  serializeDocToMarkdown,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

/**
 * Server-side conversion between a file's markdown and its collaborative Yjs document.
 *
 * The markdown ↔ ProseMirror step reuses the EXACT client engine (`parseMarkdownToDoc` /
 * `serializeDocToMarkdown`, both driven by `@tiptap/markdown` on the shared extension set), so the
 * server can never diverge from what the editor renders — parity by construction, not by a second
 * markdown implementation. The ProseMirror ↔ Yjs step uses `@tiptap/y-tiptap` (the same binding
 * TipTap's Collaboration extension uses in the browser), so the Yjs structure the server produces is
 * byte-compatible with the client's.
 *
 * The TipTap editor the markdown engine builds needs a DOM; on the server we back it with `jsdom`
 * (see {@link ensureDomForTipTap}). This module is server-only by construction — it must never reach
 * the client bundle (jsdom + the full editor would bloat it and break in the browser). It is kept
 * out of that bundle by `require`-ing `jsdom` lazily (never a static top-level import) and by being
 * imported only from server code (the seed builder + its internal route); there is no `import
 * 'server-only'` marker because this repo does not use that package.
 */

/**
 * The Yjs `XmlFragment` name TipTap's Collaboration extension binds to. The client configures
 * `Collaboration.configure({ document })` with no explicit `field`, so it uses TipTap's default,
 * `'default'`. The server MUST target the same fragment or the client would sync an empty document.
 */
export const COLLAB_DOC_FIELD = 'default'

let cachedSchema: Schema | null = null

/** The shared ProseMirror schema, built headlessly from the exact client extension set. */
function markdownSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(createMarkdownContentExtensions())
  return cachedSchema
}

let domReady = false

/**
 * Ensure a DOM exists for the TipTap editor the markdown engine constructs. In a `jsdom` test
 * environment `document` already exists and this is a no-op; in a plain Node server it installs a
 * single shared jsdom window's globals once. Kept minimal and idempotent — TipTap only needs
 * `document`/`window`/`navigator` to build its (never-mounted) editor for parse/serialize.
 */
function ensureDomForTipTap(): void {
  if (domReady || typeof document !== 'undefined') {
    domReady = true
    return
  }
  // Lazy require so the client bundle never pulls jsdom in.
  const { JSDOM } = require('jsdom') as typeof import('jsdom')
  const { window } = new JSDOM('<!doctype html><html><body></body></html>')
  const g = globalThis as unknown as Record<string, unknown>
  g.window ??= window
  g.document ??= window.document
  g.navigator ??= window.navigator
  domReady = true
}

/** Convert a file's markdown to a fresh collaborative {@link Y.Doc} (cold-start seed). */
export function markdownToYDoc(markdown: string): Y.Doc {
  ensureDomForTipTap()
  const json = parseMarkdownToDoc(markdown)
  return prosemirrorJSONToYDoc(markdownSchema(), json, COLLAB_DOC_FIELD)
}

/** Project a collaborative {@link Y.Doc} back to the file's canonical markdown. */
export function yDocToMarkdown(ydoc: Y.Doc): string {
  ensureDomForTipTap()
  const json = yDocToProsemirrorJSON(ydoc, COLLAB_DOC_FIELD)
  return serializeDocToMarkdown(json)
}

/**
 * Apply new markdown content into an EXISTING collaborative {@link Y.Doc} as a minimal CRDT diff,
 * merging with any concurrent user edits rather than replacing the document. This is how the agent
 * writes into a live doc: `updateYFragment` computes exactly the changes between the fragment's
 * current content and the target and applies them as Yjs operations — the same primitive TipTap's
 * `ySyncPlugin` uses on every keystroke — so Yjs reconciles them with in-flight remote edits.
 */
export function applyMarkdownToYDoc(ydoc: Y.Doc, markdown: string): void {
  ensureDomForTipTap()
  const schema = markdownSchema()
  const target = ProseMirrorNode.fromJSON(schema, parseMarkdownToDoc(markdown))
  const fragment = ydoc.getXmlFragment(COLLAB_DOC_FIELD)
  // `updateYFragment` diffs against the fragment's CURRENT content, so it needs the fragment↔PM
  // binding metadata (the element/mark mapping the live editor's ySyncPlugin normally maintains).
  // `initProseMirrorDoc` reconstructs it from the fragment's present state.
  const { meta } = initProseMirrorDoc(fragment, schema)
  ydoc.transact(() => {
    updateYFragment(ydoc, fragment, target, meta)
  })
}
