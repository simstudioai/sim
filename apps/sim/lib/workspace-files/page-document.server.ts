import type { WorkspaceFileSecretProvenanceIdentity } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
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

/** Bounds metadata reads even when the page references many missing or empty images. */
const MAX_INLINE_IMAGE_REFERENCES = 256

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
  return (await renderSimPageDocumentWithContributors(source, options)).html
}

/** Servable page bytes and the exact stored image revisions actually embedded in them. */
export async function renderSimPageDocumentWithContributors(
  source: string,
  options: { workspaceId?: string }
): Promise<{ html: string; contributingFiles: readonly WorkspaceFileSecretProvenanceIdentity[] }> {
  const documentHtml = renderSimPageDocument(source, options)
  if (!options.workspaceId) return { html: documentHtml, contributingFiles: [] }

  const visited = new Set<string>()
  const inlined = new Map<
    string,
    { dataUri: string; identity: WorkspaceFileSecretProvenanceIdentity }
  >()
  let remaining = MAX_INLINE_TOTAL_BYTES
  for (const match of documentHtml.matchAll(IMAGE_SRC)) {
    const id = match[1]
    if (visited.has(id)) continue
    if (remaining === 0 || visited.size >= MAX_INLINE_IMAGE_REFERENCES) break
    visited.add(id)
    const record = await getFileMetadataById(id).catch(() => null)
    if (!record || record.context !== 'workspace' || record.workspaceId !== options.workspaceId) {
      continue
    }
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
      inlined.set(id, {
        dataUri: `data:${mime};base64,${bytes.toString('base64')}`,
        identity: {
          fileId: record.id,
          key: record.key,
          context: 'workspace',
          contentUpdatedAt: record.contentUpdatedAt,
        },
      })
    } catch {
      /** A missing, unreadable or too-large image keeps its URL reference. */
    }
  }
  /** Charge each occurrence: repeating one image must not multiply the rendered byte budget. */
  let remainingEncodedBytes = Math.ceil((MAX_INLINE_TOTAL_BYTES * 4) / 3)
  const contributors = new Map<string, WorkspaceFileSecretProvenanceIdentity>()
  const html = documentHtml.replace(IMAGE_SRC, (match, id: string) => {
    const image = inlined.get(id)
    if (!image || image.dataUri.length > remainingEncodedBytes) return match
    remainingEncodedBytes -= image.dataUri.length
    contributors.set(id, image.identity)
    return `src="${image.dataUri}"`
  })
  return { html, contributingFiles: [...contributors.values()] }
}
