import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { getSchema } from '@tiptap/core'
import { Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import {
  initProseMirrorDoc,
  prosemirrorJSONToYDoc,
  updateYFragment,
  yDocToProsemirrorJSON,
} from '@tiptap/y-tiptap'
import type * as Y from 'yjs'
import { COLLAB_DOC_FIELD } from '@/lib/collab-doc/field'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import {
  editorNormalForm,
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

let cachedSchema: Schema | null = null

/** The shared ProseMirror schema, built headlessly from the exact client extension set. */
function markdownSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(createMarkdownContentExtensions())
  return cachedSchema
}

let cachedJsdomWindow: import('jsdom').DOMWindow | null = null

/**
 * Ensure a DOM exists for the TipTap editor the markdown engine constructs. In a `jsdom`/browser
 * environment `window` + `document` already exist and this is a no-op; in a plain Node server it
 * installs a single shared jsdom window's globals. Cheap and idempotent — TipTap only needs
 * `window`/`document`/`navigator` to build its (never-mounted) editor for parse/serialize.
 *
 * Gate on `window` (what TipTap's `elementFromString` actually checks), not just `document`, and hold
 * NO cached "ready" flag: the Next server runtime exposes a partial `document` with NO `window`, and a
 * `document`-only guard (plus a sticky flag) skipped this setup — leaving TipTap to throw "there is no
 * window object available". Re-checking the globals every call means a partial stub can never wedge it.
 * When `window` is missing we install a coherent jsdom window+document pair, overwriting any such stub.
 *
 * Both the guard and the install go through `globalThis` explicitly, and the jsdom window itself is a
 * module-level singleton. The server bundler can give a bundled module a `window` binding that does
 * NOT read `globalThis` (the documented reason TipTap/Yjs sit in `serverExternalPackages` — see
 * `next.config.ts`); a bare-`window` guard paired with a `globalThis.window` install can therefore
 * disagree forever, re-entering the install on every call. Reading and writing the same object makes
 * the guard self-consistent, and the singleton caps this module at ONE jsdom window (megabytes each)
 * per process even if some runtime still defeats the guard.
 */
function ensureDomForTipTap(): void {
  if (typeof globalThis.window !== 'undefined' && typeof globalThis.document !== 'undefined') return
  if (!cachedJsdomWindow) {
    // Lazy require so the client bundle never pulls jsdom in.
    const { JSDOM } = require('jsdom') as typeof import('jsdom')
    cachedJsdomWindow = new JSDOM('<!doctype html><html><body></body></html>').window
  }
  // double-cast-allowed: assigning the jsdom shims onto the global needs an
  // index-signature view of `globalThis`, whose declared type has none.
  const g = globalThis as unknown as Record<string, unknown>
  g.window = cachedJsdomWindow
  g.document = cachedJsdomWindow.document
  g.navigator ??= cachedJsdomWindow.navigator
}

/** Convert a file's markdown to a fresh collaborative {@link Y.Doc} (cold-start seed). */
export function markdownToYDoc(markdown: string): Y.Doc {
  ensureDomForTipTap()
  return prosemirrorJSONToYDoc(markdownSchema(), editorNormalForm(markdown), COLLAB_DOC_FIELD)
}

/** Project a collaborative {@link Y.Doc}'s BODY back to markdown (no frontmatter). */
export function yDocToMarkdown(ydoc: Y.Doc): string {
  ensureDomForTipTap()
  const json = yDocToProsemirrorJSON(ydoc, COLLAB_DOC_FIELD)
  return serializeDocToMarkdown(json)
}

/**
 * Project a collaborative {@link Y.Doc} back to the file's FULL canonical markdown — the body from the
 * CRDT re-joined with the frontmatter carried in the config map. Mirrors the editor's save path EXACTLY
 * (`applyFrontmatter(resolveSaveFrontmatter(), postProcessSerializedMarkdown(editor.getMarkdown()))`),
 * INCLUDING the `postProcessSerializedMarkdown` body fidelity pass (empty list markers, callout
 * un-escaping, trailing whitespace) — so a server-side persist is byte-identical to a client save and
 * matches the client's dirty-check baseline, with no spurious blob churn on the round-trip.
 */
export function yDocToFileMarkdown(ydoc: Y.Doc): string {
  const frontmatter = ydoc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.frontmatterKey)
  return applyFrontmatter(
    typeof frontmatter === 'string' ? frontmatter : '',
    postProcessSerializedMarkdown(yDocToMarkdown(ydoc))
  )
}

/**
 * Apply an external body change through TipTap's CRDT diff. Equivalent Markdown must not
 * normalize the native tree: deleting an empty paragraph also deletes the target of delayed edits.
 */
export function applyMarkdownToYDoc(ydoc: Y.Doc, markdown: string): void {
  ensureDomForTipTap()
  const schema = markdownSchema()
  const target = ProseMirrorNode.fromJSON(schema, editorNormalForm(markdown))
  const currentProjection = ProseMirrorNode.fromJSON(
    schema,
    editorNormalForm(postProcessSerializedMarkdown(yDocToMarkdown(ydoc)))
  )
  if (currentProjection.eq(target)) return

  const fragment = ydoc.getXmlFragment(COLLAB_DOC_FIELD)
  // `updateYFragment` diffs against the fragment's CURRENT content, so it needs the fragment↔PM
  // binding metadata (the element/mark mapping the live editor's ySyncPlugin normally maintains).
  // `initProseMirrorDoc` reconstructs it from the fragment's present state.
  const { meta } = initProseMirrorDoc(fragment, schema)
  ydoc.transact(() => {
    updateYFragment(ydoc, fragment, target, meta)
  })
}
