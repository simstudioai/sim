import { db } from '@sim/db'
import type { WorkspaceFileRow } from '@sim/db/schema'
import { workspaceFiles } from '@sim/db/schema'
import { and, asc, inArray, isNull } from 'drizzle-orm'
import { isDocSandboxEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import type { DbTransaction } from '@/lib/db/types'
import type { ProjectFileTarget } from '@/lib/projects/files/application/authorization'
import { defineAuthorizedProjectFileUseCase } from '@/lib/projects/files/application/authorized-use-case'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  buildWorkspaceFileFolderPathMap,
  listFileFolders,
  mapFileRecord,
  type OwnedFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
  mergeWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  enqueueWorkspaceFileStorageCleanups,
  processWorkspaceFileStorageCleanupsNow,
} from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import {
  collectReferencedFileIds,
  compileFileDocument,
  getDocumentSourceLanguage,
  getE2BDocFormat,
  isCompiledDocumentBuffer,
  resolveDocumentRender,
} from '@/lib/uploads/documents'
import { fileDocumentInputIdentity } from '@/lib/uploads/documents/input-identity'
import { resolveServableImageBytes } from '@/lib/uploads/server/image-derivative'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'
import { isSimPageSource, SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'
import { renderSimPageDocument } from '@/lib/workspace-files/page-document'
import {
  collectSimPageFileReferences,
  inlineSimPageImages,
} from '@/lib/workspace-files/page-document.server'
import { createFileReadReceipt, type FileReadReceipt } from '@/lib/workspace-files/read-receipt'
import { markFileSearchArtifactReadyInTx } from '@/lib/workspace-files/search/artifact-ready'

type ProjectOwner = { entityType: 'project'; entityId: string }
interface ArtifactInput extends ProjectFileTarget {
  fileId: string
  maxBytes: number
  forModel?: boolean
  preview?: boolean
}
interface SourceSnapshot {
  file: WorkspaceFileRow
  content: Buffer
}
interface ArtifactManifest {
  source: WorkspaceFileRow
  dependencies: WorkspaceFileRow[]
  pageHtml?: string
  generatedDocument: boolean
}
interface PreparedArtifact {
  artifactKey?: string
  writtenArtifactKeys: readonly string[]
  manifest: ArtifactManifest
  buffer: Buffer
  contentType: string
  dependsOnReferencedFiles: boolean
}
interface ArtifactResult {
  file: OwnedFileRecord<ProjectOwner>
  buffer: Buffer
  contentType: string
  dependsOnReferencedFiles: boolean
  secretProvenance: WorkspaceFileSecretProvenance
  receipt: FileReadReceipt
}

async function discardArtifactWrites(owner: ProjectOwner, keys: readonly string[]) {
  if (keys.length === 0) return
  if (keys.some((key) => !key.startsWith(`project/${owner.entityId}/compiled/`)))
    throw new Error('Artifact cleanup does not belong to this Project')
  const events = await enqueueWorkspaceFileStorageCleanups(db, keys, 'project')
  await processWorkspaceFileStorageCleanupsNow(events, { owner, reason: 'artifact read failed' })
}

function requireSameRevision(current: WorkspaceFileRow | undefined, expected: WorkspaceFileRow) {
  if (
    !current ||
    current.key !== expected.key ||
    current.contentUpdatedAt.getTime() !== expected.contentUpdatedAt.getTime()
  ) {
    throw new OrchestrationError('conflict', 'A document source or input changed during rendering')
  }
}

async function loadDependencies(tx: DbTransaction, owner: ProjectOwner, ids: string[]) {
  if (ids.length === 0) return []
  const rows = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        fileOwnerCondition(owner),
        inArray(workspaceFiles.id, ids),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .orderBy(asc(workspaceFiles.id))
    .for('share')
  if (rows.length !== ids.length)
    throw new OrchestrationError('not_found', 'Document input not found')
  return rows
}

const snapshotArtifact = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.readArtifact,
  ArtifactInput & { source: SourceSnapshot },
  ArtifactManifest
>({
  operation: projectFileOperations.readArtifact,
  async execute({ input, context, tx }) {
    requireSameRevision(context.file, input.source.file)
    const source = input.source.content.toString('utf-8')
    const page =
      (input.source.file.contentType === SIM_PAGE_CONTENT_TYPE ||
        input.source.file.originalName.toLowerCase().endsWith('.html')) &&
      isSimPageSource(source)
    const pageHtml = page
      ? renderSimPageDocument(source, { projectId: context.projectId })
      : undefined
    const format = await getE2BDocFormat(input.source.file.originalName)
    const generatedDocument =
      !page &&
      format !== null &&
      !isCompiledDocumentBuffer(input.source.file.originalName, input.source.content)
    const references = pageHtml ? collectSimPageFileReferences(pageHtml) : []
    if (
      references.some(
        (reference) => reference.projectId && reference.projectId !== context.projectId
      )
    ) {
      throw new OrchestrationError('not_found', 'Document input not found')
    }
    const ids = [
      ...new Set(
        pageHtml
          ? references.map((reference) => reference.fileId)
          : generatedDocument && format
            ? collectReferencedFileIds(
                source,
                isDocSandboxEnabled
                  ? getDocumentSourceLanguage(source, format, input.source.file.contentType)
                  : 'javascript'
              )
            : []
      ),
    ]
    if (ids.length > (pageHtml ? 256 : 500))
      throw new OrchestrationError(
        'payload_too_large',
        'Document exceeds the referenced input limit'
      )
    const dependencies = await loadDependencies(tx, context.owner, ids)
    return { source: input.source.file, dependencies, pageHtml, generatedDocument }
  },
})

/** Renders only source-owned dependencies, then rechecks the source, every input, and current authority. */
export const readProjectFileArtifact = defineAuthorizedProjectFileUseCase<
  typeof projectFileOperations.readArtifact,
  ArtifactInput,
  ArtifactResult,
  PreparedArtifact
>({
  operation: projectFileOperations.readArtifact,
  async prepare({ principal, input, context }) {
    if (
      !Number.isSafeInteger(input.maxBytes) ||
      input.maxBytes <= 0 ||
      input.maxBytes > MAX_BUFFERED_TRANSFER_BYTES
    ) {
      throw new OrchestrationError('validation', 'Invalid document byte limit')
    }
    const file = context.file
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    const writtenArtifactKeys = new Set<string>()
    try {
      const artifact = await resolveDocumentRender(
        file.originalName,
        { maxBytes: input.maxBytes },
        async () => {
          const content = await downloadFile({
            key: file.key,
            context: 'project',
            maxBytes: input.maxBytes,
          })
          const manifest = await snapshotArtifact.execute({
            principal,
            input: { ...input, source: { file, content } },
          })
          let remaining = manifest.pageHtml ? 32 * 1024 * 1024 : 50 * 1024 * 1024
          const inputs = []
          for (const dependency of manifest.dependencies) {
            const bytes = await downloadFile({
              key: dependency.key,
              context: 'project',
              maxBytes: Math.min(remaining, manifest.pageHtml ? 8 * 1024 * 1024 : 25 * 1024 * 1024),
            })
            remaining -= bytes.length
            inputs.push({
              fileId: dependency.id,
              contentType: dependency.contentType,
              content: bytes,
            })
          }
          if (manifest.pageHtml) {
            const byId = new Map(inputs.map((input) => [input.fileId, input]))
            const page = await inlineSimPageImages(
              manifest.pageHtml,
              async ({ fileId }) => {
                const asset = byId.get(fileId)
                if (!asset) throw new OrchestrationError('not_found', 'Document input not found')
                return { bytes: asset.content, contentType: asset.contentType, identity: fileId }
              },
              { strict: true }
            )
            const buffer = Buffer.from(page.html, 'utf-8')
            assertKnownSizeWithinLimit(buffer.length, input.maxBytes, 'rendered page')
            return {
              manifest,
              buffer,
              contentType: 'text/html',
              dependsOnReferencedFiles: inputs.length > 0,
            }
          }
          if (manifest.generatedDocument) {
            const inputIdentity = fileDocumentInputIdentity(context.owner, manifest.dependencies)
            const compiled = await compileFileDocument({
              owner: context.owner,
              source: content.toString('utf-8'),
              fileName: file.originalName,
              inputs,
              onArtifactWrite: (key) => {
                writtenArtifactKeys.add(key)
              },
              inputIdentity,
              maxBytes: input.maxBytes,
            })
            return { manifest, ...compiled }
          }
          return {
            manifest,
            buffer: content,
            contentType: file.contentType,
            dependsOnReferencedFiles: false,
          }
        }
      )
      const derivative = input.preview
        ? await resolveServableImageBytes(artifact.buffer, artifact.manifest.source.key)
        : null
      if (derivative)
        assertKnownSizeWithinLimit(derivative.buffer.length, input.maxBytes, 'image preview')
      return { ...artifact, ...derivative, writtenArtifactKeys: [...writtenArtifactKeys] }
    } catch (error) {
      await discardArtifactWrites(context.owner, [...writtenArtifactKeys])
      throw error
    }
  },
  onCommitFailure: ({ context, prepared }) =>
    discardArtifactWrites(context.owner, prepared.writtenArtifactKeys),
  async execute({ input, context, tx, prepared }) {
    if (!prepared) throw new Error('Prepared document is unavailable')
    requireSameRevision(context.file, prepared.manifest.source)
    const dependencies = await loadDependencies(
      tx,
      context.owner,
      prepared.manifest.dependencies.map((file) => file.id)
    )
    const currentById = new Map(dependencies.map((file) => [file.id, file]))
    for (const expected of prepared.manifest.dependencies)
      requireSameRevision(currentById.get(expected.id), expected)
    const source = context.file
    if (!source) throw new OrchestrationError('not_found', 'File not found')
    if (prepared.artifactKey)
      await markFileSearchArtifactReadyInTx(tx, {
        owner: context.owner,
        file: { fileId: source.id, key: source.key, contentUpdatedAt: source.contentUpdatedAt },
        dependencies: dependencies.map((file) => ({
          fileId: file.id,
          key: file.key,
          sourceContentUpdatedAt: file.contentUpdatedAt,
        })),
        artifactKey: prepared.artifactKey,
      })
    const evidence = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, [
      source,
      ...dependencies,
    ])
    const secretProvenance = mergeWorkspaceFileSecretProvenance(...evidence.values())
    if (
      input.forModel &&
      (secretProvenance.status !== 'exact' || secretProvenance.entries.length !== 0)
    ) {
      throw new OrchestrationError('forbidden', MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)
    }
    const folders = source.folderId
      ? await listFileFolders(context.owner, { scope: 'all' }, tx)
      : []
    return {
      file: mapFileRecord(source, context.owner, buildWorkspaceFileFolderPathMap(folders)),
      buffer: prepared.buffer,
      contentType: prepared.contentType,
      dependsOnReferencedFiles: prepared.dependsOnReferencedFiles,
      secretProvenance,
      receipt: createFileReadReceipt(context.owner, [source, ...dependencies]),
    }
  },
  afterSuccess: ({ result }) => reportWorkspaceFileDelivery(result.secretProvenance),
})
