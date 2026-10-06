import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type WorkspaceFileRow, workspaceFiles } from '@sim/db/schema'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { isDocSandboxEnabled } from '@/lib/core/config/env-flags'
import {
  asOrchestrationError,
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { DbTransaction } from '@/lib/db/types'
import {
  type PublicFileShareSnapshot,
  type VerifiedPublicFileShareGrant,
  withPublicFileShareGrant,
} from '@/lib/public-shares/application/authorization'
import {
  type PublicFileReadOperation,
  publicFileOperations,
} from '@/lib/public-shares/application/operations'
import {
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  mergeWorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import {
  collectReferencedFileIds,
  getDocumentSourceLanguage,
  getE2BDocFormat,
  isCompiledDocumentBuffer,
} from '@/lib/uploads/documents/compile'
import { hasEmbeddedFileRef } from '@/lib/uploads/server/embedded-image-refs'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'
import { sniffImageContentType } from '@/lib/uploads/utils/validation'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'
import { isSimPageSource, SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import { renderSimPageDocument } from '@/lib/workspace-files/page-document'
import {
  collectSimPageFileReferences,
  inlineSimPageImages,
} from '@/lib/workspace-files/page-document.server'

interface PublicReadInput {
  grant: VerifiedPublicFileShareGrant
  request?: OrchestrationRequestContext
}
interface PublicManifest {
  snapshot: PublicFileShareSnapshot
  dependencies: WorkspaceFileRow[]
  pageHtml?: string
}

function present(snapshot: PublicFileShareSnapshot) {
  const { file } = snapshot
  return {
    owner: snapshot.owner,
    ownerName: snapshot.creatorName,
    workspaceName: snapshot.displayName,
    file: {
      id: file.id,
      originalName: file.originalName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      uploadedBy: file.userId,
      originalCreatorUserId: file.originalCreatorUserId,
      updatedAt: file.updatedAt,
    },
  }
}
function requireRevision(current: WorkspaceFileRow, expected: WorkspaceFileRow) {
  if (
    current.id !== expected.id ||
    current.key !== expected.key ||
    current.contentUpdatedAt.getTime() !== expected.contentUpdatedAt.getTime()
  )
    throw new OrchestrationError('conflict', 'Shared file changed during the read')
}
async function dependencies(
  tx: DbTransaction,
  snapshot: PublicFileShareSnapshot,
  ids: readonly string[]
) {
  if (ids.length > 500)
    throw new OrchestrationError('payload_too_large', 'Too many document inputs')
  if (ids.length === 0) return []
  const rows = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        fileOwnerCondition(snapshot.owner),
        inArray(workspaceFiles.id, [...ids]),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .orderBy(asc(workspaceFiles.id))
    .for('share')
  if (rows.length !== ids.length)
    throw new OrchestrationError('not_found', 'Document input not found')
  return rows
}
async function finish(
  grant: VerifiedPublicFileShareGrant,
  manifest: PublicManifest,
  operation: PublicFileReadOperation,
  buffer: Buffer,
  contentType: string,
  request?: OrchestrationRequestContext,
  servedFile: WorkspaceFileRow = manifest.snapshot.file
) {
  assertKnownSizeWithinLimit(buffer.length, MAX_BUFFERED_TRANSFER_BYTES, 'shared file')
  const result = await withPublicFileShareGrant(grant, operation, async (tx, snapshot) => {
    requireRevision(snapshot.file, manifest.snapshot.file)
    const current = await dependencies(
      tx,
      snapshot,
      manifest.dependencies.map((file) => file.id)
    )
    const expected = new Map(manifest.dependencies.map((file) => [file.id, file]))
    for (const file of current) {
      const prior = expected.get(file.id)
      if (!prior) throw new OrchestrationError('not_found', 'Document input not found')
      requireRevision(file, prior)
    }
    const evidence = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, [
      snapshot.file,
      ...current,
    ])
    return {
      ...present(snapshot),
      buffer,
      contentType,
      servedFileName: servedFile.originalName,
      secretProvenance: mergeWorkspaceFileSecretProvenance(...evidence.values()),
      organizationId: snapshot.organizationId,
    }
  })
  await reportWorkspaceFileDelivery(result.secretProvenance)
  recordAudit({
    actorId: null,
    workspaceId: manifest.snapshot.workspaceId,
    action: AuditAction.FILE_DOWNLOADED,
    resourceType: AuditResourceType.FILE,
    resourceId: servedFile.id,
    resourceName: servedFile.originalName,
    description: `Public share download of "${servedFile.originalName}"`,
    request,
    metadata: {
      organizationId: result.organizationId,
      operation: operation.id,
      sharedDocumentId: result.file.id,
      sharedByUserId: manifest.snapshot.file.userId,
      access: 'public_share',
      anonymous: true,
      owner: result.owner,
      bytes: buffer.length,
    },
  })
  return result
}

/** Metadata is disclosed only after the current token policy has produced a verified bearer grant. */
export function readPublicFileShare({ grant }: PublicReadInput) {
  return withPublicFileShareGrant(grant, publicFileOperations.readMetadata, async (_tx, snapshot) =>
    present(snapshot)
  )
}

/** A public read never executes generated document code; it serves current cached artifacts only. */
export async function readPublicFileShareContent({
  grant,
  preview,
  request,
}: PublicReadInput & { preview?: boolean }) {
  const operation = publicFileOperations.readContent
  try {
    const initial = await withPublicFileShareGrant(
      grant,
      operation,
      async (_tx, snapshot) => snapshot
    )
    const raw = await downloadFile({
      key: initial.file.key,
      context: initial.adapter.storageContext,
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    const format = await getE2BDocFormat(initial.file.originalName)
    const generated = Boolean(format && !isCompiledDocumentBuffer(initial.file.originalName, raw))
    const source = raw.toString('utf8')
    const manifest = await withPublicFileShareGrant(
      grant,
      operation,
      async (tx, snapshot): Promise<PublicManifest> => {
        requireRevision(snapshot.file, initial.file)
        const pageHtml =
          (snapshot.file.contentType === SIM_PAGE_CONTENT_TYPE ||
            snapshot.file.originalName.toLowerCase().endsWith('.html')) &&
          isSimPageSource(source)
            ? renderSimPageDocument(source, snapshot.adapter.pageOptions(snapshot.owner.entityId))
            : undefined
        const references = pageHtml ? collectSimPageFileReferences(pageHtml) : []
        if (
          references.some(
            (ref) =>
              ref.projectId &&
              (snapshot.owner.entityType !== 'project' || ref.projectId !== snapshot.owner.entityId)
          )
        )
          throw new OrchestrationError('not_found', 'Document input not found')
        const ids = [
          ...new Set(
            pageHtml
              ? references.map((ref) => ref.fileId)
              : generated && format
                ? collectReferencedFileIds(
                    source,
                    isDocSandboxEnabled
                      ? getDocumentSourceLanguage(source, format, initial.file.contentType)
                      : 'javascript'
                  )
                : []
          ),
        ]
        return { snapshot, pageHtml, dependencies: await dependencies(tx, snapshot, ids) }
      }
    )
    let buffer = raw
    let contentType = resolveEffectiveMimeType(undefined, initial.file.originalName)
    if (manifest.pageHtml) {
      const byId = new Map(manifest.dependencies.map((file) => [file.id, file]))
      const page = await inlineSimPageImages(
        manifest.pageHtml,
        async ({ fileId }, maxBytes) => {
          const file = byId.get(fileId)
          if (!file) throw new OrchestrationError('not_found', 'Document input not found')
          const bytes = await downloadFile({
            key: file.key,
            context: initial.adapter.storageContext,
            maxBytes,
          })
          const mime = sniffImageContentType(bytes)
          if (!mime) throw new OrchestrationError('not_found', 'Embedded image not found')
          return { bytes, contentType: mime, identity: file.id }
        },
        { strict: true }
      )
      buffer = Buffer.from(page.html)
      contentType = 'text/html'
    } else if (generated && format) {
      ;({ buffer, contentType } = await initial.adapter.readCompiled({
        owner: initial.owner,
        source: raw,
        sourceMime: initial.file.contentType,
        fileName: initial.file.originalName,
        format,
        dependencies: manifest.dependencies,
      }))
    } else if (preview) {
      const image = await initial.adapter.imagePreview(raw, initial.file.key)
      if (image) ({ buffer, contentType } = image)
    }
    return await finish(grant, manifest, operation, buffer, contentType, request)
  } catch (error) {
    throw asOrchestrationError(error) ?? error
  }
}

/** A share grants only current image embeds in its own document and canonical owner. */
export async function readPublicFileShareInline({
  grant,
  fileId,
  key,
  request,
}: PublicReadInput & { fileId?: string; key?: string }) {
  const operation = publicFileOperations.readInline
  try {
    if (Boolean(fileId) === Boolean(key))
      throw new OrchestrationError('validation', 'Select one image reference')
    const initial = await withPublicFileShareGrant(
      grant,
      operation,
      async (_tx, snapshot) => snapshot
    )
    const raw = await downloadFile({
      key: initial.file.key,
      context: initial.adapter.storageContext,
      maxBytes: 10 * 1024 * 1024,
    }).catch((error: unknown) => {
      if (isPayloadSizeLimitError(error))
        throw new OrchestrationError('not_found', 'Embedded image not found')
      throw error
    })
    const source = raw.toString('utf8')
    const manifest = await withPublicFileShareGrant(
      grant,
      operation,
      async (tx, snapshot): Promise<PublicManifest> => {
        requireRevision(snapshot.file, initial.file)
        const pageHtml = isSimPageSource(source)
          ? renderSimPageDocument(source, snapshot.adapter.pageOptions(snapshot.owner.entityId))
          : undefined
        const reference = fileId ? { fileId } : key ? { key } : null
        const references = pageHtml ? collectSimPageFileReferences(pageHtml) : []
        const embedded =
          reference &&
          (pageHtml
            ? references.some(
                (ref) =>
                  ref.fileId === fileId &&
                  (!ref.projectId ||
                    (snapshot.owner.entityType === 'project' &&
                      ref.projectId === snapshot.owner.entityId))
              )
            : hasEmbeddedFileRef(source, reference, snapshot.owner))
        if (!embedded) throw new OrchestrationError('not_found', 'Embedded image not found')
        const [file] = await tx
          .select()
          .from(workspaceFiles)
          .where(
            and(
              fileOwnerCondition(snapshot.owner),
              isNull(workspaceFiles.deletedAt),
              fileId ? eq(workspaceFiles.id, fileId) : eq(workspaceFiles.key, key ?? '')
            )
          )
          .for('share')
        if (!file) throw new OrchestrationError('not_found', 'Embedded image not found')
        return { snapshot, dependencies: [file] }
      }
    )
    const target = manifest.dependencies[0]
    if (!target) throw new OrchestrationError('not_found', 'Embedded image not found')
    const buffer = await downloadFile({
      key: target.key,
      context: initial.adapter.storageContext,
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    const contentType = sniffImageContentType(buffer)
    if (!contentType) throw new OrchestrationError('not_found', 'Embedded image not found')
    return await finish(grant, manifest, operation, buffer, contentType, request, target)
  } catch (error) {
    throw asOrchestrationError(error) ?? error
  }
}
