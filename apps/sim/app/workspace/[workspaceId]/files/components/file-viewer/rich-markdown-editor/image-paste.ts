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
