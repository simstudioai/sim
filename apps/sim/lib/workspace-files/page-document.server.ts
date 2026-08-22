import { downloadFile } from '@/lib/uploads/core/storage-service'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { renderSimPageDocument } from '@/lib/workspace-files/page-document'

/** Images past this size stay as URL references rather than bloating the document. */
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Ceiling on everything a single document inlines. A per-image limit does not bound
 * the page on its own: N images each just under it still cost N times it, and they
 * are fetched concurrently, so that product is also the peak. Images that do not fit
 * the remaining budget keep their URL reference, exactly like an oversized one.
 */
const MAX_INLINE_TOTAL_BYTES = 32 * 1024 * 1024

const IMAGE_SRC = /src="[^"]*\/api\/files\/view\/([^"]+)"/g

/**
 * The full pdf model for the standalone document: like a pdf carrying its
 * images, the served page inlines every workspace image it references as a
 * data: URI. Absolute link URLs already survive a download, but an embedded
 * image request from a downloaded file is cross-site and carries no session
 * cookie, so only baked-in bytes render everywhere. Images must live in the
 * page's own workspace — a reference into another workspace stays a URL and
 * renders only where the viewer's own session authorizes it.
 */
export async function renderSimPageDocumentWithAssets(
  source: string,
  options: { workspaceId?: string }
): Promise<string> {
  const documentHtml = renderSimPageDocument(source, options)
  const ids = [...new Set([...documentHtml.matchAll(IMAGE_SRC)].map((match) => match[1]))]
  if (ids.length === 0 || !options.workspaceId) return documentHtml

  const candidates = await Promise.all(
    ids.map(async (id) => {
      const record = await getFileMetadataById(id).catch(() => null)
      if (!record || record.context !== 'workspace' || record.workspaceId !== options.workspaceId)
        return null
      return { id, record }
    })
  )

  // Pick the inline set from recorded sizes BEFORE fetching anything, so the concurrent
  // downloads below are bounded in count and in total bytes rather than discovering the
  // size of each image only once it is already resident. These sizes are written by the
  // upload pipeline, not supplied by the caller, so they are sound to plan against —
  // each download still carries its own ceiling in case a row understates its object.
  let remaining = MAX_INLINE_TOTAL_BYTES
  const eligible: NonNullable<(typeof candidates)[number]>[] = []
  for (const candidate of candidates) {
    if (!candidate) continue
    const size = candidate.record.sizeBytes ?? candidate.record.size
    if (size > MAX_INLINE_IMAGE_BYTES || size > remaining) continue
    remaining -= size
    eligible.push(candidate)
  }

  const inlined = new Map<string, string>()
  await Promise.all(
    eligible.map(async ({ id, record }) => {
      try {
        const bytes = await downloadFile({
          key: record.key,
          context: 'workspace',
          maxBytes: MAX_INLINE_IMAGE_BYTES,
        })
        const mime = record.contentType?.startsWith('image/')
          ? record.contentType
          : 'application/octet-stream'
        inlined.set(id, `data:${mime};base64,${bytes.toString('base64')}`)
      } catch {
        // A missing, unreadable or oversized image keeps its URL reference.
      }
    })
  )
  if (inlined.size === 0) return documentHtml
  return documentHtml.replace(IMAGE_SRC, (match, id: string) => {
    const dataUri = inlined.get(id)
    return dataUri ? `src="${dataUri}"` : match
  })
}
