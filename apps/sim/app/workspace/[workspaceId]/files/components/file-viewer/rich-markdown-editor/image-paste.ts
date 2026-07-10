/**
 * Extract image `File` objects from a paste/drop payload. Reads `files` first, then falls back to
 * `items` — many browsers expose a pasted or copied image (e.g. a screenshot) only through
 * `DataTransfer.items` with an empty `files` list, so reading `files` alone misses them.
 */
export function extractImageFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return []
  const fromFiles = Array.from(transfer.files).filter((file) => file.type.startsWith('image/'))
  if (fromFiles.length > 0) return fromFiles
  return Array.from(transfer.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

// `src` may be double-quoted, single-quoted, or (validly) unquoted per the HTML spec — the browser's
// own clipboard serialization always quotes it, but other producers of `text/html` are not obligated
// to.
const IMG_SRC_RE = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi
const INLINE_ROUTE_QUERY_KEYS = new Set(['key', 'fileId'])

/**
 * True for the *display-layer* inline route `resolveImageSrc` (see `use-file-content-source.tsx`)
 * rewrites an embed to — workspace-scoped `/api/workspaces/{workspaceId}/files/inline?key=…`/`?fileId=…`
 * or public-share-scoped `/api/files/public/{token}/inline?key=…`/`?fileId=…`. This is the shape
 * actually rendered into `<img src>`, and so what a same-page copy's `text/html` clipboard payload
 * actually contains — NOT the raw stored reference `extractEmbeddedFileRef` (in
 * `@/lib/uploads/utils/embedded-image-ref`) recognizes, which only matches the persisted `src` before
 * that rewrite. Checked separately from (rather than folded into) `extractEmbeddedFileRef` since that
 * helper is shared with server-side authorization/export code operating on persisted content, where
 * this display-only shape should never legitimately appear.
 */
export function isInlineRouteSrc(src: string): boolean {
  try {
    const parsed = new URL(src, 'http://placeholder')
    if (parsed.origin !== 'http://placeholder') return false
    if (!parsed.pathname.endsWith('/inline')) return false
    for (const key of parsed.searchParams.keys()) {
      if (INLINE_ROUTE_QUERY_KEYS.has(key)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Extracts every `<img>` `src` value found in `html`, in document order (may contain duplicates).
 */
export function extractImgSrcs(html: string): string[] {
  const srcs: string[] = []
  for (const match of html.matchAll(IMG_SRC_RE)) {
    const src = match[1] ?? match[2] ?? match[3]
    if (src) srcs.push(src)
  }
  return srcs
}

/**
 * True when `html` contains an `<img>` whose `src` is already one of our own hosted workspace file
 * references. Copying a rendered `<img>` that's already on the page (e.g. Cmd+C after clicking it to
 * select it) makes the browser put BOTH `text/html` (the real serialized node, with its real hosted
 * `src`) AND a synthesized image `File` onto the clipboard — the same "drag a web image out" behavior
 * that {@link extractImageFiles} alone can't tell apart from a genuinely new external image paste.
 */
export function hasHostedImageHtml(html: string, isHostedRef: (src: string) => boolean): boolean {
  return extractImgSrcs(html).some((src) => isHostedRef(src) || isInlineRouteSrc(src))
}

/**
 * True when a paste or drop should be diverted away from the upload-from-file path — it carries
 * exactly one image file, and the accompanying `text/html` shows it's a same-page copy of an
 * already-hosted image (see {@link hasHostedImageHtml}) rather than a genuinely new external image.
 * Content-based (not `view.dragging`-based, for the drop case): `view.dragging` can go briefly stale
 * (cleared up to ~50ms late by ProseMirror's own `dragend` handler when a prior internal drag was
 * dropped outside this view) and must never suppress upload of an unrelated, genuinely new file that
 * happens to land in that window — this check only reacts to what THIS specific event's `html`
 * actually contains. Gated on exactly one file — a genuinely mixed paste/drop (the hosted image plus a
 * separate new one) must still upload the new file, not have the whole paste/drop diverted.
 */
export function shouldSkipFileUpload(
  images: File[],
  html: string,
  isHostedRef: (src: string) => boolean
): boolean {
  return images.length === 1 && Boolean(html) && hasHostedImageHtml(html, isHostedRef)
}

/** Minimal shape of a ProseMirror image node — just enough to read its type name and attrs. */
interface ImageLikeNode {
  type: { name: string }
  attrs: Record<string, unknown>
}

/** Minimal shape of a ProseMirror doc — just enough to walk its nodes. */
interface DescendantsDoc {
  descendants: (callback: (node: ImageLikeNode) => boolean | undefined) => void
}

/**
 * Finds the first `image` node already in `doc` whose *rendered* src (`resolveImageSrc(node.attrs.src)`)
 * matches one of `targetSrcs`, and returns its attrs — a defensive copy, safe to hand straight to
 * `insertContentAt`. Returns `null` if no match is found (e.g. the source node was deleted, or this is
 * genuinely a different document than the one the html was copied from).
 *
 * Used to clone a same-page copy/drag of an already-hosted image faithfully — the exact persisted
 * `src` (and every other attribute: width, height, href, title…) — rather than re-deriving a node from
 * the clipboard/dataTransfer `html`, whose `src` is `resolveImageSrc`'s rewritten *display* URL, not the
 * real persisted one. Inserting a node built from that display URL would bake it into the document,
 * which public share/export/referenced-by-doc tracking don't recognize (they only match the persisted
 * shape) — this lookup avoids ever constructing such a node in the first place.
 */
export function findHostedImageAttrs(
  doc: DescendantsDoc,
  targetSrcs: string[],
  resolveImageSrc: (src: string | undefined) => string | undefined
): Record<string, unknown> | null {
  const targets = new Set(targetSrcs)
  let found: Record<string, unknown> | null = null
  doc.descendants((node) => {
    if (found) return false
    if (node.type.name === 'image') {
      const resolved = resolveImageSrc(node.attrs.src as string | undefined)
      if (resolved && targets.has(resolved)) {
        found = { ...node.attrs }
        return false
      }
    }
    return true
  })
  return found
}
