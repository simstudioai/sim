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
 * The page's own origin — clipboard/dataTransfer srcs on any other origin are never ours.
 * Deliberately `window.location.origin`, NOT `getBaseUrl()`: the browser serializes a dragged/copied
 * `<img>`'s URL against the origin the page is ACTUALLY being viewed on, which can legitimately
 * differ from the configured `NEXT_PUBLIC_APP_URL` (localhost dev against a shared env, preview
 * deploys, apex-vs-www) — comparing against the configured URL would silently fail on any such
 * origin, which is the exact bug class this normalization exists to fix.
 */
function runtimeOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

/**
 * Normalizes a clipboard/dataTransfer img `src` to an origin-relative `pathname?query`, or `null`
 * when it belongs to a different origin. The browser's NATIVE drag/copy enrichment (dragging or
 * "Copy Image" on a rendered `<img>`) serializes the ABSOLUTE resolved URL —
 * `https://host/api/workspaces/…/inline?…` — while everything the app compares against (persisted
 * refs, `resolveImageSrc` output) is origin-relative, so both must be brought into the same space
 * before comparing. A cross-origin src must never be treated as ours.
 */
export function toSameOriginPath(src: string, origin = runtimeOrigin()): string | null {
  try {
    const base = origin || 'http://placeholder'
    const parsed = new URL(src, base)
    if (parsed.origin !== base) return null
    return parsed.pathname + parsed.search
  } catch {
    return null
  }
}

/**
 * True for the *display-layer* inline route `resolveImageSrc` (see `use-file-content-source.tsx`)
 * rewrites an embed to — workspace-scoped `/api/workspaces/{workspaceId}/files/inline?key=…`/`?fileId=…`
 * or public-share-scoped `/api/files/public/{token}/inline?key=…`/`?fileId=…`. This is the shape
 * actually rendered into `<img src>`, and so what a same-page copy's `text/html` clipboard payload
 * actually contains (absolute — see {@link toSameOriginPath}) — NOT the raw stored reference
 * `extractEmbeddedFileRef` (in `@/lib/uploads/utils/embedded-image-ref`) recognizes, which only
 * matches the persisted `src` before that rewrite. Checked separately from (rather than folded into)
 * `extractEmbeddedFileRef` since that helper is shared with server-side authorization/export code
 * operating on persisted content, where this display-only shape should never legitimately appear.
 */
export function isInlineRouteSrc(src: string, origin = runtimeOrigin()): boolean {
  const path = toSameOriginPath(src, origin)
  if (path === null) return false
  try {
    const parsed = new URL(path, 'http://placeholder')
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
 * Srcs are normalized origin-relative first ({@link toSameOriginPath}): ProseMirror's own clipboard
 * serialization writes the persisted relative src, but the BROWSER's native enrichment writes the
 * absolute resolved URL.
 */
export function hasHostedImageHtml(
  html: string,
  isHostedRef: (src: string) => boolean,
  origin = runtimeOrigin()
): boolean {
  return extractImgSrcs(html).some((src) => {
    const path = toSameOriginPath(src, origin)
    return path !== null && (isHostedRef(path) || isInlineRouteSrc(path, origin))
  })
}

/**
 * True when `html` contains an `<img>` whose src — normalized origin-relative — equals
 * `resolvedSrc` (a `resolveImageSrc` output for a node already in this document). This is the
 * "that drop is MY dragged image" check for internal drag-reorder: TipTap's node-view dragstart
 * bypasses ProseMirror's serialization entirely (no PM `text/html`, no `view.dragging`) but
 * NodeSelects the dragged image, and the browser's native enrichment carries the absolute rendered
 * URL of exactly that node.
 */
export function htmlReferencesSrc(
  html: string,
  resolvedSrc: string | undefined,
  origin = runtimeOrigin()
): boolean {
  if (!html || !resolvedSrc) return false
  const target = toSameOriginPath(resolvedSrc, origin)
  if (target === null) return false
  return extractImgSrcs(html).some((src) => toSameOriginPath(src, origin) === target)
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
  resolveImageSrc: (src: string | undefined) => string | undefined,
  origin = runtimeOrigin()
): Record<string, unknown> | null {
  // Normalize both sides origin-relative: the clipboard html may carry the browser's absolute URLs.
  const targets = new Set(
    targetSrcs.map((src) => toSameOriginPath(src, origin)).filter((p): p is string => p !== null)
  )
  let found: Record<string, unknown> | null = null
  doc.descendants((node) => {
    if (found) return false
    if (node.type.name === 'image') {
      const resolved = resolveImageSrc(node.attrs.src as string | undefined)
      const resolvedPath = resolved ? toSameOriginPath(resolved, origin) : null
      if (resolvedPath && targets.has(resolvedPath)) {
        found = { ...node.attrs }
        return false
      }
    }
    return true
  })
  return found
}
