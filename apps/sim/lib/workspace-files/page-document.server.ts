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

const IMAGE_SRC =
  /src="[^"]*\/api\/(?:files\/view\/([^"]+)|projects\/([^/"]+)\/files\/([^/"]+)\/content)"/g

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

  return inlineSimPageImages(documentHtml, async ({ fileId }, maxBytes) => {
    const record = await getFileMetadataById(fileId).catch(() => null)
    if (!record || record.context !== 'workspace' || record.workspaceId !== options.workspaceId)
      return null
    const bytes = await downloadFile({
      key: record.key,
      context: 'workspace',
      maxBytes,
    })
    return {
      bytes,
      contentType: record.contentType ?? 'application/octet-stream',
      identity: {
        fileId: record.id,
        key: record.key,
        context: 'workspace' as const,
        contentUpdatedAt: record.contentUpdatedAt,
      },
    }
  })
}

interface PageFileReference {
  fileId: string
  projectId?: string
}

/** Collects bounded explicit asset identities from the same compiled markup the inline pass uses. */
export function collectSimPageFileReferences(documentHtml: string): PageFileReference[] {
  const references = new Map<string, PageFileReference>()
  for (const match of documentHtml.matchAll(IMAGE_SRC)) {
    const fileId = match[1] ?? match[3]
    const projectId = match[2]
    if (!fileId) continue
    references.set(`${projectId ?? ''}:${fileId}`, { fileId, ...(projectId ? { projectId } : {}) })
    if (references.size > MAX_INLINE_IMAGE_REFERENCES) break
  }
  return [...references.values()]
}

/** Shares byte budgets and replacement semantics across authorized owner-specific asset resolvers. */
export async function inlineSimPageImages<Identity>(
  documentHtml: string,
  resolveImage: (
    reference: PageFileReference,
    maxBytes: number
  ) => Promise<{ bytes: Buffer; contentType: string; identity: Identity } | null>,
  options?: { strict?: boolean }
): Promise<{ html: string; contributingFiles: readonly Identity[] }> {
  const references = collectSimPageFileReferences(documentHtml)
  if (options?.strict && references.length > MAX_INLINE_IMAGE_REFERENCES)
    throw new Error('Page exceeds the referenced asset limit')
  const inlined = new Map<string, { dataUri: string; identity: Identity }>()
  let remaining = MAX_INLINE_TOTAL_BYTES
  for (const reference of references.slice(0, MAX_INLINE_IMAGE_REFERENCES)) {
    if (remaining === 0) break
    try {
      const image = await resolveImage(reference, Math.min(MAX_INLINE_IMAGE_BYTES, remaining))
      if (!image) continue
      const allowedBytes = Math.min(MAX_INLINE_IMAGE_BYTES, remaining)
      remaining = Math.max(0, remaining - image.bytes.length)
      if (image.bytes.length > allowedBytes) {
        if (options?.strict) throw new Error('Page exceeds the embedded asset byte limit')
        continue
      }
      const mime = image.contentType.startsWith('image/')
        ? image.contentType
        : 'application/octet-stream'
      inlined.set(`${reference.projectId ?? ''}:${reference.fileId}`, {
        dataUri: `data:${mime};base64,${image.bytes.toString('base64')}`,
        identity: image.identity,
      })
    } catch (error) {
      if (options?.strict) throw error
    }
  }
  let remainingEncodedBytes = Math.ceil((MAX_INLINE_TOTAL_BYTES * 4) / 3)
  const contributors = new Map<string, Identity>()
  const html = documentHtml.replace(
    IMAGE_SRC,
    (
      match,
      workspaceFileId: string | undefined,
      projectId: string | undefined,
      projectFileId: string | undefined
    ) => {
      const key = `${projectId ?? ''}:${workspaceFileId ?? projectFileId}`
      const image = inlined.get(key)
      if (!image || image.dataUri.length > remainingEncodedBytes) return match
      remainingEncodedBytes -= image.dataUri.length
      contributors.set(key, image.identity)
      return `src="${image.dataUri}"`
    }
  )
  return { html, contributingFiles: [...contributors.values()] }
}
