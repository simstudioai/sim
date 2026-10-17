import type { Principal } from '@sim/auth/principal'
import type { WorkspaceFileRow } from '@sim/db/schema'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, inArray, isNull } from 'drizzle-orm'
import type { AuthorizingUseCase } from '@/lib/core/application'
import { requireAdmittedContent } from '@/lib/core/application/content-delivery'
import { isDocSandboxEnabled } from '@/lib/core/config/env-flags'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import type { DbTransaction } from '@/lib/db/types'
import type {
  ProjectFileAuthorizationContext,
  ProjectFileTarget,
} from '@/lib/projects/files/application/authorization'
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
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
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
import { getWorkspaceFileSize, MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import {
  MAX_TEXT_EXTRACTION_BYTES,
  needsRenderedArtifact,
  observedMediaType,
} from '@/lib/uploads/utils/file'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import {
  type ExtractedFileText,
  extractFileTextFromBytes,
  renderedTextTooLargeMessage,
  textExtractionTooLargeError,
  textExtractionUnsupportedError,
} from '@/lib/workspace-files/application/read-workspace-file-text'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'
import {
  isSimPageSource,
  ProjectPageForeignEmbedError,
  SIM_PAGE_CONTENT_TYPE,
} from '@/lib/workspace-files/page-compile'
import { renderSimPageDocument } from '@/lib/workspace-files/page-document'
import {
  collectSimPageFileReferences,
  inlineSimPageImages,
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_IMAGE_REFERENCES,
  MAX_INLINE_TOTAL_BYTES,
} from '@/lib/workspace-files/page-document.server'
import { createFileReadReceipt, type FileReadReceipt } from '@/lib/workspace-files/read-receipt'
import {
  type FileSearchArtifactCompletion,
  requeueFileSearchForRenderedArtifact,
} from '@/lib/workspace-files/search/artifact-ready'
import { workspaceFileTextFormat } from '@/lib/workspace-files/text-format'

const logger = createLogger('ProjectFileArtifacts')

/** Generated-document input limits; `compileFileDocument` enforces the same values on the bytes. */
const MAX_DOCUMENT_INPUTS = 500
const MAX_DOCUMENT_INPUT_BYTES = 25 * 1024 * 1024
const MAX_DOCUMENT_INPUT_TOTAL_BYTES = 50 * 1024 * 1024

type ProjectOwner = { entityType: 'project'; entityId: string }
interface ArtifactInput extends ProjectFileTarget {
  fileId: string
  maxBytes: number
  forModel?: boolean
  preview?: boolean
  /** Bytes are only extracted as text, so an unextractable or oversized source is refused unread. */
  text?: boolean
  /** The caller never reads `file.folderPath`, so the owner's folder tree is not loaded for it. */
  skipFolderPath?: boolean
}
interface SourceSnapshot {
  file: WorkspaceFileRow
  owner: ProjectOwner
  organizationId: string | null
  secretProvenance: WorkspaceFileSecretProvenance | undefined
}
interface ArtifactPlan {
  /** The decoded source, only for a page or generated document. */
  source?: string
  pageHtml?: string
  generatedDocument: boolean
  dependencyIds: string[]
}
interface PreparedArtifact {
  artifactKey?: string
  source: WorkspaceFileRow
  dependencies: WorkspaceFileRow[]
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

/**
 * Search requeues carried from the commit to the post-commit phase. The requeue holds the Project
 * exclusively, so it never runs inside the read's transaction, which holds the Project shared.
 */
const renderedSearchArtifacts = new WeakMap<ArtifactResult, FileSearchArtifactCompletion>()

function requireSameRevision(current: WorkspaceFileRow | undefined, expected: WorkspaceFileRow) {
  if (
    !current ||
    current.key !== expected.key ||
    current.originalName !== expected.originalName ||
    current.contentType !== expected.contentType ||
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

/** Classifies the source bytes and names the same-Project inputs its render reads. */
async function planArtifact(
  file: WorkspaceFileRow,
  content: Buffer,
  owner: ProjectOwner
): Promise<ArtifactPlan> {
  const pageCandidate =
    file.contentType === SIM_PAGE_CONTENT_TYPE || file.originalName.toLowerCase().endsWith('.html')
  const format = await getE2BDocFormat(file.originalName)
  if (!pageCandidate && format === null) return { generatedDocument: false, dependencyIds: [] }
  const source = content.toString('utf-8')
  const page = pageCandidate && isSimPageSource(source)
  let pageHtml: string | undefined
  if (page) {
    try {
      pageHtml = renderSimPageDocument(source, { projectId: owner.entityId })
    } catch (error) {
      if (error instanceof ProjectPageForeignEmbedError)
        throw new OrchestrationError('not_found', 'Document input not found')
      throw error
    }
  }
  const generatedDocument =
    !page && format !== null && !isCompiledDocumentBuffer(file.originalName, content)
  const references = pageHtml ? collectSimPageFileReferences(pageHtml) : []
  if (references.some((reference) => reference.projectId && reference.projectId !== owner.entityId))
    throw new OrchestrationError('not_found', 'Document input not found')
  const dependencyIds = [
    ...new Set(
      pageHtml
        ? references.map((reference) => reference.fileId)
        : generatedDocument && format
          ? collectReferencedFileIds(
              source,
              isDocSandboxEnabled
                ? getDocumentSourceLanguage(source, format, file.contentType)
                : 'javascript'
            )
          : []
    ),
  ]
  if (dependencyIds.length > (pageHtml ? MAX_INLINE_IMAGE_REFERENCES : MAX_DOCUMENT_INPUTS))
    throw new OrchestrationError('payload_too_large', 'Document exceeds the referenced input limit')
  return { source, pageHtml, generatedDocument, dependencyIds }
}

/**
 * Reads inputs with bounded fan-out. Declared sizes are checked before any read, and each read is
 * capped at its declared size plus the unclaimed budget, so accurate rows never exceed the total.
 */
async function downloadDependencies(
  dependencies: readonly WorkspaceFileRow[],
  limits: { perFile: number; total: number },
  signal?: AbortSignal
) {
  const declared = dependencies.map((dependency) => getWorkspaceFileSize(dependency))
  for (const size of declared) assertKnownSizeWithinLimit(size, limits.perFile, 'document input')
  const declaredTotal = declared.reduce((sum, size) => sum + size, 0)
  assertKnownSizeWithinLimit(declaredTotal, limits.total, 'document inputs')
  const unclaimed = limits.total - declaredTotal
  const failed = new AbortController()
  const abort = signal ? AbortSignal.any([signal, failed.signal]) : failed.signal
  let received = 0
  try {
    return await mapWithConcurrency(
      dependencies,
      MATERIALIZE_CONCURRENCY,
      async (dependency, index) => {
        abort.throwIfAborted()
        const content = await downloadFile({
          key: dependency.key,
          context: 'project',
          maxBytes: Math.min(limits.perFile, declared[index] + unclaimed),
          signal: abort,
        })
        received += content.length
        assertKnownSizeWithinLimit(received, limits.total, 'document inputs')
        return { fileId: dependency.id, contentType: dependency.contentType, content }
      }
    )
  } catch (error) {
    failed.abort(error)
    throw error
  }
}

/**
 * How a read's bytes leave: `opaque` bytes reach a caller as is, so no redaction can mask a secret
 * in them; `complete` bytes are only ever turned into text, which the registry redacts. Every
 * admission in one read uses the same view, so it is fixed per read rather than chosen per call.
 */
type ArtifactView = 'opaque' | 'complete'

const defineSnapshotSource = (view: ArtifactView) =>
  defineAuthorizedProjectFileUseCase<
    typeof projectFileOperations.readArtifact,
    ArtifactInput,
    SourceSnapshot
  >({
    operation: projectFileOperations.readArtifact,
    async execute({
      context,
      tx,
    }: {
      context: ProjectFileAuthorizationContext
      tx: DbTransaction
      input: ArtifactInput
    }) {
      const file = context.file
      if (!file) throw new OrchestrationError('not_found', 'File not found')
      const evidence = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, [file])
      return {
        file,
        owner: context.owner,
        organizationId: context.organizationId,
        secretProvenance: evidence.get(file.id),
      }
    },
    afterSuccess: ({ principal, result }) =>
      requireAdmittedContent(principal, {
        kind: 'workspace-file',
        id: result.file.id,
        provenance: result.secretProvenance ?? { status: 'unknown' },
        view,
      }),
  })

/** Locks the named inputs against the unchanged source and admits their merged provenance before any input read. */
const defineSnapshotDependencies = (view: ArtifactView) =>
  defineAuthorizedProjectFileUseCase<
    typeof projectFileOperations.readArtifact,
    ArtifactInput & { source: WorkspaceFileRow; dependencyIds: string[] },
    { dependencies: WorkspaceFileRow[]; secretProvenance: WorkspaceFileSecretProvenance }
  >({
    operation: projectFileOperations.readArtifact,
    async execute({ input, context, tx }) {
      requireSameRevision(context.file, input.source)
      const dependencies = await loadDependencies(tx, context.owner, input.dependencyIds)
      const evidence = await getBoundWorkspaceFileSecretProvenanceByMetadata(tx, [
        input.source,
        ...dependencies,
      ])
      return {
        dependencies,
        secretProvenance: mergeWorkspaceFileSecretProvenance(...evidence.values()),
      }
    },
    afterSuccess: ({ principal, input, result }) =>
      requireAdmittedContent(principal, {
        kind: 'workspace-file',
        id: input.source.id,
        provenance: result.secretProvenance,
        view,
      }),
  })
type SnapshotDependencies = ReturnType<typeof defineSnapshotDependencies>

async function renderArtifact(
  principal: Principal,
  input: ArtifactInput,
  snapshot: SourceSnapshot,
  snapshotDependencies: SnapshotDependencies,
  signal?: AbortSignal
): Promise<PreparedArtifact> {
  const { file, owner } = snapshot
  const artifact = await resolveDocumentRender(
    file.originalName,
    {
      maxBytes: input.maxBytes,
      signal,
      ...(input.text
        ? {
            tooLargeMessage: (limit: string) =>
              renderedTextTooLargeMessage(file.originalName, limit),
          }
        : {}),
    },
    async (): Promise<PreparedArtifact> => {
      const content = await downloadFile({
        key: file.key,
        context: 'project',
        maxBytes: input.maxBytes,
        signal,
      })
      const plan = await planArtifact(file, content, owner)
      const dependencies =
        plan.dependencyIds.length === 0
          ? []
          : (
              await snapshotDependencies.execute({
                principal,
                input: { ...input, source: file, dependencyIds: plan.dependencyIds },
              })
            ).dependencies
      const inputs = await downloadDependencies(
        dependencies,
        plan.pageHtml
          ? { perFile: MAX_INLINE_IMAGE_BYTES, total: MAX_INLINE_TOTAL_BYTES }
          : { perFile: MAX_DOCUMENT_INPUT_BYTES, total: MAX_DOCUMENT_INPUT_TOTAL_BYTES },
        signal
      )
      if (plan.pageHtml) {
        const byId = new Map(inputs.map((input) => [input.fileId, input]))
        const page = await inlineSimPageImages(
          plan.pageHtml,
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
          source: file,
          dependencies,
          buffer,
          contentType: 'text/html',
          dependsOnReferencedFiles: inputs.length > 0,
        }
      }
      if (plan.generatedDocument && plan.source !== undefined) {
        const compiled = await compileFileDocument({
          owner,
          sourceMime: file.contentType,
          source: plan.source,
          fileName: file.originalName,
          inputs,
          inputIdentity: fileDocumentInputIdentity(owner, dependencies),
          maxBytes: input.maxBytes,
          signal,
        })
        return { source: file, dependencies, ...compiled }
      }
      return {
        source: file,
        dependencies,
        buffer: content,
        contentType: file.contentType,
        dependsOnReferencedFiles: false,
      }
    }
  )
  const derivative = input.preview
    ? await resolveServableImageBytes(artifact.buffer, file.key, { owner })
    : null
  if (derivative)
    assertKnownSizeWithinLimit(derivative.buffer.length, input.maxBytes, 'image preview')
  return { ...artifact, ...derivative }
}

/**
 * Refuses a text read before any byte is fetched, as the workspace text path does. The stored size
 * is authoritative only for an ordinary upload; a generation source is bounded by the render.
 */
function assertTextExtractable(file: WorkspaceFileRow, maxBytes: number) {
  const name = file.originalName
  if (!workspaceFileTextFormat({ name, type: observedMediaType(file.contentType, name) }))
    throw textExtractionUnsupportedError(name)
  const size = getWorkspaceFileSize(file)
  if (!needsRenderedArtifact(file.contentType, name) && size > maxBytes)
    throw textExtractionTooLargeError(name, size, maxBytes)
}

/** Indexing is best effort: a contended or failed requeue never fails a delivered read. */
async function requeueRenderedSearchArtifact(completion: FileSearchArtifactCompletion) {
  try {
    await requeueFileSearchForRenderedArtifact(completion)
  } catch (error) {
    logger.warn('Could not requeue file search for a rendered artifact', {
      fileId: completion.file.fileId,
      error: getErrorMessage(error),
    })
  }
}

/** Renders only source-owned dependencies, then rechecks the source, every input, and current authority. */
function defineArtifactRead(view: ArtifactView) {
  const snapshotSource = defineSnapshotSource(view)
  const snapshotDependencies = defineSnapshotDependencies(view)
  return defineAuthorizedProjectFileUseCase<
    typeof projectFileOperations.readArtifact,
    ArtifactInput,
    ArtifactResult,
    PreparedArtifact
  >({
    operation: projectFileOperations.readArtifact,
    async prepareFromSnapshot({ principal, input, request }) {
      if (
        !Number.isSafeInteger(input.maxBytes) ||
        input.maxBytes <= 0 ||
        input.maxBytes > MAX_BUFFERED_TRANSFER_BYTES
      ) {
        throw new OrchestrationError('validation', 'Invalid document byte limit')
      }
      const snapshot = await snapshotSource.execute({ principal, input })
      if (input.text) assertTextExtractable(snapshot.file, input.maxBytes)
      return runWithOutboundOrganization(snapshot.organizationId, () =>
        renderArtifact(principal, input, snapshot, snapshotDependencies, request?.signal)
      )
    },
    async execute({ input, context, tx, prepared }) {
      if (!prepared) throw new Error('Prepared document is unavailable')
      requireSameRevision(context.file, prepared.source)
      const dependencies = await loadDependencies(
        tx,
        context.owner,
        prepared.dependencies.map((file) => file.id)
      )
      const currentById = new Map(dependencies.map((file) => [file.id, file]))
      for (const expected of prepared.dependencies)
        requireSameRevision(currentById.get(expected.id), expected)
      const source = context.file
      if (!source) throw new OrchestrationError('not_found', 'File not found')
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
      const folders =
        source.folderId && !input.skipFolderPath
          ? await listFileFolders(context.owner, { scope: 'all' }, tx)
          : []
      const result = {
        file: mapFileRecord(source, context.owner, buildWorkspaceFileFolderPathMap(folders)),
        buffer: prepared.buffer,
        contentType: prepared.contentType,
        dependsOnReferencedFiles: prepared.dependsOnReferencedFiles,
        secretProvenance,
        receipt: createFileReadReceipt(context.owner, [source, ...dependencies]),
      }
      if (prepared.artifactKey)
        renderedSearchArtifacts.set(result, {
          owner: context.owner,
          file: { fileId: source.id, key: source.key, contentUpdatedAt: source.contentUpdatedAt },
          dependencies: dependencies.map((file) => ({
            fileId: file.id,
            key: file.key,
            sourceContentUpdatedAt: file.contentUpdatedAt,
          })),
          artifactKey: prepared.artifactKey,
        })
      return result
    },
    async afterSuccess({ principal, result }) {
      await requireAdmittedContent(principal, {
        kind: 'workspace-file',
        id: result.file.id,
        provenance: result.secretProvenance,
        view,
      })
      await reportWorkspaceFileDelivery(result.secretProvenance, result.file.id)
      const completion = renderedSearchArtifacts.get(result)
      renderedSearchArtifacts.delete(result)
      if (completion) await requeueRenderedSearchArtifact(completion)
    },
  })
}

/** A Project file's stored or rendered bytes. No redaction reaches them, so a secret refuses the read. */
export const readProjectFileArtifact = defineArtifactRead('opaque')

/** Admitted as text, so these bytes never leave except as extracted text. */
const readProjectFileArtifactAsText = defineArtifactRead('complete')

interface ProjectFileTextInput extends ProjectFileTarget {
  fileId: string
  maxBytes?: number
  offset?: number
  limit?: number
  skipFolderPath?: boolean
}

interface ProjectFileTextResult extends ExtractedFileText {
  file: OwnedFileRecord<ProjectOwner>
  contentType: string
  secretProvenance: WorkspaceFileSecretProvenance
}

/**
 * Reads a Project file's text the way a workspace file's text is read: the source and every input
 * a render embeds are admitted as `complete`, the registry masks their secrets, and only text
 * leaves. A generated document is read from its rendered artifact, like the workspace path.
 *
 * Only a ranged read is redacted here, before the window is cut. Whole-file text comes back raw:
 * the caller must import `secretProvenance` into its egress registry before the text reaches an
 * agent, as `importProjectFileProvenance` does.
 */
export const readProjectFileText: AuthorizingUseCase<
  typeof projectFileOperations.readArtifact,
  ProjectFileTextInput,
  ProjectFileTextResult
> = {
  operation: readProjectFileArtifactAsText.operation,
  delegationAudience: readProjectFileArtifactAsText.delegationAudience,
  authorize: (args) =>
    readProjectFileArtifactAsText.authorize({
      ...args,
      input: {
        projectId: args.input.projectId,
        fileId: args.input.fileId,
        maxBytes: MAX_TEXT_EXTRACTION_BYTES,
      },
    }),
  async execute(args) {
    const { input, principal } = args
    const maxBytes = Math.min(
      input.maxBytes ?? MAX_TEXT_EXTRACTION_BYTES,
      MAX_TEXT_EXTRACTION_BYTES
    )
    const artifact = await readProjectFileArtifactAsText.execute({
      ...args,
      input: {
        projectId: input.projectId,
        fileId: input.fileId,
        maxBytes,
        text: true,
        skipFolderPath: input.skipFolderPath,
      },
    })
    const format = workspaceFileTextFormat({ name: artifact.file.name, type: artifact.contentType })
    if (!format) throw textExtractionUnsupportedError(artifact.file.name)
    const extracted = await extractFileTextFromBytes(
      artifact.buffer,
      format,
      artifact.file.name,
      input,
      {
        principal,
        kind: 'workspace-file',
        signal: args.request?.signal,
      }
    )
    return {
      ...extracted,
      file: artifact.file,
      contentType: artifact.contentType,
      secretProvenance: artifact.secretProvenance,
    }
  },
}
