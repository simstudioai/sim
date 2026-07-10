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

const IMG_SRC_RE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi

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
    if (isHostedRef(match[1])) return true
  }
  return false
}
