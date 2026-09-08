import { db } from '@sim/db'
import {
  document,
  documentSecretProvenance,
  embedding,
  embeddingSecretProvenance,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  knowledgeConnector,
  workspace as workspaceTable,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { tasks } from '@trigger.dev/sdk'
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { searchFilter } from '@/lib/api/list-query'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  assertBillingAttributionOwner,
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { recordUsage } from '@/lib/billing/core/usage-log'
import {
  applyStorageUsageDeltasInTx,
  checkAndIncrementStorageUsageInTx,
  checkStorageQuota,
  checkStorageQuotaForBillingContext,
  incrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext,
  type StorageBillingContext,
  StorageLimitExceededError,
} from '@/lib/billing/storage'
import {
  checkAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold,
} from '@/lib/billing/threshold-billing'
import type { ChunkingStrategy, StrategyOptions } from '@/lib/chunkers/types'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { env, envNumber } from '@/lib/core/config/env'
import { getCostMultiplier, isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { isInsideTriggerRun } from '@/lib/core/config/trigger-runtime'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ResourceOwner,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  assertKnowledgeEmbeddingCapacity,
  BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE,
  EMBEDDING_QUOTA_EXHAUSTED_MESSAGE,
  getEmbeddingAggregateItemLimit,
  isBYOKEmbeddingCredentialRejection,
  isEmbeddingQuotaExhaustion,
} from '@/lib/embeddings'
import {
  type DurableSecretProvenance,
  durableSecretProvenanceFromRegistry,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  mergeDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import {
  type KnowledgeAccessScope,
  SYSTEM_ACCESS_SCOPE,
  type SystemAccessScope,
} from '@/lib/knowledge/access/types'
import { assertSyncLeaseHeldInTx, type SyncWriteLease } from '@/lib/knowledge/connectors/sync-lock'
import {
  assertDocumentChunkCountWithinLimit,
  isPermanentDocumentProcessingError,
  isUsageLimitDocumentProcessingError,
  PermanentDocumentProcessingError,
  toPermanentDocumentProcessingError,
  UsageLimitDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import {
  processDocument,
  type SourceFileAccess,
} from '@/lib/knowledge/documents/document-processor'
import {
  failStaleDocumentProcessingClaim,
  recordUndispatchedDocumentFailure,
} from '@/lib/knowledge/documents/processing-claim'
import { enqueueKnowledgeDocumentProcessing } from '@/lib/knowledge/documents/processing-outbox-event'
import {
  assertDocumentProcessingBillingContext,
  createDocumentProcessingPayload,
  createNonWorkspaceDocumentProcessingBillingContext,
  createOrganizationDocumentProcessingBillingContext,
  createWorkspaceDocumentProcessingBillingContext,
  type DocumentProcessingBillingContext,
  type DocumentProcessingPayload,
  hasDocumentProcessingBillingScope,
} from '@/lib/knowledge/documents/processing-payload'
import { scheduleDocumentProcessingQuotaContinuation } from '@/lib/knowledge/documents/processing-quota-continuation'
import { DOCUMENT_PROCESSING_STALE_THRESHOLD_MS } from '@/lib/knowledge/documents/processing-timeouts.server'
import {
  buildTagFilterCondition,
  type TagFilterCondition,
} from '@/lib/knowledge/documents/tag-filter'
import {
  type DocumentSortField,
  MAX_PROCESSING_ATTEMPTS,
  QUEUED_DISPATCH_GRACE_MS,
  type SortOrder,
} from '@/lib/knowledge/documents/types'
import {
  getEmbeddingModelInfo,
  MAX_KB_EMBEDDING_DIMENSIONS,
  toKbEmbeddingDimensions,
} from '@/lib/knowledge/embedding-models'
import { generateEmbeddings, type KbEmbeddingTarget } from '@/lib/knowledge/embeddings'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import {
  bindKnowledgeDocumentFieldSecretProvenance,
  createKnowledgeDocumentSourceValue,
  type KnowledgeDocumentMetadataField,
  type KnowledgeDocumentWriteSecretProvenance,
  loadKnowledgeDocumentSecretRegistry,
  readBoundKnowledgeDocumentSecretProvenance,
  rebindKnowledgeDocumentSecretProvenance,
  replaceKnowledgeDocumentSecretProvenanceInTx,
} from '@/lib/knowledge/secret-provenance'
import {
  buildUndefinedTagsError,
  parseBooleanValue,
  parseDateValue,
  parseNumberValue,
  uncompilableTagFilterError,
  validateTagValue,
} from '@/lib/knowledge/tags/utils'
import type { ProcessedDocumentTags } from '@/lib/knowledge/types'
import { embeddingVectorValues } from '@/lib/knowledge/vector-columns'
import { estimateTokenCount } from '@/lib/tokenization/estimators'
import {
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import {
  deleteFileMetadataByIdentity,
  type FileMetadataRecord,
  getFileMetadataByKeys,
} from '@/lib/uploads/server/metadata'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import type { processDocument as processDocumentTask } from '@/background/knowledge-processing'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('DocumentService')

/**
 * Thrown when a knowledge-base document's `fileUrl` references an internal
 * knowledge-base storage object not owned by the target knowledge base's workspace.
 * Routes map this to a 403.
 *
 * Deliberately carries no `details.code`. It belongs to the cross-tenant class
 * the closed set in `lib/core/application/forbidden.ts` excludes: it fires
 * identically for a key bound to another tenant and for a key bound to nothing
 * at all, so the single fixed message is the whole of what a caller may learn,
 * and a machine-readable name would only invite a client to read resource
 * existence into it.
 */
export class KnowledgeBaseFileOwnershipError extends OrchestrationError {
  constructor(public readonly storageKey: string) {
    super('forbidden', 'Document file is not owned by this knowledge base')
    this.name = 'KnowledgeBaseFileOwnershipError'
  }
}

/**
 * Guard document `fileUrl`s at creation time. When a URL points at an internal
 * knowledge-base storage object, require that the target knowledge base owns the object,
 * resolved from the trusted `workspace_files` binding:
 *
 * - Workspace KB (`kbWorkspaceId` set): the binding's `workspaceId` must match.
 * - Personal KB (`kbWorkspaceId` null): the binding's `userId` must be the KB
 *   owner. A key bound to another tenant is rejected; an unbound key (legacy /
 *   never reserved) passes since it carries no cross-tenant ownership.
 *
 * External `http(s)`/`data:` URLs (ingestion sources) and other internal keys
 * pass through unchanged. This blocks a user from asserting ownership of another
 * tenant's object via a planted `fileUrl` — including in a personal KB, which
 * otherwise could be moved into a workspace to launder the binding. All
 * referenced bindings are resolved in one query (no N+1 inside the `FOR UPDATE`
 * window). Single-document callers pass a one-element array.
 */
function isKnowledgeBaseOwnedStorageKey(key: string): boolean {
  return key.startsWith('kb/') || key.startsWith('knowledge-base/')
}

function getKnowledgeBaseStorageKeys(fileUrls: readonly string[]): string[] {
  return [
    ...new Set(
      fileUrls
        .map((url) => getKnowledgeBaseStorageKey(url))
        .filter(
          (key): key is string => typeof key === 'string' && isKnowledgeBaseOwnedStorageKey(key)
        )
    ),
  ]
}

function getWorkspaceSourceStorageKeys(fileUrls: readonly string[]): string[] {
  return [
    ...new Set(
      fileUrls
        .map((url) => getKnowledgeBaseStorageKey(url))
        .filter((key): key is string => typeof key === 'string' && key.startsWith('workspace/'))
    ),
  ]
}

async function loadKnowledgeBaseFileBindings(
  fileUrls: readonly string[],
  executor: DbExecutor = db
): Promise<Map<string, FileMetadataRecord>> {
  const keys = getKnowledgeBaseStorageKeys(fileUrls)
  const bindings =
    keys.length > 0 ? await getFileMetadataByKeys(keys, 'knowledge-base', executor) : []

  return new Map(bindings.map((binding) => [binding.key, binding]))
}

async function loadWorkspaceSourceFileBindings(
  fileUrls: readonly string[],
  executor: DbExecutor = db
): Promise<Map<string, FileMetadataRecord>> {
  const keys = getWorkspaceSourceStorageKeys(fileUrls)
  if (keys.length === 0) return new Map()

  const workspaceBindings = await getFileMetadataByKeys(keys, 'workspace', executor)
  const mothershipBindings = await getFileMetadataByKeys(keys, 'mothership', executor)

  return new Map(
    [...workspaceBindings, ...mothershipBindings].map((binding) => [binding.key, binding])
  )
}

async function assertKnowledgeBaseFileUrlsOwnership(
  fileUrls: string[],
  kbWorkspaceId: string | null,
  kbUserId: string,
  requestId: string,
  executor: DbExecutor = db
): Promise<Map<string, FileMetadataRecord>> {
  const keys = getKnowledgeBaseStorageKeys(fileUrls)
  if (keys.length === 0) {
    return new Map()
  }

  const bindingByKey = await loadKnowledgeBaseFileBindings(fileUrls, executor)

  for (const key of keys) {
    const binding = bindingByKey.get(key)

    if (kbWorkspaceId) {
      if (!binding || binding.workspaceId !== kbWorkspaceId) {
        logger.warn(`[${requestId}] Rejected document referencing unowned knowledge-base file`, {
          storageKey: key,
          kbWorkspaceId,
          bindingWorkspaceId: binding?.workspaceId ?? null,
        })
        throw new KnowledgeBaseFileOwnershipError(key)
      }
      continue
    }

    // Personal KB: reject a key whose binding belongs to a different user. An
    // unbound key carries no ownership and is allowed (legacy personal files).
    if (binding && binding.userId !== kbUserId) {
      logger.warn(
        `[${requestId}] Rejected personal-KB document referencing another tenant's file`,
        {
          storageKey: key,
          kbUserId,
          bindingUserId: binding.userId,
          bindingWorkspaceId: binding.workspaceId ?? null,
        }
      )
      throw new KnowledgeBaseFileOwnershipError(key)
    }
  }

  return bindingByKey
}

async function loadCurrentWorkspaceSourceFileSecretProvenance(options: {
  fileUrl: string
}): Promise<DurableSecretProvenance | undefined> {
  const storageKey = getKnowledgeBaseStorageKey(options.fileUrl)
  if (!storageKey?.startsWith('workspace/')) return undefined

  const bindingByKey = await loadWorkspaceSourceFileBindings([options.fileUrl])
  const binding = bindingByKey.get(storageKey)
  if (!binding) return undefined

  const provenanceById = await getBoundWorkspaceFileSecretProvenanceByMetadata(db, [binding])
  const provenance = provenanceById.get(binding.id) ?? { status: 'unknown' as const }
  return durableSecretProvenanceFromWorkspaceFile(provenance, binding)
}

const TIMEOUTS = {
  OVERALL_PROCESSING: envNumber(env.KB_CONFIG_MAX_DURATION, 600) * 1000,
} as const

const LARGE_DOC_CONFIG = {
  MAX_CHUNKS_PER_BATCH: 500,
  MAX_EMBEDDING_BATCH: Math.min(
    envNumber(env.KB_CONFIG_BATCH_SIZE, 2000, { min: 1, integer: true }),
    getEmbeddingAggregateItemLimit(MAX_KB_EMBEDDING_DIMENSIONS)
  ),
  MAX_FILE_SIZE: 100 * 1024 * 1024,
}

const HARD_DELETE_DOCUMENT_BATCH_SIZE = 250

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operation = 'Operation'
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${operation} timed out after ${timeoutMs}ms`)
          controller.abort(error)
          reject(error)
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    controller.abort(error)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Limits for the in-process document path.
 *
 * Both values used to be derived from variables owned by other subsystems —
 * documents-at-once from the task-queue depth, documents-per-batch from the
 * chunks-per-embedding-request size — so tuning either of those silently moved
 * this one too, by a factor set by the divisor rather than by intent. The
 * divisors are gone and the previous effective values (4 and 10) are now the
 * declared defaults.
 */
const PROCESSING_CONFIG = {
  maxConcurrentDocuments: envNumber(env.KB_CONFIG_DOCUMENT_CONCURRENCY, 4, { min: 1 }),
  batchSize: envNumber(env.KB_CONFIG_DOCUMENT_BATCH_SIZE, 10, { min: 1 }),
  delayBetweenBatches: envNumber(env.KB_CONFIG_DELAY_BETWEEN_BATCHES, 100) * 2,
  delayBetweenDocuments: envNumber(env.KB_CONFIG_DELAY_BETWEEN_DOCUMENTS, 50) * 2,
}

export function getProcessingConfig() {
  return PROCESSING_CONFIG
}

export interface DocumentData {
  documentId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
}

export interface ProcessingOptions {
  recipe?: string
  lang?: string
}

interface DocumentTagData {
  tagName: string
  fieldType: string
  value: string
}

type TagDefinition = typeof knowledgeBaseTagDefinitions.$inferSelect
type TagDefinitionsByName = Map<string, TagDefinition>
type DbExecutor = Pick<typeof db, 'select'>

async function loadTagDefinitions(
  knowledgeBaseId: string,
  executor: DbExecutor = db
): Promise<TagDefinitionsByName> {
  const defs = await executor
    .select()
    .from(knowledgeBaseTagDefinitions)
    .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId))
  return new Map(defs.map((def) => [def.displayName, def]))
}

function resolveDocumentTags(
  tagData: DocumentTagData[],
  tagDefinitions: TagDefinitionsByName,
  requestId: string
): ProcessedDocumentTags {
  const setTagValue = (
    tags: ProcessedDocumentTags,
    slot: string,
    value: string | number | Date | boolean | null
  ): void => {
    switch (slot) {
      case 'tag1':
        tags.tag1 = value as string | null
        break
      case 'tag2':
        tags.tag2 = value as string | null
        break
      case 'tag3':
        tags.tag3 = value as string | null
        break
      case 'tag4':
        tags.tag4 = value as string | null
        break
      case 'tag5':
        tags.tag5 = value as string | null
        break
      case 'tag6':
        tags.tag6 = value as string | null
        break
      case 'tag7':
        tags.tag7 = value as string | null
        break
      case 'number1':
        tags.number1 = value as number | null
        break
      case 'number2':
        tags.number2 = value as number | null
        break
      case 'number3':
        tags.number3 = value as number | null
        break
      case 'number4':
        tags.number4 = value as number | null
        break
      case 'number5':
        tags.number5 = value as number | null
        break
      case 'date1':
        tags.date1 = value as Date | null
        break
      case 'date2':
        tags.date2 = value as Date | null
        break
      case 'boolean1':
        tags.boolean1 = value as boolean | null
        break
      case 'boolean2':
        tags.boolean2 = value as boolean | null
        break
      case 'boolean3':
        tags.boolean3 = value as boolean | null
        break
    }
  }

  const result: ProcessedDocumentTags = {
    tag1: null,
    tag2: null,
    tag3: null,
    tag4: null,
    tag5: null,
    tag6: null,
    tag7: null,
    number1: null,
    number2: null,
    number3: null,
    number4: null,
    number5: null,
    date1: null,
    date2: null,
    boolean1: null,
    boolean2: null,
    boolean3: null,
  }

  if (!Array.isArray(tagData) || tagData.length === 0) {
    return result
  }

  const undefinedTags: string[] = []
  const typeErrors: string[] = []

  for (const tag of tagData) {
    if (!tag.tagName?.trim()) continue

    const tagName = tag.tagName.trim()
    const fieldType = tag.fieldType || 'text'

    const hasValue =
      fieldType === 'boolean'
        ? tag.value !== undefined && tag.value !== null && tag.value !== ''
        : tag.value?.trim && tag.value.trim().length > 0

    if (!hasValue) continue

    const existingDef = tagDefinitions.get(tagName)
    if (!existingDef) {
      undefinedTags.push(tagName)
      continue
    }

    const rawValue = typeof tag.value === 'string' ? tag.value.trim() : tag.value
    const actualFieldType = existingDef.fieldType || fieldType
    const validationError = validateTagValue(tagName, String(rawValue), actualFieldType)
    if (validationError) {
      typeErrors.push(validationError)
    }
  }

  if (undefinedTags.length > 0 || typeErrors.length > 0) {
    const errorParts: string[] = []

    if (undefinedTags.length > 0) {
      errorParts.push(buildUndefinedTagsError(undefinedTags))
    }

    if (typeErrors.length > 0) {
      errorParts.push(...typeErrors)
    }

    throw new Error(errorParts.join('\n'))
  }

  for (const tag of tagData) {
    if (!tag.tagName?.trim()) continue

    const tagName = tag.tagName.trim()
    const fieldType = tag.fieldType || 'text'

    const hasValue =
      fieldType === 'boolean'
        ? tag.value !== undefined && tag.value !== null && tag.value !== ''
        : tag.value?.trim && tag.value.trim().length > 0

    if (!hasValue) continue

    const existingDef = tagDefinitions.get(tagName)
    if (!existingDef) continue

    const targetSlot = existingDef.tagSlot
    const actualFieldType = existingDef.fieldType || fieldType
    const rawValue = typeof tag.value === 'string' ? tag.value.trim() : tag.value
    const stringValue = String(rawValue).trim()

    if (actualFieldType === 'boolean') {
      setTagValue(result, targetSlot, parseBooleanValue(stringValue) ?? false)
    } else if (actualFieldType === 'number') {
      setTagValue(result, targetSlot, parseNumberValue(stringValue))
    } else if (actualFieldType === 'date') {
      setTagValue(result, targetSlot, parseDateValue(stringValue))
    } else {
      setTagValue(result, targetSlot, stringValue)
    }

    logger.info(`[${requestId}] Set tag ${tagName} (${targetSlot})`, {
      fieldType: actualFieldType,
    })
  }

  return result
}

const KNOWLEDGE_DOCUMENT_TAG_FIELDS = new Set<KnowledgeDocumentMetadataField>([
  'tag1',
  'tag2',
  'tag3',
  'tag4',
  'tag5',
  'tag6',
  'tag7',
  'number1',
  'number2',
  'number3',
  'number4',
  'number5',
  'date1',
  'date2',
  'boolean1',
  'boolean2',
  'boolean3',
])

function durableSecretProvenanceFromWorkspaceFile(
  provenance: WorkspaceFileSecretProvenance,
  binding: FileMetadataRecord
): DurableSecretProvenance {
  /**
   * `unrecorded` is a more specific `unknown`, and this boundary has not opted into the workspace
   * file surface's policy, so it keeps refusing exactly as it did.
   */
  if (provenance.status !== 'exact') return { status: 'unknown' }
  return {
    status: 'exact',
    entries: provenance.entries.map((entry) => ({
      ...entry,
      sourceUserId: binding.userId,
      ...(binding.workspaceId ? { sourceWorkspaceId: binding.workspaceId } : {}),
    })),
  }
}

function bindKnowledgeDocumentWriteSecretProvenance(options: {
  source: ReturnType<typeof createKnowledgeDocumentSourceValue>
  provenance?: KnowledgeDocumentWriteSecretProvenance
  tagDefinitions: TagDefinitionsByName
  boundFile?: {
    binding: FileMetadataRecord
    provenance: WorkspaceFileSecretProvenance
  }
}): DurableSecretProvenance | undefined {
  const values: DurableSecretProvenance[] = []
  if (options.provenance) {
    values.push(
      bindKnowledgeDocumentFieldSecretProvenance(
        options.provenance.filename,
        'filename',
        options.source.filename
      ),
      bindKnowledgeDocumentFieldSecretProvenance(options.provenance.content, 'content', {
        fileUrl: options.source.fileUrl,
        contentHash: options.source.contentHash,
      })
    )
    for (const tag of options.provenance.tags) {
      const tagField = options.tagDefinitions.get(tag.tagName)?.tagSlot
      if (
        !tagField ||
        !KNOWLEDGE_DOCUMENT_TAG_FIELDS.has(tagField as KnowledgeDocumentMetadataField)
      ) {
        return { status: 'unknown' }
      }
      const field = tagField as KnowledgeDocumentMetadataField
      values.push(
        bindKnowledgeDocumentFieldSecretProvenance(tag.provenance, field, options.source[field])
      )
    }
  }
  if (options.boundFile) {
    values.push(
      bindKnowledgeDocumentFieldSecretProvenance(
        durableSecretProvenanceFromWorkspaceFile(
          options.boundFile.provenance,
          options.boundFile.binding
        ),
        'content',
        { fileUrl: options.source.fileUrl, contentHash: options.source.contentHash }
      )
    )
  }
  return values.length > 0 ? mergeDurableSecretProvenance(...values) : undefined
}

/** Per-call cap for `tasks.batchTrigger` on Trigger.dev SDK 4.3.1+. */
const TRIGGER_BATCH_SIZE = 1000

/**
 * Immediate outcome of handing document work to its execution backend.
 *
 * `accepted` means Trigger.dev accepted the child run, the direct fallback
 * finished the job, or a concurrent caller already installed a live queue
 * generation for the document. It deliberately does not claim that an
 * asynchronous child succeeded: that eventual outcome belongs to the document
 * row and child task run, neither of which the dispatching connector waits for.
 */
export interface DocumentProcessingDispatchResult {
  requested: number
  accepted: number
  failed: number
  /** Deduplicated input IDs whose work this call neither accepted nor found live. */
  failedDocumentIds: string[]
}

function buildJobPayload(
  doc: DocumentData,
  knowledgeBaseId: string,
  processingOptions: ProcessingOptions,
  requestId: string,
  processingQueueToken: string,
  processingQueuedAt: Date,
  chargedAtDispatch: boolean,
  billingContext: DocumentProcessingBillingContext
): DocumentProcessingPayload {
  return createDocumentProcessingPayload(
    {
      knowledgeBaseId,
      documentId: doc.documentId,
      docData: {
        filename: doc.filename,
        fileUrl: doc.fileUrl,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
      },
      processingOptions,
      requestId,
      processingQueueToken,
      chargedAtDispatch,
      processingQueuedAt: processingQueuedAt.toISOString(),
    },
    billingContext
  )
}

async function resolveDocumentProcessingBillingContext(
  knowledgeBaseId: string,
  providedBillingAttribution: BillingAttributionSnapshot | undefined
): Promise<DocumentProcessingBillingContext> {
  const [knowledgeBaseContext] = await db
    .select({
      userId: knowledgeBase.userId,
      workspaceId: knowledgeBase.workspaceId,
      organizationId: knowledgeBase.organizationId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (!knowledgeBaseContext) {
    throw new Error(`Knowledge base ${knowledgeBaseId} not found for document processing`)
  }

  if (knowledgeBaseContext.organizationId) {
    if (!providedBillingAttribution)
      throw new Error('Organization processing requires billing attribution')
    assertBillingAttributionOwner(providedBillingAttribution, knowledgeBaseContext)
    return createOrganizationDocumentProcessingBillingContext(providedBillingAttribution)
  }
  if (knowledgeBaseContext.workspaceId) {
    if (!providedBillingAttribution) {
      throw new Error('Workspace document processing requires a billing attribution snapshot')
    }
    const billingContext = createWorkspaceDocumentProcessingBillingContext(
      providedBillingAttribution
    )
    if (billingContext.workspaceId !== knowledgeBaseContext.workspaceId) {
      throw new Error('Document processing workspace does not match billing attribution')
    }
    return billingContext
  }

  if (providedBillingAttribution !== undefined) {
    throw new Error('Non-workspace document processing cannot include billing attribution')
  }

  return createNonWorkspaceDocumentProcessingBillingContext(knowledgeBaseContext.userId)
}

/**
 * Records that indexing has just been queued for these documents.
 *
 * Every dispatch funnels through {@link processDocumentsWithQueue}, so stamping
 * here is what makes `processingQueuedAt` mean "queued for the attempt that is
 * live right now" for every caller — new uploads, connector inserts, connector
 * content updates, the connector recovery sweep, the user retry, and the
 * outbox handler alike. Recovery sweeps age a queued document from this column
 * (`isStuckDocumentSweepEligible`), and a caller that left a previous
 * dispatch's value in place would be aged from a stamp that belongs to a run
 * which has already ended — reclaimed inside its grace period, racing the run
 * that is actually queued.
 *
 * `processingStartedAt` is cleared in the same write: a document waiting in the
 * queue has not started, and a leftover value from a prior run would otherwise
 * be reported as this attempt's start time.
 *
 * Guarded on `pending` and an empty queue timestamp, so concurrent dispatch
 * callers cannot both charge and enqueue the same document. A retained token
 * with no timestamp identifies a withdrawn generation and is atomically
 * replaced here; the old generation can no longer finalize the row afterward.
 * Returning the rows this write claimed lets the caller dispatch only its own
 * generation. A worker that already claimed the row or another caller that
 * already queued it wins cleanly.
 */
interface QueuedDocumentGeneration {
  readonly documentId: string
  readonly processingQueuedAt: Date
  readonly chargedAtDispatch: boolean
}

interface MarkDocumentsQueuedResult {
  readonly generations: QueuedDocumentGeneration[]
  readonly acceptedWithoutDispatchIds: string[]
  readonly unresolvedIds: string[]
}

function acceptedDocumentStateCondition(observedAt: Date): SQL | undefined {
  const queuedCutoff = new Date(observedAt.getTime() - QUEUED_DISPATCH_GRACE_MS)
  const processingCutoff = new Date(observedAt.getTime() - DOCUMENT_PROCESSING_STALE_THRESHOLD_MS)
  return or(
    eq(document.processingStatus, 'completed'),
    and(
      eq(document.processingStatus, 'pending'),
      isNotNull(document.processingQueuedAt),
      gte(document.processingQueuedAt, queuedCutoff)
    ),
    and(
      eq(document.processingStatus, 'processing'),
      isNotNull(document.processingStartedAt),
      gte(document.processingStartedAt, processingCutoff)
    )
  )
}

async function isDocumentAcceptedWithoutDispatch(
  documentId: string,
  knowledgeBaseId: string,
  observedAt: Date
): Promise<boolean> {
  const accepted = await db
    .select({ id: document.id })
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        acceptedDocumentStateCondition(observedAt),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    )
    .limit(1)
  return accepted.length > 0
}

/**
 * The sync run a connector dispatch proves before it queues processing. The
 * document writes prove the lease in their own transactions, but the queue
 * write is a later transaction: a run reclaimed in between would otherwise
 * install a processing generation, spend an attempt, and dispatch a worker
 * beside the replacement run's own dispatch for the same document.
 */
export interface ProcessingDispatchLease extends SyncWriteLease {
  connectorId: string
}

async function markDocumentsQueued(
  documentIds: string[],
  knowledgeBaseId: string,
  queueToken: string,
  queuedAt: Date,
  lease: ProcessingDispatchLease | undefined
): Promise<MarkDocumentsQueuedResult> {
  const legacyAdoptionCutoff = new Date(queuedAt.getTime() - QUEUED_DISPATCH_GRACE_MS)
  return db.transaction(async (tx) => {
    if (lease) await assertSyncLeaseHeldInTx(tx, lease.connectorId, lease)
    const claimed = await tx
      .update(document)
      .set({
        processingQueuedAt: queuedAt,
        processingQueueToken: queueToken,
        processingStartedAt: null,
        processingDeferredUntil: null,
        /**
         * Spent here because this is the one write every dispatch passes through,
         * and it is already guarded — so the budget cannot be charged twice for a
         * single dispatch, nor skipped by a caller that dispatches another way.
         * Refunded by `clearDocumentsQueued` when the dispatch provably never
         * happened, so only attempts a worker could have seen are ever spent.
         */
        processingAttempts: sql`${document.processingAttempts} + 1`,
      })
      .where(
        and(
          inArray(document.id, documentIds),
          eq(document.knowledgeBaseId, knowledgeBaseId),
          eq(document.processingStatus, 'pending'),
          eq(document.userExcluded, false),
          isNull(document.processingQueuedAt),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id })

    const claimedIds = new Set(claimed.map((row) => row.id))
    const unclaimedIds = documentIds.filter((documentId) => !claimedIds.has(documentId))
    const resumed =
      unclaimedIds.length === 0
        ? []
        : await tx
            .update(document)
            .set({ processingQueueToken: queueToken })
            .where(
              and(
                inArray(document.id, unclaimedIds),
                eq(document.knowledgeBaseId, knowledgeBaseId),
                or(
                  and(
                    or(
                      eq(document.processingStatus, 'pending'),
                      eq(document.processingStatus, 'failed')
                    ),
                    eq(document.processingQueueToken, queueToken)
                  ),
                  and(
                    eq(document.processingStatus, 'pending'),
                    isNull(document.processingQueueToken),
                    lt(document.processingQueuedAt, legacyAdoptionCutoff)
                  )
                ),
                isNotNull(document.processingQueuedAt),
                isNull(document.processingDeferredUntil),
                eq(document.userExcluded, false),
                isNull(document.archivedAt),
                isNull(document.deletedAt)
              )
            )
            .returning({ id: document.id, processingQueuedAt: document.processingQueuedAt })

    const resumedIds = new Set(resumed.map((row) => row.id))
    const unresolvedIds = unclaimedIds.filter((documentId) => !resumedIds.has(documentId))
    const acceptedWithoutDispatch =
      unresolvedIds.length === 0
        ? []
        : await tx
            .select({ id: document.id })
            .from(document)
            .where(
              and(
                inArray(document.id, unresolvedIds),
                eq(document.knowledgeBaseId, knowledgeBaseId),
                acceptedDocumentStateCondition(queuedAt),
                eq(document.userExcluded, false),
                isNull(document.archivedAt),
                isNull(document.deletedAt)
              )
            )
            .for('update')

    const acceptedWithoutDispatchIds = acceptedWithoutDispatch.map((row) => row.id)
    const acceptedWithoutDispatchIdSet = new Set(acceptedWithoutDispatchIds)

    return {
      generations: [
        ...claimed.map((row) => ({
          documentId: row.id,
          processingQueuedAt: queuedAt,
          chargedAtDispatch: true,
        })),
        ...resumed.flatMap((row) =>
          row.processingQueuedAt
            ? [
                {
                  documentId: row.id,
                  processingQueuedAt: row.processingQueuedAt,
                  chargedAtDispatch: false,
                },
              ]
            : []
        ),
      ],
      acceptedWithoutDispatchIds,
      unresolvedIds: unresolvedIds.filter(
        (documentId) => !acceptedWithoutDispatchIdSet.has(documentId)
      ),
    }
  })
}

/**
 * Withdraws a live queue timestamp whose dispatch provably never happened.
 *
 * {@link markDocumentsQueued} runs before dispatch on purpose — `batchTrigger`
 * chunks, so a batch can half-succeed, and stamping afterwards would leave the
 * runs that did start with no stamp and no grace. The cost of that ordering is
 * that a batch where *every* dispatch failed still carries a fresh stamp, and
 * recovery sweeps would honour a grace period the documents did not earn. Total
 * failure is the one case where nothing was dispatched, so the timestamp can
 * be taken back and the next sweep is free to reclaim them immediately. The
 * generation token stays until an exact-token failure recorder finalizes it or
 * a newer dispatcher adopts the timestamp-less row. That ownership marker
 * prevents an older recorder from failing a newer blank pending generation.
 *
 * The attempt {@link markDocumentsQueued} charged is refunded in the same
 * statement. The budget exists to stop re-billing a document that keeps failing
 * the same way *in processing*; an attempt that never reached a worker teaches
 * it nothing. Leaving it spent let an infrastructure outage — a Trigger.dev
 * region error, an exhausted quota — burn the allowance without a single run,
 * and {@link MAX_PROCESSING_ATTEMPTS} such outages dead-letter a document the
 * connector sweep then permanently excludes (`processingAttempts <
 * MAX_PROCESSING_ATTEMPTS`), stranding it with no automatic recovery left.
 * Floored at zero so a refund can never drive the count negative, and scoped by
 * the same guard as the stamp, so it can only ever give back the charge this
 * call made.
 *
 * Scoped three ways so it can only ever undo its own write: to the ids in this
 * batch, to rows still `pending` (a worker that has since claimed one keeps its
 * timestamps — see {@link markDocumentsQueued}), and to the exact stamp this
 * call wrote, so a concurrent dispatch that has already re-stamped a document
 * is left alone.
 */
async function clearDocumentsQueued(
  documentIds: string[],
  queueToken: string,
  queuedAt: Date
): Promise<void> {
  await db
    .update(document)
    .set({
      processingQueuedAt: null,
      processingAttempts: sql`GREATEST(${document.processingAttempts} - 1, 0)`,
    })
    .where(
      and(
        inArray(document.id, documentIds),
        eq(document.processingStatus, 'pending'),
        eq(document.processingQueueToken, queueToken),
        eq(document.processingQueuedAt, queuedAt)
      )
    )
}

async function bestEffortWithdrawDocumentsQueued(
  documentIds: string[],
  queueToken: string,
  queuedAt: Date,
  reason: string
): Promise<void> {
  if (documentIds.length === 0) return
  try {
    await clearDocumentsQueued(documentIds, queueToken, queuedAt)
  } catch (error) {
    logger.warn(`[${queueToken}] Failed to withdraw queue ownership after ${reason}`, {
      error: getErrorMessage(error),
    })
  }
}

/**
 * Dispatches document processing jobs via Trigger.dev's `batchTrigger` when
 * available, or in-process otherwise. Throws only when every dispatch fails;
 * partial failures are returned and recovered by the next sync's stuck-doc
 * pass. A successful Trigger.dev hand-off is only an accepted child run, not a
 * claim about its eventual processing outcome. A connector sync passes its
 * lease, and the queue write then lands only while the run still holds it.
 */
export async function processDocumentsWithQueue(
  createdDocuments: DocumentData[],
  knowledgeBaseId: string,
  processingOptions: ProcessingOptions,
  requestId: string,
  billingAttribution: BillingAttributionSnapshot | undefined,
  lease?: ProcessingDispatchLease
): Promise<DocumentProcessingDispatchResult> {
  const seenDocumentIds = new Set<string>()
  const uniqueDocuments = createdDocuments.filter((createdDocument) => {
    if (seenDocumentIds.has(createdDocument.documentId)) return false
    seenDocumentIds.add(createdDocument.documentId)
    return true
  })
  if (uniqueDocuments.length === 0) {
    return { requested: 0, accepted: 0, failed: 0, failedDocumentIds: [] }
  }

  const requested = uniqueDocuments.length
  const queuedAt = new Date()
  const documentIds = uniqueDocuments.map((doc) => doc.documentId)
  const {
    generations: queuedGenerations,
    acceptedWithoutDispatchIds,
    unresolvedIds,
  } = await markDocumentsQueued(documentIds, knowledgeBaseId, requestId, queuedAt, lease)
  const generationByDocumentId = new Map(
    queuedGenerations.map((generation) => [generation.documentId, generation])
  )
  const queuedDocuments = uniqueDocuments.filter((doc) =>
    generationByDocumentId.has(doc.documentId)
  )
  const acceptedWithoutDispatch = acceptedWithoutDispatchIds.length
  const unresolved = unresolvedIds.length
  const newlyClaimedIds = queuedGenerations
    .filter((generation) => generation.chargedAtDispatch)
    .map((generation) => generation.documentId)

  let billingContext: DocumentProcessingBillingContext
  try {
    billingContext = await resolveDocumentProcessingBillingContext(
      knowledgeBaseId,
      billingAttribution
    )
  } catch (error) {
    await bestEffortWithdrawDocumentsQueued(
      newlyClaimedIds,
      requestId,
      queuedAt,
      'billing-context resolution failed'
    )
    throw error
  }

  if (queuedDocuments.length === 0) {
    logger.info(`[${requestId}] No documents were eligible for a new processing dispatch`, {
      acceptedWithoutDispatch,
      unresolved,
    })
    return {
      requested,
      accepted: acceptedWithoutDispatch,
      failed: unresolved,
      failedDocumentIds: unresolvedIds,
    }
  }

  const jobPayloads = queuedDocuments.map((doc) => {
    const generation = generationByDocumentId.get(doc.documentId)!
    return buildJobPayload(
      doc,
      knowledgeBaseId,
      processingOptions,
      requestId,
      requestId,
      generation.processingQueuedAt,
      generation.chargedAtDispatch,
      billingContext
    )
  })

  const useTrigger = isTriggerAvailable()
  logger.info(
    `[${requestId}] Dispatching background processing for ${jobPayloads.length} documents`,
    { backend: useTrigger ? 'trigger-dev' : 'direct' }
  )

  let dispatchedIds: Set<string>
  try {
    dispatchedIds = useTrigger
      ? await dispatchViaBatchTrigger(jobPayloads, requestId)
      : await dispatchInProcess(jobPayloads, requestId)
  } catch (error) {
    await bestEffortWithdrawDocumentsQueued(
      newlyClaimedIds,
      requestId,
      queuedAt,
      'dispatch setup failed'
    )
    throw error
  }

  logger.info(
    `[${requestId}] Document dispatch complete: ${dispatchedIds.size}/${jobPayloads.length} accepted`
  )

  /**
   * Refund every newly owned generation that provably failed before claiming
   * processing, including one failed chunk in an otherwise successful batch.
   */
  const failedNewlyClaimedIds = newlyClaimedIds.filter(
    (documentId) => !dispatchedIds.has(documentId)
  )
  await bestEffortWithdrawDocumentsQueued(
    failedNewlyClaimedIds,
    requestId,
    queuedAt,
    'a newly claimed dispatch failed'
  )

  if (dispatchedIds.size === 0) {
    if (acceptedWithoutDispatch === 0) {
      throw new Error(`All ${jobPayloads.length} document processing dispatches failed`)
    }
  }

  const unresolvedIdSet = new Set(unresolvedIds)
  const failedDocumentIds = uniqueDocuments.flatMap((doc) =>
    unresolvedIdSet.has(doc.documentId) ||
    (generationByDocumentId.has(doc.documentId) && !dispatchedIds.has(doc.documentId))
      ? [doc.documentId]
      : []
  )

  return {
    requested,
    accepted: acceptedWithoutDispatch + dispatchedIds.size,
    failed: failedDocumentIds.length,
    failedDocumentIds,
  }
}

async function dispatchViaBatchTrigger(
  jobPayloads: DocumentProcessingPayload[],
  requestId: string
): Promise<Set<string>> {
  const dispatchedIds = new Set<string>()
  const batchIds: string[] = []
  const undispatched: DocumentProcessingPayload[] = []
  const region = await resolveTriggerRegion()
  for (let i = 0; i < jobPayloads.length; i += TRIGGER_BATCH_SIZE) {
    const chunk = jobPayloads.slice(i, i + TRIGGER_BATCH_SIZE)
    try {
      const result = await tasks.batchTrigger<typeof processDocumentTask>(
        'knowledge-process-document',
        chunk.map((payload) => ({
          payload,
          options: {
            // Scoped to (documentId, requestId): blocks intra-dispatch retries
            // from double-enqueuing; later syncs use a fresh requestId.
            idempotencyKey: `doc-process-${payload.documentId}-${requestId}`,
            tags: [
              `knowledgeBaseId:${payload.knowledgeBaseId}`,
              `documentId:${payload.documentId}`,
            ],
            region,
          },
        }))
      )
      batchIds.push(result.batchId)
      for (const payload of chunk) dispatchedIds.add(payload.documentId)
    } catch (error) {
      logger.error(`[${requestId}] Failed to batchTrigger ${chunk.length} document jobs`, {
        error: getErrorMessage(error),
      })
      undispatched.push(...chunk)
    }
  }
  if (batchIds.length > 0) {
    logger.info(`[${requestId}] Trigger.dev batches dispatched`, { batchIds })
  }

  /**
   * Only a total dispatch failure raises, so a chunk failing alone would leave its
   * documents at `pending` with nothing recording why. Processing them here is
   * slower than the queue but does not drop the work.
   */
  if (undispatched.length > 0) {
    logger.warn(
      `[${requestId}] Processing ${undispatched.length} documents in-process after failed enqueue`
    )
    const directlyDispatchedIds = await dispatchInProcess(undispatched, requestId)
    for (const documentId of directlyDispatchedIds) dispatchedIds.add(documentId)
  }

  return dispatchedIds
}

/** Each in-process job runs chunking + embedding + many DB inserts. */
const IN_PROCESS_DISPATCH_CONCURRENCY = 5

export interface DocumentProcessingAttemptContext {
  /** True only when this invocation follows a successful queue-budget charge. */
  readonly chargedAtDispatch: boolean
  /** Opaque generation token; absent only for payloads created before token rollout. */
  readonly processingQueueToken?: string
  /** Queue generation this invocation is allowed to claim. */
  readonly processingQueuedAt?: Date
  /** Durably schedules the next quota attempt and returns its execution time. */
  readonly scheduleQuotaContinuation?: () => Promise<Date>
  /** The durable quota retry horizon was exhausted for this indexing pass. */
  readonly quotaContinuationExhausted?: boolean
  /** Signals that this invocation owns the persisted processing generation. */
  readonly onClaimed?: () => void
}

async function dispatchInProcess(
  jobPayloads: DocumentProcessingPayload[],
  requestId: string
): Promise<Set<string>> {
  const results = await mapWithConcurrency(
    jobPayloads,
    IN_PROCESS_DISPATCH_CONCURRENCY,
    async (p) => {
      let processingClaimed = false
      try {
        await processDocumentAsync(
          p.knowledgeBaseId,
          p.documentId,
          p.docData,
          p.processingOptions,
          p,
          p.requestId,
          {
            chargedAtDispatch: p.chargedAtDispatch ?? true,
            processingQueueToken: p.processingQueueToken,
            ...(p.processingQueuedAt ? { processingQueuedAt: new Date(p.processingQueuedAt) } : {}),
            scheduleQuotaContinuation: () => scheduleDocumentProcessingQuotaContinuation(p),
            onClaimed: () => {
              processingClaimed = true
            },
          }
        )
        if (processingClaimed) return true

        const acceptedByLiveGeneration = await isDocumentAcceptedWithoutDispatch(
          p.documentId,
          p.knowledgeBaseId,
          new Date()
        )
        return acceptedByLiveGeneration
      } catch (error) {
        if (isPermanentDocumentProcessingError(error)) {
          logger.warn(`[${requestId}] Document processing reached an expected terminal state`, {
            code: error.code,
          })
          return true
        }
        if (isEmbeddingQuotaExhaustion(error)) {
          logger.warn(`[${requestId}] Embedding quota is exhausted; continuation scheduled`, {
            documentId: p.documentId,
            quotaRetryCount: p.quotaRetryCount ?? 0,
          })
          return true
        }
        if (isBYOKEmbeddingCredentialRejection(error)) {
          logger.warn(`[${requestId}] Customer-managed embedding credentials were rejected`, {
            documentId: p.documentId,
            status: error.status,
          })
          return true
        }
        const message = processingClaimed
          ? 'In-process document processing failed'
          : 'In-process document dispatch failed before claiming the document'
        logger.error(`[${requestId}] ${message}`, {
          documentId: p.documentId,
          error: getErrorMessage(error),
        })
        return processingClaimed
      }
    }
  )
  return new Set(
    results.flatMap((succeeded, index) => (succeeded ? [jobPayloads[index].documentId] : []))
  )
}

function queueGenerationConditions(
  attemptContext: DocumentProcessingAttemptContext | undefined
): SQL[] {
  if (!attemptContext) return []
  if (attemptContext.processingQueueToken) {
    return [eq(document.processingQueueToken, attemptContext.processingQueueToken)]
  }
  return attemptContext.processingQueuedAt
    ? [
        isNull(document.processingQueueToken),
        eq(document.processingQueuedAt, attemptContext.processingQueuedAt),
      ]
    : [isNull(document.processingQueueToken)]
}

/**
 * Parses, embeds, and indexes one document.
 *
 * @param indexingPassId - Identifies the indexing pass this call belongs to,
 * as opposed to the individual attempt. Callers pass the dispatch `requestId`:
 * it is fixed on the job payload, so every retry of a `knowledge-process-document`
 * run carries the same value, while a new dispatch (upload, connector sync batch,
 * user-triggered reprocess) mints a fresh one. It is what makes the embedding
 * charge bill once per pass — see the `sourceReference` note at the `recordUsage`
 * call below.
 * @param attemptContext - Identifies whether queue admission charged this
 * invocation against the document's retry budget. Direct callers omit it and
 * therefore cannot refund an attempt they never charged.
 */
/**
 * Who the processor reads a document's source file as. Always the actor, not
 * the payer: authorizing as the KB owner would let a writer ingest an internal
 * file only the owner can read. A connector-owned row was written by the sync
 * from bytes it fetched, not from a caller-supplied URL, so it is read as the
 * system: in members mode the row stays hidden until the sync materializes who
 * observed it, and the actor's own scope would deny the read.
 */
function sourceFileAccessFor(connectorId: string | null, actorUserId: string): SourceFileAccess {
  return { userId: actorUserId, knowledgeAccess: connectorId ? SYSTEM_ACCESS_SCOPE : undefined }
}

export async function processDocumentAsync(
  knowledgeBaseId: string,
  documentId: string,
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  },
  processingOptions: ProcessingOptions = {},
  providedBillingContext?: BillingAttributionSnapshot | DocumentProcessingBillingContext,
  indexingPassId?: string,
  attemptContext?: DocumentProcessingAttemptContext
): Promise<void> {
  const startTime = Date.now()
  const processingStartedAt = new Date()
  let processingFilename = docData.filename
  try {
    logger.info(`[${documentId}] Starting document processing`, {
      knowledgeBaseId,
      mimeType: docData.mimeType,
      fileSize: docData.fileSize,
    })

    // KB config + workspace billing + doc tags in one JOIN (was 3 SELECTs).
    const contextRows = await db
      .select({
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
        knowledgeBaseUserId: knowledgeBase.userId,
        chunkingConfig: knowledgeBase.chunkingConfig,
        embeddingModel: knowledgeBase.embeddingModel,
        embeddingDimension: knowledgeBase.embeddingDimension,
        billedAccountUserId: workspaceTable.billedAccountUserId,
        uploadedBy: document.uploadedBy,
        connectorId: document.connectorId,
        filename: document.filename,
        fileUrl: document.fileUrl,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        tag1: document.tag1,
        tag2: document.tag2,
        tag3: document.tag3,
        tag4: document.tag4,
        tag5: document.tag5,
        tag6: document.tag6,
        tag7: document.tag7,
        number1: document.number1,
        number2: document.number2,
        number3: document.number3,
        number4: document.number4,
        number5: document.number5,
        date1: document.date1,
        date2: document.date2,
        boolean1: document.boolean1,
        boolean2: document.boolean2,
        boolean3: document.boolean3,
      })
      .from(document)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, document.knowledgeBaseId))
      .leftJoin(
        workspaceTable,
        and(eq(workspaceTable.id, knowledgeBase.workspaceId), isNull(workspaceTable.archivedAt))
      )
      .where(
        and(
          eq(document.id, documentId),
          eq(knowledgeBase.id, knowledgeBaseId),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          isNull(knowledgeBase.deletedAt)
        )
      )
      .limit(1)

    if (contextRows.length === 0) {
      logger.warn(
        `[${documentId}] Skipping document processing: document or knowledge base ${knowledgeBaseId} no longer exists`
      )
      await db
        .update(document)
        .set({
          processingStatus: 'failed',
          processingError: 'Document or knowledge base no longer exists',
          processingDeferredUntil: null,
          processingCompletedAt: new Date(),
        })
        // Never overwrite a finished pass, and never resurrect state on a row
        // that has since been archived or deleted.
        .where(
          and(
            eq(document.id, documentId),
            ne(document.processingStatus, 'completed'),
            ...queueGenerationConditions(attemptContext),
            eq(document.userExcluded, false),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        )
      return
    }

    const ctx = contextRows[0]
    processingFilename = ctx.filename
    const persistedDocData = {
      filename: ctx.filename,
      fileUrl: ctx.fileUrl,
      fileSize: ctx.fileSize,
      mimeType: ctx.mimeType,
    }

    /**
     * Claiming is guarded by both completion status and queue generation.
     *
     * Without a status predicate this write was reachable for a finished
     * document — a late or duplicate dispatch would flip `completed` back to
     * `processing`, discard the pass that had already indexed and billed, and
     * index it a second time. `pending`, `failed`, and `processing` remain
     * claimable so a Trigger retry can recover if an earlier attempt threw
     * before persisting its failure. Queued workers also match the exact stamp
     * carried in their payload. A retry or recovery sweep re-stamps the row, so
     * an older delayed quota continuation becomes a harmless no-op instead of
     * stealing the newer pass.
     */
    const claimed = await db
      .update(document)
      .set({
        processingStatus: 'processing',
        processingStartedAt,
        processingDeferredUntil: null,
        processingCompletedAt: null,
        processingError: null,
      })
      .where(
        and(
          eq(document.id, documentId),
          ne(document.processingStatus, 'completed'),
          ...queueGenerationConditions(attemptContext),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id })

    if (claimed.length === 0) {
      logger.info(
        `[${documentId}] Skipping document processing: superseded, already active, completed, archived, or deleted`
      )
      return
    }

    attemptContext?.onClaimed?.()

    logger.info(`[${documentId}] Status updated to 'processing', starting document processor`)

    const rawConfig = ctx.chunkingConfig as {
      maxSize?: number
      minSize?: number
      overlap?: number
      strategy?: ChunkingStrategy
      strategyOptions?: StrategyOptions
    } | null
    const kbConfig = {
      maxSize: rawConfig?.maxSize ?? 1024,
      minSize: rawConfig?.minSize ?? 100,
      overlap: rawConfig?.overlap ?? 200,
    }

    const kbEmbedding: KbEmbeddingTarget = {
      model: ctx.embeddingModel,
      dimensions: toKbEmbeddingDimensions(ctx.embeddingDimension),
    }
    const kbEmbeddingModel = kbEmbedding.model
    const queuedBillingContext = hasDocumentProcessingBillingScope(providedBillingContext)
      ? assertDocumentProcessingBillingContext(providedBillingContext)
      : undefined
    const restoredBillingAttribution =
      queuedBillingContext && queuedBillingContext.billingScope !== 'non-workspace'
        ? queuedBillingContext.billingAttribution
        : providedBillingContext && !queuedBillingContext
          ? assertBillingAttributionSnapshot(providedBillingContext)
          : undefined
    const documentActorUserId =
      queuedBillingContext?.actorUserId ??
      restoredBillingAttribution?.actorUserId ??
      ctx.uploadedBy ??
      ctx.billedAccountUserId ??
      ctx.knowledgeBaseUserId
    let billingAttribution: BillingAttributionSnapshot | undefined
    if (ctx.workspaceId || ctx.organizationId) {
      if (queuedBillingContext?.billingScope === 'non-workspace') {
        throw new Error('Document processing billing scope does not match knowledge base workspace')
      }
      if (!restoredBillingAttribution) {
        throw new Error('Billing attribution is required for queued document processing')
      }
      billingAttribution = restoredBillingAttribution
      assertBillingAttributionOwner(billingAttribution, ctx)
      if (billingAttribution.actorUserId !== documentActorUserId) {
        throw new Error('Document billing attribution does not match its actor and workspace')
      }
    } else if (
      restoredBillingAttribution ||
      (queuedBillingContext && queuedBillingContext.billingScope !== 'non-workspace')
    ) {
      throw new Error('Workspace-less document processing cannot use workspace billing attribution')
    }

    /**
     * Authoritative gate covering every indexing path. Workspace-less legacy
     * knowledge bases retain account-only enforcement.
     */
    const usageGate = billingAttribution
      ? await checkAttributedUsageLimits(billingAttribution)
      : await checkActorUsageLimits(documentActorUserId)
    if (usageGate.isExceeded) {
      logger.warn(`[${documentId}] Usage limit reached — skipping document indexing`)
      throw new UsageLimitDocumentProcessingError(
        usageGate.message ?? 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }
    let billableEmbeddingTokens = 0
    let embeddingModelName = kbEmbeddingModel
    let embeddingPricingId = kbEmbeddingModel

    const currentSourceFileProvenance = await loadCurrentWorkspaceSourceFileSecretProvenance({
      fileUrl: persistedDocData.fileUrl,
    })
    const documentSecretContext = await loadKnowledgeDocumentSecretRegistry(
      documentId,
      {
        userId: documentActorUserId,
        ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
      },
      currentSourceFileProvenance
    )

    let processingCommitted = false
    await withTimeout(
      (signal) =>
        runWithKnowledgeModelInputProvenance(
          documentSecretContext.registry,
          async () => {
            await assertKnowledgeEmbeddingCapacity({
              ...kbEmbedding,
              workspaceId: ctx.workspaceId,
              signal,
            })
            const processed = await processDocument(
              persistedDocData.fileUrl,
              persistedDocData.filename,
              persistedDocData.mimeType,
              kbConfig.maxSize,
              kbConfig.overlap,
              kbConfig.minSize,
              { ...sourceFileAccessFor(ctx.connectorId, documentActorUserId), signal },
              ctx.workspaceId,
              rawConfig?.strategy,
              rawConfig?.strategyOptions
            )

            signal.throwIfAborted()
            assertDocumentChunkCountWithinLimit(processed.chunks.length)

            const now = new Date()

            logger.info(
              `[${documentId}] Document parsed successfully, generating embeddings for ${processed.chunks.length} chunks`
            )

            const chunkTexts = processed.chunks.map((chunk) => chunk.text)
            const embeddingModelInfo = getEmbeddingModelInfo(kbEmbeddingModel)
            const chunkTokenCounts: number[] = []
            for (let chunkIndex = 0; chunkIndex < chunkTexts.length; chunkIndex++) {
              const tokenCount = estimateTokenCount(
                chunkTexts[chunkIndex],
                embeddingModelInfo.tokenizerProvider
              ).count
              chunkTokenCounts.push(tokenCount)
              if (tokenCount > embeddingModelInfo.maxInputTokens) {
                throw new PermanentDocumentProcessingError(
                  'document_complexity_limit',
                  `Chunk ${chunkIndex + 1} contains ${tokenCount.toLocaleString()} estimated tokens, exceeding the ${embeddingModelInfo.maxInputTokens.toLocaleString()}-token limit for ${kbEmbeddingModel}. Reduce the knowledge-base chunk size and retry.`
                )
              }
            }
            const embeddings: number[][] = []

            if (chunkTexts.length > 0) {
              const batchSize = LARGE_DOC_CONFIG.MAX_EMBEDDING_BATCH
              const totalBatches = Math.ceil(chunkTexts.length / batchSize)

              logger.info(`[${documentId}] Generating embeddings in ${totalBatches} batches`)

              for (let i = 0; i < chunkTexts.length; i += batchSize) {
                signal.throwIfAborted()
                const batch = chunkTexts.slice(i, i + batchSize)
                const batchNum = Math.floor(i / batchSize) + 1

                logger.info(
                  `[${documentId}] Processing embedding batch ${batchNum}/${totalBatches}`
                )
                const {
                  embeddings: batchEmbeddings,
                  billableTokens: batchBillableTokens,
                  modelName,
                  pricingId,
                } = await generateEmbeddings(batch, kbEmbedding, ctx.workspaceId, signal)
                for (const emb of batchEmbeddings) {
                  embeddings.push(emb)
                }
                billableEmbeddingTokens += batchBillableTokens
                if (i === 0) {
                  embeddingModelName = modelName
                  embeddingPricingId = pricingId
                }
              }
            }

            if (embeddings.length !== processed.chunks.length) {
              throw new Error(
                `Embedding generation returned ${embeddings.length} vectors for ${processed.chunks.length} chunks`
              )
            }
            const documentTags = ctx

            logger.info(
              `[${documentId}] Embeddings generated, creating embedding records with tags`
            )

            const chunkProvenances = processed.chunks.map((chunk) =>
              documentSecretContext.tracked
                ? documentSecretContext.registry
                  ? durableSecretProvenanceFromRegistry(documentSecretContext.registry, chunk.text)
                  : EXACT_EMPTY_DURABLE_SECRET_PROVENANCE
                : undefined
            )
            const embeddingRecords = processed.chunks.map((chunk, chunkIndex) => ({
              id: generateId(),
              knowledgeBaseId,
              documentId,
              chunkIndex,
              chunkHash: sha256Hex(chunk.text),
              content: chunk.text,
              secretProvenanceVersion: chunkProvenances[chunkIndex] ? 1 : null,
              contentLength: chunk.text.length,
              tokenCount: chunkTokenCounts[chunkIndex],
              ...embeddingVectorValues(kbEmbedding.dimensions, embeddings[chunkIndex]),
              embeddingModel: kbEmbeddingModel,
              startOffset: chunk.metadata.startIndex,
              endOffset: chunk.metadata.endIndex,
              tag1: documentTags.tag1,
              tag2: documentTags.tag2,
              tag3: documentTags.tag3,
              tag4: documentTags.tag4,
              tag5: documentTags.tag5,
              tag6: documentTags.tag6,
              tag7: documentTags.tag7,
              number1: documentTags.number1,
              number2: documentTags.number2,
              number3: documentTags.number3,
              number4: documentTags.number4,
              number5: documentTags.number5,
              date1: documentTags.date1,
              date2: documentTags.date2,
              boolean1: documentTags.boolean1,
              boolean2: documentTags.boolean2,
              boolean3: documentTags.boolean3,
              createdAt: now,
              updatedAt: now,
            }))

            signal.throwIfAborted()
            processingCommitted = await db.transaction(async (tx) => {
              signal.throwIfAborted()
              const activeDocument = await tx
                .select({ id: document.id })
                .from(document)
                .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
                .where(
                  and(
                    eq(document.id, documentId),
                    eq(document.processingStatus, 'processing'),
                    eq(document.processingStartedAt, processingStartedAt),
                    ...queueGenerationConditions(attemptContext),
                    eq(document.userExcluded, false),
                    isNull(document.archivedAt),
                    isNull(document.deletedAt),
                    isNull(knowledgeBase.deletedAt)
                  )
                )
                .for('update', { of: document })
                .limit(1)

              if (activeDocument.length === 0) {
                return false
              }

              if (embeddingRecords.length > 0) {
                await tx.delete(embedding).where(eq(embedding.documentId, documentId))

                const insertBatchSize = LARGE_DOC_CONFIG.MAX_CHUNKS_PER_BATCH
                const batches: (typeof embeddingRecords)[] = []
                for (let i = 0; i < embeddingRecords.length; i += insertBatchSize) {
                  batches.push(embeddingRecords.slice(i, i + insertBatchSize))
                }

                logger.info(`[${documentId}] Inserting ${embeddingRecords.length} embeddings`)
                for (const batch of batches) {
                  signal.throwIfAborted()
                  await tx.insert(embedding).values(batch)
                }
                const provenanceRecords = embeddingRecords.flatMap((record, index) => {
                  const provenance = chunkProvenances[index]
                  if (!provenance) return []
                  return [
                    {
                      embeddingId: record.id,
                      contentHash: record.chunkHash,
                      status: provenance.status,
                      entries: provenance.status === 'exact' ? [...provenance.entries] : [],
                      updatedAt: now,
                    },
                  ]
                })
                for (let i = 0; i < provenanceRecords.length; i += insertBatchSize) {
                  signal.throwIfAborted()
                  await tx
                    .insert(embeddingSecretProvenance)
                    .values(provenanceRecords.slice(i, i + insertBatchSize))
                }
              }

              signal.throwIfAborted()
              await tx
                .update(document)
                .set({
                  chunkCount: processed.metadata.chunkCount,
                  tokenCount: processed.metadata.tokenCount,
                  characterCount: processed.metadata.characterCount,
                  processingStatus: 'completed',
                  processingCompletedAt: now,
                  processingError: null,
                  /** A completed pass restores the retry allowance for a future failure. */
                  processingAttempts: 0,
                  processingQueueToken: null,
                  processingQueuedAt: null,
                  processingDeferredUntil: null,
                })
                .where(
                  and(
                    eq(document.id, documentId),
                    eq(document.processingStatus, 'processing'),
                    eq(document.processingStartedAt, processingStartedAt),
                    ...queueGenerationConditions(attemptContext),
                    eq(document.userExcluded, false),
                    isNull(document.archivedAt),
                    isNull(document.deletedAt)
                  )
                )
              signal.throwIfAborted()
              return true
            })
          },
          {
            opaqueInputSafe:
              documentSecretContext.provenance.status === 'exact' &&
              documentSecretContext.provenance.entries.length === 0,
          }
        ),
      TIMEOUTS.OVERALL_PROCESSING,
      'Document processing'
    )

    if (!processingCommitted) {
      logger.info(`[${documentId}] Discarded output from an obsolete processing attempt`)
      return
    }

    const processingTime = Date.now() - startTime
    logger.info(`[${documentId}] Successfully processed document in ${processingTime}ms`)

    if (billableEmbeddingTokens > 0) {
      try {
        const costMultiplier = getCostMultiplier()
        const { total: cost } = calculateCost(
          embeddingPricingId,
          billableEmbeddingTokens,
          0,
          false,
          costMultiplier
        )
        if (cost > 0) {
          /**
           * Dedup identity for this embedding charge. `usage_log.event_key` is
           * derived from `sourceReference` and guarded by a permanent unique
           * index — usage_log rows are never pruned, there is no retention job
           * — so the granularity has to separate two cases for all time:
           *
           * - A retry of the same pass must collapse. `knowledge-process-document`
           *   runs up to `KB_CONFIG_MAX_ATTEMPTS` attempts and the stale-document
           *   sweep can re-dispatch on top of that, so any per-attempt component
           *   (a `Date.now()` stamp, `processingStartedAt`) bills one indexing
           *   pass several times over.
           * - A genuinely new pass must not collapse. A content change, a
           *   rehydrate, or a user-triggered reprocess pays a real embedding
           *   bill, and keying on `documentId` alone would suppress that charge
           *   permanently.
           *
           * `indexingPassId` is exactly that discriminator. Without one, the
           * resolved pricing id is the safest fallback: it still collapses
           * attempts and still re-bills a knowledge base whose embedding model
           * changed. Token counts are deliberately left out — OCR-backed parsing
           * is not bit-stable across attempts, so they would break the dedup
           * they appear to sharpen.
           */
          const usageSourceReference = [
            'knowledge-document',
            documentId,
            indexingPassId ?? `model:${embeddingPricingId}`,
          ].join(':')
          await recordUsage({
            userId: documentActorUserId,
            workspaceId: ctx.workspaceId ?? undefined,
            ...(billingAttribution ? toBillingContext(billingAttribution) : {}),
            entries: [
              {
                category: 'model',
                source: 'knowledge-base',
                description: embeddingModelName,
                cost,
                sourceReference: usageSourceReference,
                metadata: { inputTokens: billableEmbeddingTokens, outputTokens: 0 },
              },
            ],
          })
          if (billingAttribution) {
            await checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)
          } else {
            await checkAndBillOverageThreshold(documentActorUserId)
          }
        } else {
          logger.warn(
            `[${documentId}] Embedding model "${embeddingModelName}" has no pricing entry — billing skipped`,
            { billableEmbeddingTokens, embeddingModelName }
          )
        }
      } catch (billingError) {
        logger.error(`[${documentId}] Failed to record embedding usage`, { error: billingError })
      }
    }
  } catch (error) {
    const processingTime = Date.now() - startTime
    const embeddingQuotaExhausted = isEmbeddingQuotaExhaustion(error)
    const byokCredentialRejected = isBYOKEmbeddingCredentialRejection(error)
    const usageLimitExceeded = isUsageLimitDocumentProcessingError(error)
    const permanentError = toPermanentDocumentProcessingError(error, processingFilename)
    let recordedError = permanentError ?? error
    let quotaDeferredUntil: Date | null = null
    let quotaContinuationAttempted = false
    if (embeddingQuotaExhausted && attemptContext?.scheduleQuotaContinuation) {
      quotaContinuationAttempted = true
      try {
        quotaDeferredUntil = await attemptContext.scheduleQuotaContinuation()
      } catch (continuationError) {
        recordedError = continuationError
      }
    }
    const quotaContinuationFailed = quotaContinuationAttempted && !quotaDeferredUntil
    const errorMessage = byokCredentialRejected
      ? BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE
      : embeddingQuotaExhausted
        ? quotaContinuationFailed
          ? getErrorMessage(recordedError, 'Embedding quota continuation dispatch failed')
          : EMBEDDING_QUOTA_EXHAUSTED_MESSAGE
        : getErrorMessage(recordedError, 'Unknown error')
    const logContext = {
      errorType: toError(recordedError).name,
      knowledgeBaseId,
      mimeType: docData.mimeType,
      fileSize: docData.fileSize,
      ...(byokCredentialRejected
        ? {
            code: 'embedding_credentials_rejected',
            outcome: 'customer_configuration',
            status: error.status,
          }
        : {}),
    }
    const logMessage = quotaDeferredUntil
      ? `[${documentId}] Deferred document processing after ${processingTime}ms:`
      : `[${documentId}] Failed to process document after ${processingTime}ms:`
    if (
      (embeddingQuotaExhausted && !quotaContinuationFailed) ||
      byokCredentialRejected ||
      usageLimitExceeded ||
      permanentError
    ) {
      logger.warn(logMessage, logContext)
    } else {
      logger.error(logMessage, logContext)
    }

    await db
      .update(document)
      .set({
        processingStatus: quotaDeferredUntil ? 'pending' : 'failed',
        processingError: quotaDeferredUntil ? null : errorMessage,
        processingStartedAt: quotaDeferredUntil ? null : processingStartedAt,
        ...(quotaDeferredUntil && attemptContext?.processingQueueToken
          ? { processingQueuedAt: quotaDeferredUntil }
          : {}),
        processingDeferredUntil: quotaDeferredUntil,
        processingCompletedAt: quotaDeferredUntil ? null : new Date(),
        ...(permanentError ||
        byokCredentialRejected ||
        (embeddingQuotaExhausted && attemptContext?.quotaContinuationExhausted)
          ? { processingAttempts: MAX_PROCESSING_ATTEMPTS }
          : (embeddingQuotaExhausted || usageLimitExceeded) && attemptContext?.chargedAtDispatch
            ? { processingAttempts: sql`GREATEST(${document.processingAttempts} - 1, 0)` }
            : {}),
      })
      .where(
        and(
          eq(document.id, documentId),
          eq(document.processingStatus, 'processing'),
          eq(document.processingStartedAt, processingStartedAt),
          ...queueGenerationConditions(attemptContext),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )

    throw recordedError
  }
}

let triggerAvailabilityLogged = false

/**
 * Whether background work may be dispatched to Trigger.dev rather than run
 * in-process.
 *
 * Inside a Trigger.dev run the answer is unconditionally yes: the platform is
 * what is executing this process, so no environment guess can be more reliable
 * than the run marker. Outside a run the deployment must both enable
 * Trigger.dev and hold the secret key the SDK authenticates with.
 *
 * Resolving `true` inside a run is safe even if the run process turns out not
 * to expose `TRIGGER_SECRET_KEY`: the SDK would then reject the batch trigger
 * and `dispatchViaBatchTrigger` falls back to processing in-process, which is
 * exactly where a `false` predicate lands anyway.
 *
 * The first evaluation in a process logs the resolved inputs. That is once per
 * worker process rather than once per dispatch, and it is the signal that makes
 * an app-vs-worker asymmetry visible without reading a crashed run's spans.
 */
export function isTriggerAvailable(): boolean {
  const insideRun = isInsideTriggerRun()
  const hasSecretKey = Boolean(env.TRIGGER_SECRET_KEY)
  const available = insideRun || (hasSecretKey && isTriggerDevEnabled)

  if (!triggerAvailabilityLogged) {
    triggerAvailabilityLogged = true
    logger.info('Resolved Trigger.dev dispatch availability', {
      available,
      insideTriggerRun: insideRun,
      triggerDevEnabled: isTriggerDevEnabled,
      hasSecretKey,
    })
  }

  return available
}

type DocumentStorageBilling =
  | {
      readonly context: StorageBillingContext
      readonly bytes: number
    }
  | {
      readonly userId: string
      readonly bytes: number
      readonly sub: HighestPrioritySubscription | null
    }

interface DocumentStorageNotification {
  readonly context: StorageBillingContext
  readonly updatedUsage: number
}

interface DocumentStorageAdmission {
  readonly workspaceId: string | null
  readonly knowledgeBaseUserId: string
  readonly billing?: DocumentStorageBilling
}

/**
 * Uses trusted file metadata for a KB object size when that metadata already
 * exists. External/data URLs and legacy unbound objects retain the caller's
 * size; this path deliberately does not add provider HEAD requests.
 */
function getServerKnownDocumentSize(
  fileUrl: string,
  fallbackSize: number,
  bindingByKey: ReadonlyMap<string, FileMetadataRecord>
): number {
  const storageKey = getKnowledgeBaseStorageKey(fileUrl)
  const binding = storageKey ? bindingByKey.get(storageKey) : undefined
  return binding ? getWorkspaceFileSize(binding) : fallbackSize
}

/**
 * Resolves server-known KB object sizes outside the insertion transaction.
 */
async function resolveServerKnownDocumentSizes<
  T extends { readonly fileUrl: string; readonly fileSize: number },
>(documents: readonly T[]): Promise<Array<T & { fileSize: number }>> {
  const bindingByKey = await loadKnowledgeBaseFileBindings(
    documents.map((document) => document.fileUrl)
  )
  return documents.map((docData) => ({
    ...docData,
    fileSize: getServerKnownDocumentSize(docData.fileUrl, docData.fileSize, bindingByKey),
  }))
}

/**
 * Resolves storage admission before opening the short document transaction.
 * The transaction revalidates the locked KB ownership snapshot and the
 * workspace helper atomically rechecks quota while applying both ledgers.
 */
async function resolveDocumentStorageAdmission(
  knowledgeBaseId: string,
  uploadedBy: string | null,
  bytes: number
): Promise<DocumentStorageAdmission> {
  const [kb] = await db
    .select({
      workspaceId: knowledgeBase.workspaceId,
      organizationId: knowledgeBase.organizationId,
      userId: knowledgeBase.userId,
    })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)
  if (!kb) {
    throw new OrchestrationError('not_found', 'Knowledge base not found')
  }

  if (kb.organizationId)
    throw new OrchestrationError(
      'validation',
      'Add documents to organization Search through a connected source'
    )
  if (bytes <= 0) {
    return { workspaceId: kb.workspaceId, knowledgeBaseUserId: kb.userId }
  }

  const billedUserId = uploadedBy ?? kb.userId
  if (kb.workspaceId) {
    const context = await resolveStorageBillingContext(kb.workspaceId)
    const quotaCheck = await checkStorageQuotaForBillingContext(context, bytes)
    if (!quotaCheck.allowed) {
      throw new StorageLimitExceededError(quotaCheck.error || 'Storage limit exceeded')
    }
    return {
      workspaceId: kb.workspaceId,
      knowledgeBaseUserId: kb.userId,
      billing: { context, bytes },
    }
  }

  const [quotaCheck, sub] = await Promise.all([
    checkStorageQuota(billedUserId, bytes),
    getHighestPrioritySubscription(billedUserId),
  ])
  if (!quotaCheck.allowed) {
    throw new StorageLimitExceededError(quotaCheck.error || 'Storage limit exceeded')
  }
  return {
    workspaceId: null,
    knowledgeBaseUserId: kb.userId,
    billing: { userId: billedUserId, bytes, sub },
  }
}

export async function createDocumentRecords(
  documents: Array<{
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    documentTagsData?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
  }>,
  knowledgeBaseId: string,
  requestId: string,
  uploadedBy: string | null = null,
  secretProvenances?: readonly KnowledgeDocumentWriteSecretProvenance[]
): Promise<DocumentData[]> {
  if (secretProvenances && secretProvenances.length !== documents.length) {
    throw new Error('Knowledge document secret provenance count does not match the request')
  }
  const resolvedDocuments = await resolveServerKnownDocumentSizes(documents)
  const totalBytes = resolvedDocuments.reduce((sum, docData) => sum + (docData.fileSize || 0), 0)
  const admission = await resolveDocumentStorageAdmission(knowledgeBaseId, uploadedBy, totalBytes)
  const { returnData, storageNotification } = await db.transaction(async (tx) => {
    let storageNotification: DocumentStorageNotification | null = null

    await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

    const kb = await tx
      .select({
        id: knowledgeBase.id,
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
        userId: knowledgeBase.userId,
      })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .limit(1)

    if (kb.length === 0) {
      throw new OrchestrationError('not_found', 'Knowledge base not found')
    }

    if (
      kb[0].workspaceId !== admission.workspaceId ||
      kb[0].userId !== admission.knowledgeBaseUserId
    ) {
      throw new Error(
        'Knowledge base storage ownership changed; retry with fresh storage admission'
      )
    }

    const kbWorkspaceId = kb[0].workspaceId
    const bindingByKey = await assertKnowledgeBaseFileUrlsOwnership(
      resolvedDocuments.map((docData) => docData.fileUrl),
      kbWorkspaceId,
      kb[0].userId,
      requestId,
      tx
    )
    const sourceBindingByKey = await loadWorkspaceSourceFileBindings(
      resolvedDocuments.map((docData) => docData.fileUrl),
      tx
    )
    const trackedBindings = [
      ...[...bindingByKey.values()].filter((binding) => binding.secretProvenanceVersion !== null),
      ...sourceBindingByKey.values(),
    ]
    const boundFileProvenanceById = await getBoundWorkspaceFileSecretProvenanceByMetadata(
      tx,
      trackedBindings
    )
    for (const [documentIndex, docData] of resolvedDocuments.entries()) {
      const currentSize = getServerKnownDocumentSize(
        docData.fileUrl,
        docData.fileSize,
        bindingByKey
      )
      if (currentSize !== docData.fileSize) {
        throw new Error('Knowledge base file metadata changed; retry document insertion')
      }
    }

    if (admission.billing) {
      const preparedBilling = admission.billing
      if ('context' in preparedBilling) {
        const updatedUsage = await incrementStorageUsageForBillingContextInTx(
          tx,
          preparedBilling.context,
          preparedBilling.bytes
        )
        if (updatedUsage !== undefined) {
          storageNotification = { context: preparedBilling.context, updatedUsage }
        }
      } else {
        const quotaCheck = await checkAndIncrementStorageUsageInTx(
          tx,
          preparedBilling.sub,
          preparedBilling.userId,
          preparedBilling.bytes
        )
        if (!quotaCheck.allowed) {
          throw new StorageLimitExceededError(quotaCheck.error || 'Storage limit exceeded')
        }
      }
    }

    // One load per batch (was N+1); skip entirely if no doc carries tags.
    const hasTaggedDocs = resolvedDocuments.some((d) => d.documentTagsData)
    const tagDefinitions = hasTaggedDocs
      ? await loadTagDefinitions(knowledgeBaseId, tx)
      : (new Map() as TagDefinitionsByName)

    const now = new Date()
    const documentRecords = []
    const documentProvenances: (DurableSecretProvenance | undefined)[] = []
    const returnData: DocumentData[] = []

    for (const [documentIndex, docData] of resolvedDocuments.entries()) {
      const documentId = generateId()

      let processedTags: Partial<ProcessedDocumentTags> = {}

      if (docData.documentTagsData) {
        try {
          const tagData = JSON.parse(docData.documentTagsData)
          if (Array.isArray(tagData)) {
            processedTags = resolveDocumentTags(tagData, tagDefinitions, requestId)
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            logger.warn(`[${requestId}] Failed to parse documentTagsData for bulk document:`, error)
          } else {
            throw error
          }
        }
      }

      const storageKey = getKnowledgeBaseStorageKey(docData.fileUrl)
      const baseDocument = {
        id: documentId,
        knowledgeBaseId,
        filename: docData.filename,
        fileUrl: docData.fileUrl,
        storageKey,
        contentHash: null,
        fileSize: docData.fileSize,
        mimeType: docData.mimeType,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        processingStatus: 'pending' as const,
        enabled: true,
        uploadedAt: now,
        uploadedBy,
        tag1: processedTags.tag1 ?? docData.tag1 ?? null,
        tag2: processedTags.tag2 ?? docData.tag2 ?? null,
        tag3: processedTags.tag3 ?? docData.tag3 ?? null,
        tag4: processedTags.tag4 ?? docData.tag4 ?? null,
        tag5: processedTags.tag5 ?? docData.tag5 ?? null,
        tag6: processedTags.tag6 ?? docData.tag6 ?? null,
        tag7: processedTags.tag7 ?? docData.tag7 ?? null,
        number1: processedTags.number1 ?? null,
        number2: processedTags.number2 ?? null,
        number3: processedTags.number3 ?? null,
        number4: processedTags.number4 ?? null,
        number5: processedTags.number5 ?? null,
        date1: processedTags.date1 ?? null,
        date2: processedTags.date2 ?? null,
        boolean1: processedTags.boolean1 ?? null,
        boolean2: processedTags.boolean2 ?? null,
        boolean3: processedTags.boolean3 ?? null,
      }
      const source = createKnowledgeDocumentSourceValue(baseDocument)
      const binding = storageKey
        ? (bindingByKey.get(storageKey) ?? sourceBindingByKey.get(storageKey))
        : undefined
      const provenanceBinding =
        binding && (binding.secretProvenanceVersion !== null || sourceBindingByKey.has(binding.key))
          ? binding
          : undefined
      const boundFileProvenance = provenanceBinding
        ? (boundFileProvenanceById.get(provenanceBinding.id) ?? { status: 'unknown' as const })
        : undefined
      const provenance = bindKnowledgeDocumentWriteSecretProvenance({
        source,
        provenance: secretProvenances?.[documentIndex],
        tagDefinitions,
        ...(provenanceBinding && boundFileProvenance
          ? { boundFile: { binding: provenanceBinding, provenance: boundFileProvenance } }
          : {}),
      })
      const newDocument = {
        ...baseDocument,
        secretProvenanceVersion: provenance ? 1 : null,
      }

      documentRecords.push(newDocument)
      documentProvenances.push(provenance)
      returnData.push({
        documentId,
        filename: docData.filename,
        fileUrl: docData.fileUrl,
        fileSize: docData.fileSize,
        mimeType: docData.mimeType,
      })
    }

    if (documentRecords.length > 0) {
      await tx.insert(document).values(documentRecords)
      for (const [documentIndex, record] of documentRecords.entries()) {
        const provenance = documentProvenances[documentIndex]
        if (!provenance) continue
        await replaceKnowledgeDocumentSecretProvenanceInTx(
          tx,
          record.id,
          createKnowledgeDocumentSourceValue(record),
          provenance
        )
      }
      logger.info(
        `[${requestId}] Bulk created ${documentRecords.length} document records in knowledge base ${knowledgeBaseId}`
      )

      await tx
        .update(knowledgeBase)
        .set({ updatedAt: now })
        .where(eq(knowledgeBase.id, knowledgeBaseId))
    }

    return { returnData, storageNotification }
  })

  if (storageNotification) {
    void maybeNotifyStorageLimitForBillingContext(
      storageNotification.context,
      storageNotification.updatedUsage
    )
  }

  return returnData
}

export async function getDocuments(
  knowledgeBaseId: string,
  options: {
    enabledFilter?: 'all' | 'enabled' | 'disabled'
    search?: string
    limit?: number
    offset?: number
    sortBy?: DocumentSortField
    sortOrder?: SortOrder
    tagFilters?: TagFilterCondition[]
  },
  requestId: string,
  access: KnowledgeAccessScope | SystemAccessScope
): Promise<{
  documents: Array<{
    id: string
    knowledgeBaseId: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    chunkCount: number
    tokenCount: number
    characterCount: number
    processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
    processingStartedAt: Date | null
    processingCompletedAt: Date | null
    processingError: string | null
    enabled: boolean
    uploadedAt: Date
    tag1: string | null
    tag2: string | null
    tag3: string | null
    tag4: string | null
    tag5: string | null
    tag6: string | null
    tag7: string | null
    number1: number | null
    number2: number | null
    number3: number | null
    number4: number | null
    number5: number | null
    date1: Date | null
    date2: Date | null
    boolean1: boolean | null
    boolean2: boolean | null
    boolean3: boolean | null
    connectorId: string | null
    connectorType: string | null
    sourceUrl: string | null
  }>
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}> {
  const {
    enabledFilter = 'all',
    search,
    limit = 50,
    offset = 0,
    sortBy = 'filename',
    sortOrder = 'asc',
    tagFilters,
  } = options

  const whereConditions: (SQL | undefined)[] = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
    isNull(document.deletedAt),
    knowledgeAccessCondition(access),
  ]

  if (enabledFilter === 'enabled') {
    whereConditions.push(eq(document.enabled, true))
  } else if (enabledFilter === 'disabled') {
    whereConditions.push(eq(document.enabled, false))
  }

  if (search) {
    whereConditions.push(searchFilter(document.filename, search))
  }

  if (tagFilters && tagFilters.length > 0) {
    for (const filter of tagFilters) {
      const condition = buildTagFilterCondition(filter)
      if (!condition) throw uncompilableTagFilterError(filter)
      whereConditions.push(condition)
    }
  }

  const totalResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(document)
    .where(and(...whereConditions))

  const total = Number(totalResult[0]?.count ?? 0)
  const hasMore = offset + limit < total

  const getOrderByColumn = () => {
    switch (sortBy) {
      case 'filename':
        return document.filename
      case 'fileSize':
        return document.fileSize
      case 'tokenCount':
        return document.tokenCount
      case 'chunkCount':
        return document.chunkCount
      case 'uploadedAt':
        return document.uploadedAt
      case 'processingStatus':
        return document.processingStatus
      case 'enabled':
        return document.enabled
      default:
        return document.uploadedAt
    }
  }

  const primaryOrderBy = sortOrder === 'asc' ? asc(getOrderByColumn()) : desc(getOrderByColumn())
  const secondaryOrderBy =
    sortBy === 'filename' ? desc(document.uploadedAt) : asc(document.filename)

  const documents = await db
    .select({
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      filename: document.filename,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      chunkCount: document.chunkCount,
      tokenCount: document.tokenCount,
      characterCount: document.characterCount,
      processingStatus: document.processingStatus,
      processingStartedAt: document.processingStartedAt,
      processingCompletedAt: document.processingCompletedAt,
      processingError: document.processingError,
      enabled: document.enabled,
      uploadedAt: document.uploadedAt,
      tag1: document.tag1,
      tag2: document.tag2,
      tag3: document.tag3,
      tag4: document.tag4,
      tag5: document.tag5,
      tag6: document.tag6,
      tag7: document.tag7,
      number1: document.number1,
      number2: document.number2,
      number3: document.number3,
      number4: document.number4,
      number5: document.number5,
      date1: document.date1,
      date2: document.date2,
      boolean1: document.boolean1,
      boolean2: document.boolean2,
      boolean3: document.boolean3,
      connectorId: document.connectorId,
      connectorType: knowledgeConnector.connectorType,
      sourceUrl: document.sourceUrl,
    })
    .from(document)
    .leftJoin(knowledgeConnector, eq(document.connectorId, knowledgeConnector.id))
    .where(and(...whereConditions))
    .orderBy(primaryOrderBy, secondaryOrderBy)
    .limit(limit)
    .offset(offset)

  logger.info(
    `[${requestId}] Retrieved ${documents.length} documents (${offset}-${offset + documents.length} of ${total}) for knowledge base ${knowledgeBaseId}`
  )

  return {
    documents: documents.map((doc) => ({
      id: doc.id,
      knowledgeBaseId: doc.knowledgeBaseId,
      filename: doc.filename,
      fileUrl: doc.fileUrl,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      chunkCount: doc.chunkCount,
      tokenCount: doc.tokenCount,
      characterCount: doc.characterCount,
      processingStatus: doc.processingStatus as 'pending' | 'processing' | 'completed' | 'failed',
      processingStartedAt: doc.processingStartedAt,
      processingCompletedAt: doc.processingCompletedAt,
      processingError: doc.processingError,
      enabled: doc.enabled,
      uploadedAt: doc.uploadedAt,
      tag1: doc.tag1,
      tag2: doc.tag2,
      tag3: doc.tag3,
      tag4: doc.tag4,
      tag5: doc.tag5,
      tag6: doc.tag6,
      tag7: doc.tag7,
      number1: doc.number1,
      number2: doc.number2,
      number3: doc.number3,
      number4: doc.number4,
      number5: doc.number5,
      date1: doc.date1,
      date2: doc.date2,
      boolean1: doc.boolean1,
      boolean2: doc.boolean2,
      boolean3: doc.boolean3,
      connectorId: doc.connectorId,
      connectorType: doc.connectorType ?? null,
      sourceUrl: doc.sourceUrl,
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore,
    },
  }
}

export type ActiveKnowledgeDocument = typeof document.$inferSelect & {
  connectorType: string | null
}

/**
 * Loads one visible document and its connector metadata for every API adapter.
 * A document the caller may not read is reported as absent, the same as one
 * that does not exist, so no surface can confirm a restricted document exists.
 */
export async function getKnowledgeDocument(
  knowledgeBaseId: string,
  documentId: string,
  access: KnowledgeAccessScope | SystemAccessScope
): Promise<ActiveKnowledgeDocument | null> {
  const [row] = await db
    .select({
      ...getTableColumns(document),
      connectorType: knowledgeConnector.connectorType,
    })
    .from(document)
    .leftJoin(knowledgeConnector, eq(document.connectorId, knowledgeConnector.id))
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt),
        knowledgeAccessCondition(access)
      )
    )
    .limit(1)

  return row ? { ...row, connectorType: row.connectorType ?? null } : null
}

/** Loads one visible document by its canonical ID before any asserted parent is trusted. */
export async function getKnowledgeDocumentById(
  documentId: string,
  access: KnowledgeAccessScope | SystemAccessScope
): Promise<ActiveKnowledgeDocument | null> {
  const [row] = await db
    .select({
      ...getTableColumns(document),
      connectorType: knowledgeConnector.connectorType,
    })
    .from(document)
    .leftJoin(knowledgeConnector, eq(document.connectorId, knowledgeConnector.id))
    .where(
      and(
        eq(document.id, documentId),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt),
        knowledgeAccessCondition(access)
      )
    )
    .limit(1)

  return row ? { ...row, connectorType: row.connectorType ?? null } : null
}

export async function createSingleDocument(
  documentData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    documentTagsData?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
  },
  knowledgeBaseId: string,
  requestId: string,
  uploadedBy: string | null = null,
  documentId = generateId(),
  secretProvenance?: KnowledgeDocumentWriteSecretProvenance,
  options?: {
    expectedWorkspaceId?: string
    processing?: {
      processingOptions: ProcessingOptions
      billingAttribution: BillingAttributionSnapshot
    }
  }
): Promise<{
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: 'pending'
  enabled: boolean
  uploadedAt: Date
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
}> {
  const now = new Date()
  const [resolvedDocumentData] = await resolveServerKnownDocumentSizes([documentData])
  const admission = await resolveDocumentStorageAdmission(
    knowledgeBaseId,
    uploadedBy,
    resolvedDocumentData.fileSize
  )
  let processedTags: ProcessedDocumentTags = {
    tag1: documentData.tag1 ?? null,
    tag2: documentData.tag2 ?? null,
    tag3: documentData.tag3 ?? null,
    tag4: documentData.tag4 ?? null,
    tag5: documentData.tag5 ?? null,
    tag6: documentData.tag6 ?? null,
    tag7: documentData.tag7 ?? null,
    number1: null,
    number2: null,
    number3: null,
    number4: null,
    number5: null,
    date1: null,
    date2: null,
    boolean1: null,
    boolean2: null,
    boolean3: null,
  }
  let tagDefinitions: TagDefinitionsByName = new Map()

  if (documentData.documentTagsData) {
    try {
      const tagData = JSON.parse(documentData.documentTagsData)
      if (Array.isArray(tagData)) {
        tagDefinitions = await loadTagDefinitions(knowledgeBaseId)
        processedTags = resolveDocumentTags(tagData, tagDefinitions, requestId)
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.warn(`[${requestId}] Failed to parse documentTagsData:`, error)
      } else {
        throw error
      }
    }
  }

  const newDocument = {
    id: documentId,
    knowledgeBaseId,
    filename: resolvedDocumentData.filename,
    fileUrl: resolvedDocumentData.fileUrl,
    storageKey: getKnowledgeBaseStorageKey(resolvedDocumentData.fileUrl),
    fileSize: resolvedDocumentData.fileSize,
    mimeType: resolvedDocumentData.mimeType,
    chunkCount: 0,
    tokenCount: 0,
    characterCount: 0,
    processingStatus: 'pending' as const,
    enabled: true,
    uploadedAt: now,
    uploadedBy,
    ...processedTags,
  }

  const storageNotification = await db.transaction(async (tx) => {
    let storageNotification: DocumentStorageNotification | null = null

    await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

    const kb = await tx
      .select({
        id: knowledgeBase.id,
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
        userId: knowledgeBase.userId,
      })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
      .limit(1)

    if (kb.length === 0) {
      throw new OrchestrationError('not_found', 'Knowledge base not found')
    }

    if (
      options?.expectedWorkspaceId !== undefined &&
      kb[0].workspaceId !== options.expectedWorkspaceId
    ) {
      throw new OrchestrationError('not_found', 'Knowledge base not found')
    }

    if (
      kb[0].workspaceId !== admission.workspaceId ||
      kb[0].userId !== admission.knowledgeBaseUserId
    ) {
      throw new Error(
        'Knowledge base storage ownership changed; retry with fresh storage admission'
      )
    }

    const bindingByKey = await assertKnowledgeBaseFileUrlsOwnership(
      [resolvedDocumentData.fileUrl],
      kb[0].workspaceId,
      kb[0].userId,
      requestId,
      tx
    )
    const sourceBindingByKey = await loadWorkspaceSourceFileBindings(
      [resolvedDocumentData.fileUrl],
      tx
    )
    const storageKey = getKnowledgeBaseStorageKey(resolvedDocumentData.fileUrl)
    const binding = storageKey
      ? (bindingByKey.get(storageKey) ?? sourceBindingByKey.get(storageKey))
      : undefined
    const provenanceBinding =
      binding && (binding.secretProvenanceVersion !== null || sourceBindingByKey.has(binding.key))
        ? binding
        : undefined
    const boundFileProvenanceById = await getBoundWorkspaceFileSecretProvenanceByMetadata(
      tx,
      provenanceBinding ? [provenanceBinding] : []
    )
    const currentSize = getServerKnownDocumentSize(
      resolvedDocumentData.fileUrl,
      resolvedDocumentData.fileSize,
      bindingByKey
    )
    if (currentSize !== resolvedDocumentData.fileSize) {
      throw new Error('Knowledge base file metadata changed; retry document insertion')
    }

    if (admission.billing) {
      const preparedBilling = admission.billing
      if ('context' in preparedBilling) {
        const updatedUsage = await incrementStorageUsageForBillingContextInTx(
          tx,
          preparedBilling.context,
          preparedBilling.bytes
        )
        if (updatedUsage !== undefined) {
          storageNotification = { context: preparedBilling.context, updatedUsage }
        }
      } else {
        const quotaCheck = await checkAndIncrementStorageUsageInTx(
          tx,
          preparedBilling.sub,
          preparedBilling.userId,
          preparedBilling.bytes
        )
        if (!quotaCheck.allowed) {
          throw new StorageLimitExceededError(quotaCheck.error || 'Storage limit exceeded')
        }
      }
    }

    const source = createKnowledgeDocumentSourceValue(newDocument)
    const boundFileProvenance = provenanceBinding
      ? (boundFileProvenanceById.get(provenanceBinding.id) ?? { status: 'unknown' as const })
      : undefined
    const documentProvenance = bindKnowledgeDocumentWriteSecretProvenance({
      source,
      provenance: secretProvenance,
      tagDefinitions,
      ...(provenanceBinding && boundFileProvenance
        ? { boundFile: { binding: provenanceBinding, provenance: boundFileProvenance } }
        : {}),
    })
    await tx.insert(document).values({
      ...newDocument,
      secretProvenanceVersion: documentProvenance ? 1 : null,
    })
    if (documentProvenance) {
      await replaceKnowledgeDocumentSecretProvenanceInTx(tx, documentId, source, documentProvenance)
    }

    await tx
      .update(knowledgeBase)
      .set({ updatedAt: now })
      .where(eq(knowledgeBase.id, knowledgeBaseId))

    if (options?.processing) {
      await enqueueKnowledgeDocumentProcessing(tx, {
        knowledgeBaseId,
        documentId,
        processingOptions: options.processing.processingOptions,
        billingAttribution: options.processing.billingAttribution,
      })
    }

    return storageNotification
  })

  if (storageNotification) {
    void maybeNotifyStorageLimitForBillingContext(
      storageNotification.context,
      storageNotification.updatedUsage
    )
  }

  logger.info(`[${requestId}] Document created: ${documentId} in knowledge base ${knowledgeBaseId}`)

  return newDocument as {
    id: string
    knowledgeBaseId: string
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
    chunkCount: number
    tokenCount: number
    characterCount: number
    processingStatus: 'pending'
    enabled: boolean
    uploadedAt: Date
    tag1: string | null
    tag2: string | null
    tag3: string | null
    tag4: string | null
    tag5: string | null
    tag6: string | null
    tag7: string | null
  }
}

/** Returns one active document by its deterministic upload id. */
export async function getDocumentByUploadId(
  documentId: string,
  knowledgeBaseId: string
): Promise<
  | (Omit<Awaited<ReturnType<typeof createSingleDocument>>, 'processingStatus'> & {
      processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
    })
  | null
> {
  const [existing] = await db
    .select({
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      filename: document.filename,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      chunkCount: document.chunkCount,
      tokenCount: document.tokenCount,
      characterCount: document.characterCount,
      enabled: document.enabled,
      uploadedAt: document.uploadedAt,
      tag1: document.tag1,
      tag2: document.tag2,
      tag3: document.tag3,
      tag4: document.tag4,
      tag5: document.tag5,
      tag6: document.tag6,
      tag7: document.tag7,
      processingStatus: document.processingStatus,
    })
    .from(document)
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        isNull(document.deletedAt)
      )
    )
    .limit(1)
  if (!existing) return null
  const processingStatus = existing.processingStatus
  if (
    processingStatus !== 'pending' &&
    processingStatus !== 'processing' &&
    processingStatus !== 'completed' &&
    processingStatus !== 'failed'
  ) {
    throw new Error(`Document ${existing.id} has invalid processing status`)
  }
  return { ...existing, processingStatus }
}

export async function bulkDocumentOperation(
  knowledgeBaseId: string,
  operation: 'enable' | 'disable' | 'delete',
  documentIds: string[],
  access: KnowledgeAccessScope,
  requestId: string
): Promise<{
  success: boolean
  successCount: number
  updatedDocuments: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
    processingStatus?: string
  }>
}> {
  logger.info(
    `[${requestId}] Starting bulk ${operation} operation on ${documentIds.length} documents in knowledge base ${knowledgeBaseId}`
  )

  const documentsToUpdate = await db
    .select({
      id: document.id,
      enabled: document.enabled,
    })
    .from(document)
    .where(
      and(
        eq(document.knowledgeBaseId, knowledgeBaseId),
        inArray(document.id, documentIds),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt),
        knowledgeAccessCondition(access)
      )
    )

  if (documentsToUpdate.length === 0) {
    throw new OrchestrationError('not_found', 'No valid documents found to update')
  }

  if (documentsToUpdate.length !== documentIds.length) {
    logger.warn(
      `[${requestId}] Some documents not found or don't belong to knowledge base. Requested: ${documentIds.length}, Found: ${documentsToUpdate.length}`
    )
  }

  let updateResult: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
    processingStatus?: string
  }>

  if (operation === 'delete') {
    const deletedIds = documentsToUpdate.map((doc) => doc.id)
    const deletedCount = await deleteDocumentsByLifecyclePolicy(deletedIds, requestId)
    updateResult = deletedIds.slice(0, deletedCount).map((id) => ({ id }))
  } else {
    const enabled = operation === 'enable'

    updateResult = await db
      .update(document)
      .set({
        enabled,
      })
      .where(
        and(
          eq(document.knowledgeBaseId, knowledgeBaseId),
          inArray(
            document.id,
            documentsToUpdate.map((doc) => doc.id)
          ),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id, enabled: document.enabled })
  }

  const successCount = updateResult.length

  logger.info(
    `[${requestId}] Bulk ${operation} operation completed: ${successCount} documents updated in knowledge base ${knowledgeBaseId}`
  )

  return {
    success: true,
    successCount,
    updatedDocuments: updateResult,
  }
}

export async function bulkDocumentOperationByFilter(
  knowledgeBaseId: string,
  operation: 'enable' | 'disable' | 'delete',
  enabledFilter: 'all' | 'enabled' | 'disabled' | undefined,
  access: KnowledgeAccessScope,
  requestId: string
): Promise<{
  success: boolean
  successCount: number
  updatedDocuments: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
  }>
}> {
  logger.info(
    `[${requestId}] Starting bulk ${operation} operation on all documents (filter: ${enabledFilter || 'all'}) in knowledge base ${knowledgeBaseId}`
  )

  const whereConditions = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
    isNull(document.deletedAt),
    /** "Every document" means every document the caller can see. */
    knowledgeAccessCondition(access),
  ]

  if (enabledFilter === 'enabled') {
    whereConditions.push(eq(document.enabled, true))
  } else if (enabledFilter === 'disabled') {
    whereConditions.push(eq(document.enabled, false))
  }

  let updateResult: Array<{
    id: string
    enabled?: boolean
    deletedAt?: Date | null
  }>

  if (operation === 'delete') {
    const matchingDocs = await db
      .select({ id: document.id })
      .from(document)
      .where(and(...whereConditions))

    const deletedIds = matchingDocs.map((doc) => doc.id)
    const deletedCount = await deleteDocumentsByLifecyclePolicy(deletedIds, requestId)
    updateResult = deletedIds.slice(0, deletedCount).map((id) => ({ id }))
  } else {
    const enabled = operation === 'enable'

    updateResult = await db
      .update(document)
      .set({
        enabled,
      })
      .where(and(...whereConditions))
      .returning({ id: document.id, enabled: document.enabled })
  }

  const successCount = updateResult.length

  logger.info(
    `[${requestId}] Bulk ${operation} by filter completed: ${successCount} documents updated in knowledge base ${knowledgeBaseId}`
  )

  return {
    success: true,
    successCount,
    updatedDocuments: updateResult,
  }
}

export async function markDocumentAsFailedTimeout(
  knowledgeBaseId: string,
  documentId: string,
  processingStartedAt: Date,
  requestId: string
): Promise<{ success: boolean; processingDuration: number }> {
  const result = await failStaleDocumentProcessingClaim({
    knowledgeBaseId,
    documentId,
    processingStartedAt,
  })

  if (result.success) {
    logger.info(
      `[${requestId}] Marked document ${documentId} as failed due to dead process (processing time: ${Math.round(result.processingDuration / 1000)}s)`
    )
  } else {
    logger.info(`[${requestId}] Did not time out document ${documentId} because its claim changed`)
  }

  return result
}

export async function retryDocumentProcessing(
  knowledgeBaseId: string,
  documentId: string,
  docData: {
    filename: string
    fileUrl: string
    fileSize: number
    mimeType: string
  },
  requestId: string,
  billingAttribution: BillingAttributionSnapshot | undefined
): Promise<{ success: boolean; status: string; message: string }> {
  /**
   * A document may be retried from a terminal state, or from a `pending` state
   * old enough that its dispatch is certainly lost.
   *
   * Unguarded, a double-click issued two full passes: the second reset a
   * document that the first had already queued, so both dispatches ran, both
   * indexed, and both billed. A terminal-only guard closes that, but it also
   * strands a document that never left `pending` — a worker killed before its
   * claim UPDATE burns an attempt without changing status, and once the
   * processing-attempt budget is spent the connector sweep drops it too. The row
   * then matches nothing anywhere.
   *
   * The `pending` arm is admitted only past {@link QUEUED_DISPATCH_GRACE_MS},
   * which is the same grace the connector sweep waits out, so a second click
   * still lands inside a live dispatch's window and still matches no rows.
   *
   * Age is measured from `COALESCE(processingQueuedAt, uploadedAt)`, exactly as
   * `isStuckDocumentSweepEligible` measures it. `processingQueuedAt` is NULL
   * only for a document no dispatch has ever stamped, and falling back to
   * `uploadedAt` — rather than treating NULL as retryable — keeps the grace
   * window closed for a document created moments ago whose first dispatch is
   * still in flight.
   */
  const queuedGraceCutoff = new Date(Date.now() - QUEUED_DISPATCH_GRACE_MS)
  const requeued = await db.transaction(async (tx) => {
    const reset = await tx
      .update(document)
      .set({
        processingStatus: 'pending',
        /**
         * Invalidates the prior dispatch generation in the same write that
         * reopens the row. The dispatch below installs its fresh generation.
         */
        processingQueuedAt: null,
        processingQueueToken: null,
        processingStartedAt: null,
        processingDeferredUntil: null,
        processingCompletedAt: null,
        processingError: null,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
      })
      .where(
        and(
          eq(document.id, documentId),
          or(isNull(document.connectorId), isNotNull(document.contentHash)),
          or(
            inArray(document.processingStatus, ['completed', 'failed']),
            and(
              eq(document.processingStatus, 'pending'),
              sql`COALESCE(${document.processingQueuedAt}, ${document.uploadedAt}) < ${sql.param(queuedGraceCutoff, document.processingQueuedAt)}`,
              or(
                isNull(document.processingDeferredUntil),
                lt(document.processingDeferredUntil, queuedGraceCutoff)
              )
            )
          ),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
      .returning({ id: document.id })

    // Embeddings are dropped only for a document this call actually claimed,
    // so a losing double-click cannot wipe the winner's in-flight work.
    if (reset.length > 0) {
      await tx.delete(embedding).where(eq(embedding.documentId, documentId))
    }
    return reset.length > 0
  })

  if (!requeued) {
    const [sourceFailure] = await db
      .select({ id: document.id })
      .from(document)
      .where(
        and(
          eq(document.id, documentId),
          eq(document.knowledgeBaseId, knowledgeBaseId),
          isNotNull(document.connectorId),
          isNull(document.contentHash)
        )
      )
      .limit(1)
    if (sourceFailure)
      return {
        success: false,
        status: 'failed',
        message: 'Source content could not be downloaded. Sync the connector to retry.',
      }
    logger.info(`[${requestId}] Document retry skipped, already queued: ${documentId}`)
    return {
      success: true,
      status: 'pending',
      message: 'Document is already queued for processing',
    }
  }

  /**
   * The reset committed in its own transaction above, so a throwing dispatch
   * would leave the row at `pending` with nothing queued behind it — and the
   * grace window means the same click cannot recover it until that window
   * elapses again.
   * Recording the failure returns it to `failed`, which is immediately
   * retryable and visible in the document list with its reason.
   */
  try {
    const dispatch = await processDocumentsWithQueue(
      [
        {
          documentId,
          filename: docData.filename,
          fileUrl: docData.fileUrl,
          fileSize: docData.fileSize,
          mimeType: docData.mimeType,
        },
      ],
      knowledgeBaseId,
      {},
      requestId,
      billingAttribution
    )
    if (dispatch.failed > 0 || dispatch.accepted !== 1) {
      throw new Error(`Document processing dispatch was not accepted for ${documentId}`)
    }
  } catch (error) {
    const failureMessage = getErrorMessage(error, 'Document processing dispatch failed')
    await recordUndispatchedDocumentFailure({
      documentId,
      knowledgeBaseId,
      failureMessage,
      requestId,
    })
    return {
      success: false,
      status: 'failed',
      message: failureMessage,
    }
  }

  logger.info(`[${requestId}] Document retry initiated: ${documentId}`)

  return {
    success: true,
    status: 'pending',
    message: 'Document retry processing started',
  }
}

export async function updateDocument(
  documentId: string,
  updateData: {
    filename?: string
    enabled?: boolean
    chunkCount?: number
    tokenCount?: number
    characterCount?: number
    processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
    processingError?: string
    tag1?: string
    tag2?: string
    tag3?: string
    tag4?: string
    tag5?: string
    tag6?: string
    tag7?: string
    number1?: string
    number2?: string
    number3?: string
    number4?: string
    number5?: string
    date1?: string
    date2?: string
    boolean1?: string
    boolean2?: string
    boolean3?: string
  },
  requestId: string
): Promise<{
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  processingStartedAt: Date | null
  processingCompletedAt: Date | null
  processingError: string | null
  enabled: boolean
  uploadedAt: Date
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  number1: number | null
  number2: number | null
  number3: number | null
  number4: number | null
  number5: number | null
  date1: Date | null
  date2: Date | null
  boolean1: boolean | null
  boolean2: boolean | null
  boolean3: boolean | null
  deletedAt: Date | null
}> {
  const dbUpdateData: Partial<{
    filename: string
    enabled: boolean
    chunkCount: number
    tokenCount: number
    characterCount: number
    processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
    processingError: string | null
    processingStartedAt: Date | null
    processingCompletedAt: Date | null
    tag1: string | null
    tag2: string | null
    tag3: string | null
    tag4: string | null
    tag5: string | null
    tag6: string | null
    tag7: string | null
    number1: number | null
    number2: number | null
    number3: number | null
    number4: number | null
    number5: number | null
    date1: Date | null
    date2: Date | null
    boolean1: boolean | null
    boolean2: boolean | null
    boolean3: boolean | null
  }> = {}
  const ALL_TAG_SLOTS = [
    'tag1',
    'tag2',
    'tag3',
    'tag4',
    'tag5',
    'tag6',
    'tag7',
    'number1',
    'number2',
    'number3',
    'number4',
    'number5',
    'date1',
    'date2',
    'boolean1',
    'boolean2',
    'boolean3',
  ] as const
  type TagSlot = (typeof ALL_TAG_SLOTS)[number]

  if (updateData.filename !== undefined) dbUpdateData.filename = updateData.filename
  if (updateData.enabled !== undefined) dbUpdateData.enabled = updateData.enabled
  if (updateData.chunkCount !== undefined) dbUpdateData.chunkCount = updateData.chunkCount
  if (updateData.tokenCount !== undefined) dbUpdateData.tokenCount = updateData.tokenCount
  if (updateData.characterCount !== undefined)
    dbUpdateData.characterCount = updateData.characterCount
  if (updateData.processingStatus !== undefined)
    dbUpdateData.processingStatus = updateData.processingStatus
  if (updateData.processingError !== undefined)
    dbUpdateData.processingError = updateData.processingError

  const convertTagValue = (
    slot: string,
    value: string | undefined
  ): string | number | Date | boolean | null => {
    if (value === undefined || value === '') return null

    if (slot.startsWith('number')) {
      return parseNumberValue(value)
    }

    if (slot.startsWith('date')) {
      return parseDateValue(value)
    }

    if (slot.startsWith('boolean')) {
      return parseBooleanValue(value) ?? false
    }

    return value || null
  }

  type UpdateDataWithTags = typeof updateData & Record<TagSlot, string | undefined>
  const typedUpdateData = updateData as UpdateDataWithTags

  ALL_TAG_SLOTS.forEach((slot: TagSlot) => {
    const updateValue = typedUpdateData[slot]
    if (updateValue !== undefined) {
      ;(dbUpdateData as Record<TagSlot, string | number | Date | boolean | null>)[slot] =
        convertTagValue(slot, updateValue)
    }
  })

  const doc = await db.transaction(async (tx) => {
    const hasTagUpdates = ALL_TAG_SLOTS.some((field) => typedUpdateData[field] !== undefined)

    if (hasTagUpdates) {
      const embeddingUpdateData: Partial<ProcessedDocumentTags> = {}
      ALL_TAG_SLOTS.forEach((field) => {
        if (typedUpdateData[field] !== undefined) {
          ;(embeddingUpdateData as Record<TagSlot, string | number | Date | boolean | null>)[
            field
          ] = convertTagValue(field, typedUpdateData[field])
        }
      })

      await tx
        .update(embedding)
        .set(embeddingUpdateData)
        .where(eq(embedding.documentId, documentId))
    }

    const [current] = await tx
      .select()
      .from(document)
      .where(eq(document.id, documentId))
      .limit(1)
      .for('update')
    if (!current) return undefined

    const [sidecar] =
      current.secretProvenanceVersion === 1
        ? await tx
            .select()
            .from(documentSecretProvenance)
            .where(eq(documentSecretProvenance.documentId, documentId))
            .limit(1)
        : []
    const currentSource = createKnowledgeDocumentSourceValue(current)
    const currentProvenance = readBoundKnowledgeDocumentSecretProvenance({
      secretProvenanceVersion: current.secretProvenanceVersion,
      source: currentSource,
      provenanceSourceHash: sidecar?.sourceHash ?? null,
      status: sidecar?.status ?? null,
      entries: sidecar?.entries,
    })

    const [updated] = await tx
      .update(document)
      .set(dbUpdateData)
      .where(eq(document.id, documentId))
      .returning()
    if (updated && current.secretProvenanceVersion === 1) {
      const updatedSource = createKnowledgeDocumentSourceValue(updated)
      await replaceKnowledgeDocumentSecretProvenanceInTx(
        tx,
        documentId,
        updatedSource,
        rebindKnowledgeDocumentSecretProvenance(currentProvenance, currentSource, updatedSource)
      )
    }
    return updated
  })

  if (!doc) {
    throw new Error(`Document ${documentId} not found`)
  }

  logger.info(`[${requestId}] Document updated: ${documentId}`)

  return {
    id: doc.id,
    knowledgeBaseId: doc.knowledgeBaseId,
    filename: doc.filename,
    fileUrl: doc.fileUrl,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    chunkCount: doc.chunkCount,
    tokenCount: doc.tokenCount,
    characterCount: doc.characterCount,
    processingStatus: doc.processingStatus as 'pending' | 'processing' | 'completed' | 'failed',
    processingStartedAt: doc.processingStartedAt,
    processingCompletedAt: doc.processingCompletedAt,
    processingError: doc.processingError,
    enabled: doc.enabled,
    uploadedAt: doc.uploadedAt,
    tag1: doc.tag1,
    tag2: doc.tag2,
    tag3: doc.tag3,
    tag4: doc.tag4,
    tag5: doc.tag5,
    tag6: doc.tag6,
    tag7: doc.tag7,
    number1: doc.number1,
    number2: doc.number2,
    number3: doc.number3,
    number4: doc.number4,
    number5: doc.number5,
    date1: doc.date1,
    date2: doc.date2,
    boolean1: doc.boolean1,
    boolean2: doc.boolean2,
    boolean3: doc.boolean3,
    deletedAt: doc.deletedAt,
  }
}

function getKnowledgeBaseStorageKey(fileUrl: string | null): string | null {
  if (!fileUrl) {
    return null
  }

  try {
    const urlPath = new URL(fileUrl, 'http://localhost').pathname
    const storageKey = extractStorageKey(urlPath)
    return storageKey !== urlPath ? storageKey : null
  } catch {
    return null
  }
}

/** Each entry deletes a storage object plus its metadata row. */
const STORAGE_DELETE_CONCURRENCY = 10

export async function deleteDocumentStorageFiles(
  documentsToDelete: Array<{ id: string; fileUrl: string | null } & ResourceOwner>,
  requestId: string
): Promise<void> {
  const entries = documentsToDelete.map((doc) => ({
    doc,
    storageKey: getKnowledgeBaseStorageKey(doc.fileUrl),
  }))

  const storageKeys = [
    ...new Set(
      entries
        .map((entry) => entry.storageKey)
        .filter(
          (key): key is string => typeof key === 'string' && isKnowledgeBaseOwnedStorageKey(key)
        )
    ),
  ]
  const bindingByKey = new Map<string, FileMetadataRecord>()
  if (storageKeys.length > 0) {
    const bindings = await getFileMetadataByKeys(storageKeys, 'knowledge-base')
    for (const binding of bindings) {
      bindingByKey.set(binding.key, binding)
    }
  }

  await mapWithConcurrency(entries, STORAGE_DELETE_CONCURRENCY, async ({ doc, storageKey }) => {
    if (!storageKey) {
      return
    }

    if (!isKnowledgeBaseOwnedStorageKey(storageKey)) {
      return
    }

    const binding = bindingByKey.get(storageKey)
    if (!binding || binding.deletedAt || binding.context !== 'knowledge-base') {
      logger.warn(`[${requestId}] Skipping storage delete: no ownership binding for key`, {
        documentId: doc.id,
        storageKey,
      })
      return
    }
    try {
      if (!sameResourceScope(resourceScopeFromOwner(binding), resourceScopeFromOwner(doc))) {
        throw new Error('Storage ownership binding does not match the document owner')
      }
      const metadataDeleted = await deleteFileMetadataByIdentity({
        id: binding.id,
        key: binding.key,
        context: binding.context,
        contentUpdatedAt: binding.contentUpdatedAt,
      })
      if (!metadataDeleted) {
        logger.warn(`[${requestId}] Skipping storage delete: ownership binding changed`, {
          documentId: doc.id,
          storageKey,
        })
        return
      }
      await deleteFile({ key: storageKey, context: 'knowledge-base' })
    } catch (error) {
      logger.warn(`[${requestId}] Failed to delete document storage file`, {
        documentId: doc.id,
        error: toError(error).message,
      })
    }
  })
}

async function excludeConnectorDocuments(
  documentIds: string[],
  requestId: string
): Promise<number> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) {
    return 0
  }

  const updated = await db
    .update(document)
    .set({
      userExcluded: true,
      enabled: false,
    })
    .where(and(inArray(document.id, ids), isNotNull(document.connectorId)))
    .returning({ id: document.id })

  if (updated.length > 0) {
    logger.info(`[${requestId}] Excluded ${updated.length} connector-backed document(s)`, {
      documentIds: updated.map((doc) => doc.id),
    })
  }

  return updated.length
}

/**
 * Deletes documents by their lifecycle: connector-owned ones are excluded,
 * uploads are hard deleted. `access`, when given, is applied to the selection
 * and to every write, so a document the caller stopped being able to read
 * after they looked it up is left alone rather than deleted on a stale view.
 */
async function deleteDocumentsByLifecyclePolicy(
  documentIds: string[],
  requestId: string,
  expectedKnowledgeBaseId?: string,
  access?: KnowledgeAccessScope
): Promise<number> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) {
    return 0
  }

  const docs = await db
    .select({
      id: document.id,
      connectorId: document.connectorId,
    })
    .from(document)
    .where(
      expectedKnowledgeBaseId
        ? and(
            inArray(document.id, ids),
            eq(document.knowledgeBaseId, expectedKnowledgeBaseId),
            eq(document.userExcluded, false),
            isNull(document.archivedAt),
            isNull(document.deletedAt),
            access ? knowledgeAccessCondition(access) : undefined
          )
        : inArray(document.id, ids)
    )

  const connectorBackedIds = docs.filter((doc) => doc.connectorId !== null).map((doc) => doc.id)
  const hardDeleteIds = docs.filter((doc) => doc.connectorId === null).map((doc) => doc.id)

  const [excludedCount, hardDeletedCount] = await Promise.all([
    expectedKnowledgeBaseId
      ? excludeConnectorKnowledgeDocuments(
          expectedKnowledgeBaseId,
          connectorBackedIds,
          requestId,
          access
        )
      : excludeConnectorDocuments(connectorBackedIds, requestId),
    hardDeleteDocuments(
      hardDeleteIds,
      requestId,
      undefined,
      expectedKnowledgeBaseId,
      undefined,
      access
    ),
  ])

  return excludedCount + hardDeletedCount
}

export class ConnectorSyncDeletionGuardError extends Error {
  constructor() {
    super('Connector sync no longer owns the destructive document operation')
    this.name = 'ConnectorSyncDeletionGuardError'
  }
}

export interface ConnectorSyncDeletionGuard {
  connectorId: string
  knowledgeBaseId: string
  syncLockToken: string
  /**
   * Which engine's lease the token belongs to. The content engine locks
   * `sync_lock_token`; the members-mode engine locks `member_sync_lock_token`,
   * and the two never coexist on one connector.
   */
  lease?: 'content' | 'member'
}

/** The lease predicate a deletion guard re-verifies under `FOR UPDATE`. */
function connectorSyncGuardHeld(guard: ConnectorSyncDeletionGuard) {
  return guard.lease === 'member'
    ? and(
        eq(knowledgeConnector.memberSyncStatus, 'running'),
        eq(knowledgeConnector.memberSyncLockToken, guard.syncLockToken)
      )
    : and(
        eq(knowledgeConnector.status, 'syncing'),
        eq(knowledgeConnector.syncLockToken, guard.syncLockToken)
      )
}

export async function hardDeleteDocuments(
  documentIds: string[],
  requestId: string,
  /**
   * When provided, re-verifies each document's connectorId still matches at
   * the moment of the actual delete query — not just the caller's earlier
   * snapshot. A caller (e.g. connector sync reconciliation) can compute this
   * ID list well before the delete runs; a concurrent request that detaches
   * these same documents from the connector in between (e.g. "delete
   * connector, keep documents") would otherwise still have them purged here
   * despite no longer belonging to the connector the caller reasoned about.
   */
  expectedConnectorId?: string,
  expectedKnowledgeBaseId?: string,
  connectorSyncGuard?: ConnectorSyncDeletionGuard,
  /** When provided, only documents the caller may currently read are deleted, re-verified at the delete itself. */
  access?: KnowledgeAccessScope
): Promise<number> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) {
    return 0
  }

  let deletedCount = 0
  for (let offset = 0; offset < ids.length; offset += HARD_DELETE_DOCUMENT_BATCH_SIZE) {
    deletedCount += await hardDeleteDocumentBatch(
      ids.slice(offset, offset + HARD_DELETE_DOCUMENT_BATCH_SIZE),
      requestId,
      expectedConnectorId,
      expectedKnowledgeBaseId,
      connectorSyncGuard,
      access
    )
  }
  return deletedCount
}

/**
 * Hard-deletes one bounded metadata batch and applies every associated ledger
 * delta atomically.
 */
async function hardDeleteDocumentBatch(
  documentIds: string[],
  requestId: string,
  expectedConnectorId?: string,
  expectedKnowledgeBaseId?: string,
  connectorSyncGuard?: ConnectorSyncDeletionGuard,
  access?: KnowledgeAccessScope
): Promise<number> {
  const ids = [...new Set(documentIds)]
  const scopedConnectorId = connectorSyncGuard?.connectorId ?? expectedConnectorId
  const scopedKnowledgeBaseId = connectorSyncGuard?.knowledgeBaseId ?? expectedKnowledgeBaseId
  const requireEligibleDocument = Boolean(expectedKnowledgeBaseId || connectorSyncGuard)
  const requireVisibleDocument = Boolean(expectedKnowledgeBaseId && !connectorSyncGuard)
  const accessCondition = access ? knowledgeAccessCondition(access) : undefined
  const documentsToDelete = await db
    .select({
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      fileUrl: document.fileUrl,
      fileSize: document.fileSize,
      uploadedBy: document.uploadedBy,
      connectorId: document.connectorId,
      workspaceId: knowledgeBase.workspaceId,
      organizationId: knowledgeBase.organizationId,
      kbUserId: knowledgeBase.userId,
    })
    .from(document)
    .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
    .where(
      and(
        inArray(document.id, ids),
        scopedConnectorId ? eq(document.connectorId, scopedConnectorId) : undefined,
        scopedKnowledgeBaseId ? eq(document.knowledgeBaseId, scopedKnowledgeBaseId) : undefined,
        requireEligibleDocument ? eq(document.userExcluded, false) : undefined,
        requireEligibleDocument ? isNull(document.archivedAt) : undefined,
        requireVisibleDocument ? isNull(document.deletedAt) : undefined,
        accessCondition
      )
    )

  if (documentsToDelete.length === 0) {
    return 0
  }

  const existingIds = documentsToDelete.map((doc) => doc.id)

  /**
   * Resolve immutable workspace payers and legacy account subscriptions before
   * opening the deletion transaction. Connector documents were never metered.
   */
  const storageContextByWorkspace = new Map<string, StorageBillingContext>()
  const candidateUserIds = new Set<string>()
  for (const doc of documentsToDelete) {
    if (doc.organizationId || doc.connectorId || doc.fileSize <= 0) continue
    if (doc.workspaceId) {
      if (!storageContextByWorkspace.has(doc.workspaceId)) {
        storageContextByWorkspace.set(
          doc.workspaceId,
          await resolveStorageBillingContext(doc.workspaceId)
        )
      }
      continue
    }
    const billedUserId = doc.uploadedBy ?? doc.kbUserId
    if (billedUserId) candidateUserIds.add(billedUserId)
  }
  const subByUser = new Map<string, HighestPrioritySubscription | null>()
  for (const billedUserId of candidateUserIds) {
    subByUser.set(billedUserId, await getHighestPrioritySubscription(billedUserId))
  }

  /**
   * Key every decrement off rows this transaction actually deleted so
   * concurrent deletion cannot double-decrement a payer.
   */
  let deletedDocs: typeof documentsToDelete = []
  await db.transaction(async (tx) => {
    /**
     * Lock every parent KB in stable ID order before deleting document rows.
     * Normal inserts and KB moves take the same parent lock first, so the
     * workspace snapshots used for accounting cannot change mid-delete.
     */
    const knowledgeBaseIds = [
      ...new Set(documentsToDelete.map((doc) => doc.knowledgeBaseId)),
    ].sort()
    const lockedKnowledgeBases = await tx
      .select({
        id: knowledgeBase.id,
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
        userId: knowledgeBase.userId,
      })
      .from(knowledgeBase)
      .where(
        and(
          inArray(knowledgeBase.id, knowledgeBaseIds),
          connectorSyncGuard ? isNull(knowledgeBase.deletedAt) : undefined
        )
      )
      .orderBy(asc(knowledgeBase.id))
      .for('update')
    const lockedKnowledgeBaseById = new Map(lockedKnowledgeBases.map((kb) => [kb.id, kb]))
    for (const doc of documentsToDelete) {
      const lockedKb = lockedKnowledgeBaseById.get(doc.knowledgeBaseId)
      if (!lockedKb && connectorSyncGuard) {
        throw new ConnectorSyncDeletionGuardError()
      }
      if (
        !lockedKb ||
        lockedKb.workspaceId !== doc.workspaceId ||
        (lockedKb.organizationId ?? null) !== (doc.organizationId ?? null) ||
        lockedKb.userId !== doc.kbUserId
      ) {
        throw new Error(
          `Knowledge base ${doc.knowledgeBaseId} storage ownership changed; retry document deletion`
        )
      }
    }

    if (connectorSyncGuard) {
      const [heldSyncLock] = await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.id, connectorSyncGuard.connectorId),
            eq(knowledgeConnector.knowledgeBaseId, connectorSyncGuard.knowledgeBaseId),
            connectorSyncGuardHeld(connectorSyncGuard),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .for('update')

      if (!heldSyncLock) {
        throw new ConnectorSyncDeletionGuardError()
      }
    }

    /**
     * Re-verify `expectedConnectorId` here too, not only on the pre-transaction
     * SELECT above — the billing lookups and KB locking between that SELECT
     * and this delete are async and can span a concurrent "delete connector,
     * keep documents" request that clears these rows' `connectorId` in
     * between. Deleting a detached document's embeddings would corrupt its
     * search index even if the document row itself were spared, so both the
     * embedding delete and the document delete are scoped to this re-verified
     * ID set rather than the stale `existingIds`.
     */
    const stillTargetedIds =
      scopedConnectorId || scopedKnowledgeBaseId || accessCondition
        ? (
            await tx
              .select({ id: document.id })
              .from(document)
              .where(
                and(
                  inArray(document.id, existingIds),
                  scopedConnectorId ? eq(document.connectorId, scopedConnectorId) : undefined,
                  scopedKnowledgeBaseId
                    ? eq(document.knowledgeBaseId, scopedKnowledgeBaseId)
                    : undefined,
                  requireEligibleDocument ? eq(document.userExcluded, false) : undefined,
                  requireEligibleDocument ? isNull(document.archivedAt) : undefined,
                  requireVisibleDocument ? isNull(document.deletedAt) : undefined,
                  accessCondition
                )
              )
              .orderBy(asc(document.id))
              .for('update')
          ).map((d) => d.id)
        : existingIds

    await tx.delete(embedding).where(inArray(embedding.documentId, stillTargetedIds))
    const deletedRows = await tx
      .delete(document)
      .where(inArray(document.id, stillTargetedIds))
      .returning({ id: document.id })

    const deletedIds = new Set(deletedRows.map((row) => row.id))
    deletedDocs = documentsToDelete.filter((doc) => deletedIds.has(doc.id))

    const bytesByWorkspace = new Map<string, number>()
    const legacyBytesByUser = new Map<string, number>()
    for (const doc of deletedDocs) {
      if (doc.organizationId || doc.connectorId || doc.fileSize <= 0) continue
      if (doc.workspaceId) {
        bytesByWorkspace.set(
          doc.workspaceId,
          (bytesByWorkspace.get(doc.workspaceId) ?? 0) + doc.fileSize
        )
        continue
      }
      const billedUserId = doc.uploadedBy ?? doc.kbUserId
      if (!billedUserId) continue
      legacyBytesByUser.set(billedUserId, (legacyBytesByUser.get(billedUserId) ?? 0) + doc.fileSize)
    }
    await applyStorageUsageDeltasInTx(tx, {
      workspaceDeltas: [...bytesByWorkspace.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([workspaceId, bytes]) => {
          const context = storageContextByWorkspace.get(workspaceId)
          if (!context) {
            throw new Error(`Missing storage billing context for workspace ${workspaceId}`)
          }
          return { context, deltaBytes: -bytes }
        }),
      legacyDeltas: [...legacyBytesByUser.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([userId, bytes]) => ({
          userId,
          subscription: subByUser.get(userId) ?? null,
          deltaBytes: -bytes,
        })),
    })
  })

  await deleteDocumentStorageFiles(deletedDocs, requestId)

  logger.info(`[${requestId}] Hard deleted ${deletedDocs.length} documents`, {
    documentIds: deletedDocs.map((doc) => doc.id),
  })

  return deletedDocs.length
}

export async function deleteDocument(
  documentId: string,
  requestId: string
): Promise<{ success: boolean; message: string }> {
  await deleteDocumentsByLifecyclePolicy([documentId], requestId)

  return {
    success: true,
    message: 'Document deleted successfully',
  }
}

/**
 * Deletes one currently visible document within its canonical knowledge base.
 * The caller's access is re-applied at the delete itself, so a token member
 * sync revokes between the lookup and the write cannot still delete.
 */
export async function deleteKnowledgeDocumentInKnowledgeBase(
  knowledgeBaseId: string,
  documentId: string,
  requestId: string,
  access: KnowledgeAccessScope
): Promise<void> {
  const current = await getKnowledgeDocument(knowledgeBaseId, documentId, access)
  if (!current) throw new OrchestrationError('not_found', 'Document not found')
  const affected = await deleteDocumentsByLifecyclePolicy(
    [documentId],
    requestId,
    knowledgeBaseId,
    access
  )
  if (affected !== 1) throw new OrchestrationError('not_found', 'Document not found')
}

async function excludeConnectorKnowledgeDocuments(
  knowledgeBaseId: string,
  documentIds: string[],
  requestId: string,
  access?: KnowledgeAccessScope
): Promise<number> {
  if (documentIds.length === 0) return 0
  const updated = await db
    .update(document)
    .set({ userExcluded: true, enabled: false })
    .where(
      and(
        inArray(document.id, documentIds),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        isNotNull(document.connectorId),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt),
        access ? knowledgeAccessCondition(access) : undefined
      )
    )
    .returning({ id: document.id })
  if (updated.length > 0) {
    logger.info(`[${requestId}] Excluded ${updated.length} connector-backed document(s)`, {
      documentIds: updated.map((row) => row.id),
      knowledgeBaseId,
    })
  }
  return updated.length
}
