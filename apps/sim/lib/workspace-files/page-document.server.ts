import { downloadFile } from '@/lib/uploads/core/storage-service'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { renderSimPageDocument } from '@/lib/workspace-files/page-document'

/** Images past this size stay as URL references rather than bloating the document. */
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024

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

  const inlined = new Map<string, string>()
  await Promise.all(
    ids.map(async (id) => {
      try {
        const record = await getFileMetadataById(id)
        if (!record || record.context !== 'workspace' || record.workspaceId !== options.workspaceId)
          return
        const bytes = await downloadFile({ key: record.key, context: 'workspace' })
        if (bytes.length > MAX_INLINE_IMAGE_BYTES) return
        const mime = record.contentType?.startsWith('image/')
          ? record.contentType
          : 'application/octet-stream'
        inlined.set(id, `data:${mime};base64,${bytes.toString('base64')}`)
      } catch {
        // A missing or unreadable image keeps its URL reference.
      }
    })
  )
  if (inlined.size === 0) return documentHtml
  return documentHtml.replace(IMAGE_SRC, (match, id: string) => {
    const dataUri = inlined.get(id)
    return dataUri ? `src="${dataUri}"` : match
  })
}
