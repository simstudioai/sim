import { downloadFile } from '@/lib/uploads/core/storage-service'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { renderSimPageDocument } from '@/lib/workspace-files/page-document'

/** Images past this size stay as URL references rather than bloating the document. */
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Ceiling on everything a single document inlines. A per-image limit does not bound
 * the page on its own — N images each just under it still cost N times it. Images
 * that do not fit what is left keep their URL reference, exactly like an oversized one.
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

  // One image at a time, charged against the budget by what each download actually
  // delivered. Fetching them concurrently made the peak the sum of every image rather
  // than the largest one, and the ceiling on the finished document could only observe
  // that after the fact. Each download is given whatever the budget has left, so an
  // image that does not fit is refused by the read itself instead of after it lands.
  const inlined = new Map<string, string>()
  let remaining = MAX_INLINE_TOTAL_BYTES
  for (const candidate of candidates) {
    if (!candidate) continue
    if (remaining === 0) break
    const { id, record } = candidate
    try {
      const bytes = await downloadFile({
        key: record.key,
        context: 'workspace',
        maxBytes: Math.min(MAX_INLINE_IMAGE_BYTES, remaining),
      })
      remaining -= bytes.length
      const mime = record.contentType?.startsWith('image/')
        ? record.contentType
        : 'application/octet-stream'
      inlined.set(id, `data:${mime};base64,${bytes.toString('base64')}`)
    } catch {
      // A missing, unreadable or too-large image keeps its URL reference.
    }
  }
  if (inlined.size === 0) return documentHtml
  return documentHtml.replace(IMAGE_SRC, (match, id: string) => {
    const dataUri = inlined.get(id)
    return dataUri ? `src="${dataUri}"` : match
  })
}
