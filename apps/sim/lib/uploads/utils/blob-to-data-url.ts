/**
 * Converts a Blob to a data URL string.
 * Useful for persisting blob URLs (which are session-scoped) into
 * a stable format that survives blob revocation.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
