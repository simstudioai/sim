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
 * True when `html` contains an `<img>` whose `src` is already one of our own hosted workspace file
 * references. Copying a rendered `<img>` that's already on the page (e.g. Cmd+C after clicking it to
 * select it) makes the browser put BOTH `text/html` (the real serialized node, with its real hosted
 * `src`) AND a synthesized image `File` onto the clipboard — the same "drag a web image out" behavior
 * that {@link extractImageFiles} alone can't tell apart from a genuinely new external image paste. When
 * this is true, the paste handler should let the editor's default HTML-based paste clone the existing
 * node (reusing its real `src`, and every other attribute) instead of re-uploading the pasted bytes as
 * a brand-new file.
 */
export function hasHostedImageHtml(html: string, isHostedRef: (src: string) => boolean): boolean {
  for (const match of html.matchAll(IMG_SRC_RE)) {
    const src = match[1] ?? match[2] ?? match[3]
    if (src && (isHostedRef(src) || isInlineRouteSrc(src))) return true
  }
  return false
}

/**
 * True when a paste should be left to the editor's default HTML-based handling instead of going
 * through the upload-from-file path: exactly one image file is offered, and the clipboard's HTML
 * sibling shows it's a same-page copy of an already-hosted image (see {@link hasHostedImageHtml}).
 * Gated on exactly one file — a genuinely mixed paste (the hosted image plus a separate new one)
 * must still upload the new file, not have the whole paste swallowed by this bypass.
 */
export function shouldSkipPasteUpload(
  images: File[],
  html: string,
  isHostedRef: (src: string) => boolean
): boolean {
  return images.length === 1 && Boolean(html) && hasHostedImageHtml(html, isHostedRef)
}

/**
 * True when a drop should be left to ProseMirror's default move handling instead of going through
 * the upload-from-file path: it's a within-view node drag (`dragging`, ProseMirror's own signal —
 * see `EditorView.dragging`) that dropped at least one image file. Gated on `images.length > 0`, not
 * `dragging` alone — `dragging` can go briefly stale (cleared up to ~50ms late by ProseMirror's own
 * `dragend` handler when a prior internal drag was dropped outside this view) and must never suppress
 * handling of an unrelated, non-image file drop that happens to land in that window.
 */
export function shouldSkipDropUpload(dragging: unknown, images: File[]): boolean {
  return Boolean(dragging) && images.length > 0
}
