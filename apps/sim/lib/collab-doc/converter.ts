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
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import {
  applyFrontmatter,
  postProcessSerializedMarkdown,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import {
  editorNormalForm,
  serializeDocToMarkdown,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { COLLAB_DOC_FIELD } from './field'

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
 * Converge a collaborative {@link Y.Doc} onto its own markdown projection — the document's CANONICAL
 * form — and report whether anything changed.
 *
 * A ProseMirror document is strictly richer than markdown, so `parse ∘ serialize` is not the identity:
 * trailing empty paragraphs are collapsed by `postProcessSerializedMarkdown`, a blank run past the parse
 * bound is truncated, and a document that must parse whole (raw HTML, reference definitions) keeps no
 * empty paragraphs at all. A CRDT holding any such state describes a document its own markdown cannot
 * reproduce — so the file renders one way from the live doc and another from the durable bytes, and the
 * difference surfaces as the editor reflowing a beat after it paints, then silently discarding the
 * spacing once the room goes cold.
 *
 * The fix is to keep the CRDT inside the image of the parse. Defining canonical as "what the round-trip
 * produces" rather than as a hand-written list of what markdown cannot hold is what makes this
 * self-maintaining: every future gap between the two representations is absorbed here automatically,
 * with no second place to update. Idempotent by construction — a canonical doc projects to markdown that
 * parses back to itself, so a second call is a no-op — and it applies the difference through
 * {@link applyMarkdownToYDoc}, so it is a minimal CRDT diff rather than a replacement.
 *
 * Call this on a DETACHED doc (a decoded snapshot), never on a live room: it is a correctness pass for
 * durable artifacts, and converging a document somebody is typing into would move their caret.
 *
 * "Changed" is decided on the DOCUMENT, not on its markdown. Comparing projections looks equivalent and
 * is not: the repairs this pass exists to make are precisely the ones markdown cannot express, so a
 * markdown-equality check is blind to them. Concretely, appending the trailing paragraph
 * {@link editorNormalForm} requires serializes to a trailing blank line that
 * `postProcessSerializedMarkdown` collapses — so every doc ending on a list, heading, table, or rule was
 * repaired here and still reported unchanged, and both callers key their re-encode off that flag. The
 * cached snapshot then kept the UNREPAIRED bytes, which is the one path back into the stacking-empties
 * bug this pass was written to close.
 */
export function canonicalizeYDoc(ydoc: Y.Doc): boolean {
  ensureDomForTipTap()
  const before = yDocToProsemirrorJSON(ydoc, COLLAB_DOC_FIELD)
  // Converge on the body that will actually be WRITTEN, post-process included — the same pass
  // `yDocToFileMarkdown` applies. Targeting the bare serializer output would define canonical against a
  // string the file never contains, so the fidelity fixes that pass makes (empty list markers that
  // re-parse wrong, backslash-escaped callout markers) would sit outside the fixed point this exists to
  // establish, and the live doc could settle on a shape the durable bytes do not reproduce.
  applyMarkdownToYDoc(ydoc, postProcessSerializedMarkdown(serializeDocToMarkdown(before)))
  return JSON.stringify(yDocToProsemirrorJSON(ydoc, COLLAB_DOC_FIELD)) !== JSON.stringify(before)
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
  const target = ProseMirrorNode.fromJSON(schema, editorNormalForm(markdown))
  const fragment = ydoc.getXmlFragment(COLLAB_DOC_FIELD)
  // `updateYFragment` diffs against the fragment's CURRENT content, so it needs the fragment↔PM
  // binding metadata (the element/mark mapping the live editor's ySyncPlugin normally maintains).
  // `initProseMirrorDoc` reconstructs it from the fragment's present state.
  const { meta } = initProseMirrorDoc(fragment, schema)
  ydoc.transact(() => {
    updateYFragment(ydoc, fragment, target, meta)
  })
}
