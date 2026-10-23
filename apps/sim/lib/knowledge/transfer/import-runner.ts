import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/attribution'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { generateRequestId } from '@/lib/core/utils/request'
import { createWorkspaceDocumentProcessingBillingContext } from '@/lib/knowledge/documents/processing-payload'
import {
  createSingleDocument,
  type PreparedDocumentIndex,
  processDocumentAsync,
} from '@/lib/knowledge/documents/service'
import { uploadKnowledgeArtifact } from '@/lib/knowledge/documents/storage-upload'
import { getConfiguredKbEmbedding, type KbEmbeddingTarget } from '@/lib/knowledge/embeddings'
import { createAuthorizedKnowledgeBase, deleteKnowledgeBase } from '@/lib/knowledge/service'
import { createTagDefinition } from '@/lib/knowledge/tags/service'
import { validateTagValue, validateTagValueLength } from '@/lib/knowledge/tags/utils'
import type {
  KnowledgeBundleDocument,
  KnowledgeBundleManifest,
} from '@/lib/knowledge/transfer/bundle'
import {
  type KnowledgeBundleReader,
  openKnowledgeBundle,
} from '@/lib/knowledge/transfer/import-archive'
import {
  claimKnowledgeImport,
  findKnowledgeImport,
  finishKnowledgeImport,
  KNOWLEDGE_IMPORT_STORAGE_CONTEXT,
  type KnowledgeImportFailure,
  MAX_KNOWLEDGE_IMPORT_FAILURE_SAMPLES,
  updateRunningKnowledgeImport,
} from '@/lib/knowledge/transfer/import-jobs'
import { generateKnowledgeBaseFileKey } from '@/lib/uploads/contexts/knowledge-base/file-manager'
import { deleteFile, downloadFileStream } from '@/lib/uploads/core/storage-service'
import {
  EMPTY_KNOWLEDGE_DOCUMENT_MESSAGE,
  MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
} from '@/lib/uploads/shared/types'
import { getFileExtension } from '@/lib/uploads/utils/file'
import { isSupportedExtension, validateFileType } from '@/lib/uploads/utils/validation'

const logger = createLogger('KnowledgeImportRunner')

/**
 * Documents imported at once, so one document's storage upload and indexing
 * overlap another's while at most two 100 MB originals are held in memory.
 */
const DOCUMENT_CONCURRENCY = 2

/**
 * What a worker needs to run an import. The base it creates takes the import's
 * id, so every dispatch of one import names the same base, and the import's
 * audit names it before it exists.
 */
export interface KnowledgeImportPayload {
  importId: string
  workspaceId: string
  /** The person the base and its documents are attributed to. */
  userId: string
  /** Overrides the bundle's own knowledge base name. */
  name?: string
  /** Storage key of the uploaded bundle, deleted once the import settles. */
  sourceKey: string
  billingAttribution: BillingAttributionSnapshot
}

/**
 * Whether the bundle's vectors can be stored as they are. A vector is only
 * meaningful to the model that produced it, so anything else is re-embedded.
 */
function canReuseVectors(manifest: KnowledgeBundleManifest, target: KbEmbeddingTarget): boolean {
  return (
    manifest.embedding.vectorsIncluded &&
    manifest.embedding.model === target.model &&
    manifest.embedding.dimension === target.dimensions
  )
}

/**
 * The bundle's tag values in the shape document creation reads, refused here
 * with a caller-facing reason when one would not be accepted. Dates travel as
 * ISO timestamps but are stored as calendar days.
 */
function documentTagsData(
  document: KnowledgeBundleDocument,
  manifest: KnowledgeBundleManifest
): string | undefined {
  const tags = manifest.tags.flatMap((tag) => {
    const wire = document.tags[tag.slot]
    if (wire === undefined) return []
    const value = tag.fieldType === 'date' ? wire.slice(0, 10) : wire
    const invalid =
      validateTagValueLength(tag.displayName, value) ??
      validateTagValue(tag.displayName, value, tag.fieldType)
    if (invalid) throw new OrchestrationError('validation', invalid)
    return [{ tagName: tag.displayName, fieldType: tag.fieldType, value }]
  })
  return tags.length > 0 ? JSON.stringify(tags) : undefined
}

/** A failure's own message when it is caller-fixable, or `null` when its text is internal. */
function callerMessage(error: unknown): string | null {
  const classified = asOrchestrationError(error)
  return classified && classified.code !== 'internal' ? classified.message : null
}

/**
 * The name a document rebuilt from its chunk text is stored under. Parsing
 * goes by extension first, so a name claiming another format gains `.txt`
 * and a reprocess reads the text it holds.
 */
function textFilename(filename: string): string {
  const extension = getFileExtension(filename)
  return isSupportedExtension(extension) && extension !== 'txt' ? `${filename}.txt` : filename
}

interface ImportDocumentContext {
  payload: KnowledgeImportPayload
  reader: KnowledgeBundleReader
  knowledgeBaseId: string
  reuseVectors: boolean
}

/**
 * Brings one document over. Its original file is stored the way an upload
 * stores one; a document the bundle carries only as chunks is stored as the
 * plain text those chunks hold, so it can still be reprocessed later. Chunks
 * are indexed in place when their vectors can be reused or there is no
 * original to parse; otherwise the file is queued for ordinary processing,
 * exactly as an upload is.
 */
async function importDocument(
  context: ImportDocumentContext,
  document: KnowledgeBundleDocument
): Promise<void> {
  const { payload, reader, knowledgeBaseId, reuseVectors } = context
  const requestId = generateRequestId()
  const documentId = generateId()
  const documentTags = documentTagsData(document, reader.manifest)

  const prepared: PreparedDocumentIndex | null =
    document.chunks !== null && (reuseVectors || !document.file)
      ? await reader.readChunks(
          {
            chunks: document.chunks,
            chunkCount: document.chunkCount,
            characterCount: document.characterCount,
          },
          reuseVectors
        )
      : null

  let source: { bytes: Buffer; filename: string; mimeType: string }
  if (document.file) {
    const fileTypeError = validateFileType(document.filename, document.mimeType)
    if (fileTypeError) throw new OrchestrationError('validation', fileTypeError.message)
    source = {
      bytes: await reader.readFile(document.file),
      filename: document.filename,
      mimeType: document.mimeType,
    }
  } else if (prepared) {
    const bytes = Buffer.from(prepared.chunks.map((chunk) => chunk.text).join('\n\n'))
    if (bytes.byteLength === 0) {
      throw new OrchestrationError('validation', EMPTY_KNOWLEDGE_DOCUMENT_MESSAGE)
    }
    if (bytes.byteLength > MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE) {
      throw new OrchestrationError(
        'payload_too_large',
        'Document text exceeds the 100MB knowledge document limit'
      )
    }
    source = { bytes, filename: textFilename(document.filename), mimeType: 'text/plain' }
  } else {
    throw new Error(`Bundle document ${document.id} has neither a file nor chunks`)
  }

  const uploadedArtifact = await uploadKnowledgeArtifact({
    documentId,
    key: generateKnowledgeBaseFileKey(source.filename),
    owner: { workspaceId: payload.workspaceId, userId: payload.userId },
    artifact: { bytes: source.bytes, fileName: source.filename, mimeType: source.mimeType },
  })
  const docData = {
    filename: source.filename,
    fileUrl: `${uploadedArtifact.path}?context=knowledge-base`,
    fileSize: source.bytes.byteLength,
    mimeType: source.mimeType,
  }
  await createSingleDocument(
    { ...docData, documentTagsData: documentTags },
    knowledgeBaseId,
    requestId,
    payload.userId,
    documentId,
    undefined,
    {
      expectedWorkspaceId: payload.workspaceId,
      enabled: document.enabled,
      uploadedArtifact,
      ...(prepared
        ? {}
        : {
            processing: {
              processingOptions: {},
              billingAttribution: payload.billingAttribution,
            },
          }),
    }
  )

  if (prepared) {
    await processDocumentAsync(
      knowledgeBaseId,
      documentId,
      docData,
      {},
      createWorkspaceDocumentProcessingBillingContext(payload.billingAttribution),
      undefined,
      { chargedAtDispatch: false, preparedIndex: prepared }
    )
  }
}

/**
 * Creates the base the bundle describes, with its tag definitions, and
 * imports every document in manifest order. A document that cannot be
 * imported is recorded and skipped; anything that stops the base itself from
 * being created fails the whole import.
 */
async function importBundle(
  payload: KnowledgeImportPayload,
  reader: KnowledgeBundleReader
): Promise<void> {
  const { manifest } = reader
  const target = await getConfiguredKbEmbedding()
  const reuseVectors = canReuseVectors(manifest, target)
  const requestId = generateRequestId()
  await reader.validateChunks(reuseVectors)

  // A cancel that landed while the bundle was downloading or being validated stops it here.
  if (!(await updateRunningKnowledgeImport(payload.importId, {}))) return
  const knowledgeBase = await createAuthorizedKnowledgeBase(
    {
      id: payload.importId,
      name: payload.name ?? manifest.knowledgeBase.name,
      description: manifest.knowledgeBase.description ?? undefined,
      workspaceId: payload.workspaceId,
      folderId: null,
      userId: payload.userId,
      embeddingModel: target.model,
      embeddingDimension: target.dimensions,
      chunkingConfig: manifest.knowledgeBase.chunkingConfig,
    },
    requestId
  )
  const attached = await updateRunningKnowledgeImport(payload.importId, {
    knowledgeBaseId: knowledgeBase.id,
    documentsTotal: manifest.documents.length,
    vectorsReused: reuseVectors,
  })
  if (!attached) {
    // Canceled between the check above and now: the base is still empty, so it goes too.
    await deleteKnowledgeBase(knowledgeBase.id, requestId)
    return
  }

  try {
    for (const tag of manifest.tags) {
      await createTagDefinition(
        {
          knowledgeBaseId: knowledgeBase.id,
          tagSlot: tag.slot,
          displayName: tag.displayName,
          fieldType: tag.fieldType,
        },
        requestId
      )
    }
  } catch (error) {
    // No document has landed yet, so a base without its tags is removed rather than kept half-built.
    await deleteKnowledgeBase(knowledgeBase.id, requestId)
    throw error
  }

  const context: ImportDocumentContext = {
    payload,
    reader,
    knowledgeBaseId: knowledgeBase.id,
    reuseVectors,
  }
  let documentsImported = 0
  let documentsFailed = 0
  const failures: KnowledgeImportFailure[] = []
  // Chained so concurrent documents report in order; each write reads the counts as they stand.
  let reported = Promise.resolve(true)
  const report = () => {
    reported = reported.then(
      (running) =>
        running &&
        updateRunningKnowledgeImport(payload.importId, {
          documentsImported,
          documentsFailed,
          failures: [...failures],
        })
    )
    return reported
  }
  let stopped = false
  await mapWithConcurrency(manifest.documents, DOCUMENT_CONCURRENCY, async (document) => {
    if (stopped) return
    try {
      await importDocument(context, document)
      documentsImported++
    } catch (error) {
      documentsFailed++
      if (failures.length < MAX_KNOWLEDGE_IMPORT_FAILURE_SAMPLES) {
        failures.push({
          filename: document.filename,
          message: callerMessage(error) ?? 'This document could not be imported',
        })
      }
      logger.warn('Knowledge import skipped a document', {
        importId: payload.importId,
        knowledgeBaseId: knowledgeBase.id,
        bundleDocumentId: document.id,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
    if (!(await report())) stopped = true
  })
  if (stopped || !(await reported)) return
  await finishKnowledgeImport(payload.importId, { status: 'completed' })
  logger.info('Knowledge import completed', {
    importId: payload.importId,
    knowledgeBaseId: knowledgeBase.id,
    documentsImported,
    documentsFailed,
    vectorsReused: reuseVectors,
  })
}

/**
 * Runs one import to a settled state. The worker claims the import first, so a
 * second dispatch of it leaves the first worker's bundle alone. The bundle is
 * copied to local disk so its entries can be read by offset, and both copies
 * are removed however the import ends.
 */
export async function runKnowledgeImport(payload: KnowledgeImportPayload): Promise<void> {
  if (!(await claimKnowledgeImport(payload.importId))) {
    // Settled before any worker claimed it, so no worker is reading the bundle.
    const record = await findKnowledgeImport({ importId: payload.importId })
    if (record && !record.startedAt) await deleteBundle(payload)
    return
  }
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-import-'))
  let reader: KnowledgeBundleReader | undefined
  try {
    const path = join(directory, 'bundle.zip')
    await pipeline(
      await downloadFileStream({
        key: payload.sourceKey,
        context: KNOWLEDGE_IMPORT_STORAGE_CONTEXT,
      }),
      createWriteStream(path)
    )
    reader = await openKnowledgeBundle(path)
    await importBundle(payload, reader)
  } catch (error) {
    const message = callerMessage(error)
    if (!message) logger.error('Knowledge import failed', { importId: payload.importId, error })
    await finishKnowledgeImport(payload.importId, {
      status: 'failed',
      error: message ?? 'Knowledge base import failed',
    }).catch((finishError: unknown) => {
      logger.error('Failed to record a knowledge import failure', {
        importId: payload.importId,
        error: getErrorMessage(finishError, 'Unknown error'),
      })
    })
  } finally {
    reader?.close()
    await rm(directory, { recursive: true, force: true })
    await deleteBundle(payload)
  }
}

async function deleteBundle(payload: KnowledgeImportPayload): Promise<void> {
  await deleteFile({ key: payload.sourceKey, context: KNOWLEDGE_IMPORT_STORAGE_CONTEXT }).catch(
    (error: unknown) => {
      logger.warn('Failed to delete an imported knowledge bundle', {
        importId: payload.importId,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }
  )
}
