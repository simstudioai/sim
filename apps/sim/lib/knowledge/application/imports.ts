import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import type {
  V2CreateKnowledgeImportBody,
  V2KnowledgeImportStatus,
} from '@/lib/api/contracts/v2/knowledge'
import {
  authorizeWorkspaceOperation,
  capabilityGovernedPrincipalUserId,
} from '@/lib/core/application'
import { dispatchBackgroundTask } from '@/lib/core/async-jobs/background-task'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { assertKnowledgeUsageAdmitted } from '@/lib/knowledge/application/billing'
import {
  type KnowledgeWorkspaceContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  findKnowledgeImport,
  getKnowledgeImport,
  insertKnowledgeImport,
  KNOWLEDGE_IMPORT_STORAGE_CONTEXT,
  type KnowledgeImportFailure,
  type KnowledgeImportRecord,
  stopKnowledgeImport,
} from '@/lib/knowledge/transfer/import-jobs'
import {
  type KnowledgeImportPayload,
  runKnowledgeImport,
} from '@/lib/knowledge/transfer/import-runner'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { requestOrigin } from '@/lib/uploads/upload-session/application'
import {
  abortUploadSession,
  assertUploadSessionAuthBinding,
  type CreatedUploadSession,
  completeUploadSession,
  createUploadPartUrls,
  createUploadSession,
  getOwnedUploadSession,
  importStatusForUploadSession,
  type UploadSessionRecord,
} from '@/lib/uploads/upload-session/service'
import type { knowledgeImportTask } from '@/background/knowledge-import'

const logger = createLogger('KnowledgeImportApplication')

/** Upload-session metadata key holding what the import was created with. */
const IMPORT_METADATA_KEY = 'knowledgeImport'

/** An import in either half of its life: its upload, then its durable record. */
export interface KnowledgeImportResource {
  id: string
  workspaceId: string
  status: V2KnowledgeImportStatus
  knowledgeBaseId: string | null
  documentsTotal: number
  documentsImported: number
  documentsFailed: number
  vectorsReused: boolean
  failures: KnowledgeImportFailure[]
  error: string | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

interface CreateKnowledgeImportInput {
  body: V2CreateKnowledgeImportBody
}

interface KnowledgeImportInput {
  importId: string
  workspaceId: string
  uploadToken?: string
}

interface KnowledgeImportUploadInput extends KnowledgeImportInput {
  uploadToken: string
}

interface CreateKnowledgeImportPartsInput extends KnowledgeImportUploadInput {
  partNumbers: number[]
}

export interface CreateKnowledgeImportResult {
  import: KnowledgeImportResource
  upload: CreatedUploadSession
}

interface KnowledgeImportResult {
  import: KnowledgeImportResource
}

interface KnowledgeImportRecordContext extends KnowledgeWorkspaceContext {
  record: KnowledgeImportRecord
}

interface KnowledgeImportUploadContext extends KnowledgeWorkspaceContext {
  upload: UploadSessionRecord
}

type KnowledgeImportContext = KnowledgeImportRecordContext | KnowledgeImportUploadContext

function fromRecord(record: KnowledgeImportRecord): KnowledgeImportResource {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    status: record.status === 'running' ? 'processing' : record.status,
    knowledgeBaseId: record.knowledgeBaseId,
    documentsTotal: record.documentsTotal,
    documentsImported: record.documentsImported,
    documentsFailed: record.documentsFailed,
    vectorsReused: record.vectorsReused,
    failures: record.failures,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  }
}

function fromUpload(upload: UploadSessionRecord, workspaceId: string): KnowledgeImportResource {
  return {
    id: upload.id,
    workspaceId,
    status: importStatusForUploadSession(upload.status),
    knowledgeBaseId: null,
    documentsTotal: 0,
    documentsImported: 0,
    documentsFailed: 0,
    vectorsReused: false,
    failures: [],
    error: null,
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
    completedAt: upload.completedAt,
  }
}

/** The name override the import was created with, read back from its upload session. */
function importedName(upload: UploadSessionRecord): string | undefined {
  const stored = upload.metadata[IMPORT_METADATA_KEY]
  if (!isRecordLike(stored) || typeof stored.name !== 'string') return undefined
  return stored.name
}

/**
 * permission-group-enforced: knowledge.upload — an import creates a base, which
 * the operations' `knowledge.create` governs, but it also fills that base with
 * caller-supplied documents, which `knowledge.upload` governs everywhere else.
 * An operation names one capability, so the second is asserted here. Keyed to
 * the governed subject, which names nobody for an actorless run or an executor
 * delegation; a copilot delegation stays governed.
 */
async function assertImportedDocumentsAllowed(
  principal: Principal,
  workspaceId: string
): Promise<void> {
  const actingUserId = capabilityGovernedPrincipalUserId(principal)
  if (actingUserId) await assertWorkspaceCapability(actingUserId, workspaceId, 'knowledge.upload')
}

async function resolveUploadContext(
  principal: Principal,
  input: KnowledgeImportUploadInput
): Promise<KnowledgeImportUploadContext> {
  const upload = await getOwnedUploadSession({
    uploadId: input.importId,
    workspaceId: input.workspaceId,
    purpose: 'knowledge_import',
    uploadToken: input.uploadToken,
    principal,
  })
  if (upload.storageContext !== KNOWLEDGE_IMPORT_STORAGE_CONTEXT || !upload.workspaceId) {
    throw new OrchestrationError('not_found', 'Knowledge base import not found')
  }
  return {
    ...(await resolveKnowledgeWorkspaceContext({ workspaceId: upload.workspaceId })),
    upload,
  }
}

async function resolveImportContext(
  principal: Principal,
  input: KnowledgeImportInput
): Promise<KnowledgeImportContext> {
  if (input.uploadToken) {
    return resolveUploadContext(principal, { ...input, uploadToken: input.uploadToken })
  }
  const record = await getKnowledgeImport({
    importId: input.importId,
    assertedWorkspaceId: input.workspaceId,
  })
  return {
    ...(await resolveKnowledgeWorkspaceContext({ workspaceId: record.workspaceId })),
    record,
  }
}

/**
 * The durable record once the runner has been dispatched, which a caller still
 * holding the upload token must see in place of its finished upload.
 */
function findStartedImport(context: KnowledgeImportUploadContext) {
  return findKnowledgeImport({
    importId: context.upload.id,
    assertedWorkspaceId: context.workspaceId,
  })
}

/** What the runner needs, with usage admitted for the caller completing the upload. */
async function importPayload(
  principal: Principal,
  context: KnowledgeImportUploadContext
): Promise<KnowledgeImportPayload> {
  const { billingAttribution, userId } = await assertKnowledgeUsageAdmitted(principal, context)
  const { upload } = context
  const name = importedName(upload)
  return {
    importId: upload.id,
    workspaceId: context.workspaceId,
    userId,
    ...(name ? { name } : {}),
    sourceKey: upload.storageKey,
    billingAttribution,
  }
}

/**
 * Writes the durable record while the upload is being completed, before it
 * counts as complete. From then on the stale-import janitor owns the bundle, so
 * neither a crash nor a refusal after this point can strand it; a refusal
 * before it leaves the session unfinished, which its abort and expiry discard.
 * Returns the runner's payload, or `null` when a repeated completion finds the
 * record already written.
 */
async function recordKnowledgeImport(
  principal: Principal,
  context: KnowledgeImportUploadContext
): Promise<KnowledgeImportPayload | null> {
  const payload = await importPayload(principal, context)
  const inserted = await insertKnowledgeImport({
    id: payload.importId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    sourceKey: payload.sourceKey,
  })
  return inserted ? payload : null
}

function startKnowledgeImport(payload: KnowledgeImportPayload): Promise<void> {
  return dispatchBackgroundTask<typeof knowledgeImportTask>('knowledge-import', payload, {
    runInProcess: runKnowledgeImport,
    trigger: { tags: [`workspaceId:${payload.workspaceId}`, `importId:${payload.importId}`] },
  })
}

/**
 * Dispatches again an import whose record no worker has claimed: its first
 * dispatch failed or was lost with the request that wrote the record, or is
 * still queued. Either way a second run is safe, since only one worker can
 * claim it. A dispatch never settles the import itself, since another one may
 * already be on its way; one that never runs is failed by the stale-import
 * janitor, which also deletes its bundle.
 */
async function redispatchUnclaimedImport(
  principal: Principal,
  context: KnowledgeImportUploadContext,
  record: KnowledgeImportRecord
): Promise<void> {
  if (record.status !== 'running' || record.startedAt) return
  // A group that withdrew uploads since the record was written stops it here too.
  await assertImportedDocumentsAllowed(principal, context.workspaceId)
  try {
    await startKnowledgeImport(await importPayload(principal, context))
  } catch (error) {
    logger.warn('Could not dispatch an unclaimed knowledge import again', {
      importId: record.id,
      error: getErrorMessage(error, 'Unknown error'),
    })
  }
}

export const createKnowledgeImport = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.importCreate,
  resolveContext: ({ input }: { input: CreateKnowledgeImportInput }) =>
    resolveKnowledgeWorkspaceContext({ workspaceId: input.body.workspaceId }),
  async execute({ principal, input, context, request }): Promise<CreateKnowledgeImportResult> {
    if (!request) throw new Error('Knowledge import creation requires a request context')
    await assertImportedDocumentsAllowed(principal, context.workspaceId)
    const { source, name } = input.body
    if (!source.name.toLowerCase().endsWith('.zip')) {
      throw new OrchestrationError('validation', 'A knowledge base bundle must be a .zip archive')
    }
    // Refused before the bundle moves, so a full plan never uploads gigabytes to be turned away.
    const { userId } = await assertKnowledgeUsageAdmitted(principal, context)
    const upload = await createUploadSession({
      id: generateId(),
      workspaceId: context.workspaceId,
      userId,
      principal,
      purpose: 'knowledge_import',
      fileName: source.name,
      contentType: source.contentType,
      fileSize: source.size,
      metadata: { [IMPORT_METADATA_KEY]: name ? { name } : {} },
      localOrigin: requestOrigin(request),
    })
    logger.info('Created knowledge import', {
      importId: upload.id,
      workspaceId: context.workspaceId,
      principalKind: principal.kind,
    })
    return { import: fromUpload(upload, context.workspaceId), upload }
  },
})

/**
 * Reads an import in any state. A caller holding the upload token is resolved
 * against the session, but the durable record wins once it exists: the session
 * stays `completed` after the runner starts, and reporting `uploading` for an
 * import that is already processing would strand a poller.
 */
export const readKnowledgeImport = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.importRead,
  resolveContext: ({ principal, input }: { principal: Principal; input: KnowledgeImportInput }) =>
    resolveImportContext(principal, input),
  async execute({ context }): Promise<KnowledgeImportResult> {
    if ('record' in context) return { import: fromRecord(context.record) }
    const started = await findStartedImport(context)
    return {
      import: started ? fromRecord(started) : fromUpload(context.upload, context.workspaceId),
    }
  },
})

export const createKnowledgeImportParts = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.importParts,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CreateKnowledgeImportPartsInput
  }) => resolveUploadContext(principal, input),
  async execute({ principal, input, context, request }) {
    if (!request) throw new Error('Knowledge import part issuance requires a request context')
    // Repeated so a group that withdraws uploads mid-transfer stops the bytes, not just the import.
    await assertImportedDocumentsAllowed(principal, context.workspaceId)
    return {
      parts: await createUploadPartUrls({
        session: context.upload,
        partNumbers: input.partNumbers,
        localOrigin: requestOrigin(request),
      }),
    }
  },
})

export const completeKnowledgeImport = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.importComplete,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: KnowledgeImportUploadInput
  }) => resolveUploadContext(principal, input),
  async execute({ principal, context }): Promise<KnowledgeImportResult> {
    const existing = await findStartedImport(context)
    if (existing) {
      await redispatchUnclaimedImport(principal, context, existing)
      return { import: fromRecord(existing) }
    }
    let started: KnowledgeImportPayload | null
    try {
      const completed = await completeUploadSession({
        session: context.upload,
        finalize: async (claimed) => {
          assertUploadSessionAuthBinding(claimed, principal)
          await authorizeWorkspaceOperation(
            principal,
            knowledgeOperations.importComplete,
            context,
            { delegation: knowledgeDelegationPolicy }
          )
          // Repeated because creation and completion are separate requests; see the helper.
          await assertImportedDocumentsAllowed(principal, context.workspaceId)
          return { value: await recordKnowledgeImport(principal, { ...context, upload: claimed }) }
        },
      })
      started = completed.value
    } catch (error) {
      // A concurrent completion holds the session; report the import it started, if any.
      const raced =
        asOrchestrationError(error)?.code === 'conflict' ? await findStartedImport(context) : null
      if (raced) return { import: fromRecord(raced) }
      throw error
    }
    if (started) {
      await startKnowledgeImport(started)
      logger.info('Started knowledge import', {
        importId: started.importId,
        workspaceId: context.workspaceId,
        principalKind: principal.kind,
      })
    }
    const record = await getKnowledgeImport({
      importId: context.upload.id,
      assertedWorkspaceId: context.workspaceId,
    })
    return { import: fromRecord(record) }
  },
  /**
   * What the caller did is start the import: the base exists only once the
   * runner creates it, under the import's id. Keyed by the import, so the
   * completion that started it and any retry of it record one event between them.
   */
  projectAudit: ({ context, result }) => ({
    action: AuditAction.KNOWLEDGE_BASE_IMPORT_STARTED,
    resourceType: AuditResourceType.KNOWLEDGE_BASE,
    resourceId: result.import.id,
    resourceName: importedName(context.upload) ?? context.upload.fileName,
    description: `Started importing a knowledge base from bundle "${context.upload.fileName}"`,
    metadata: { workspaceId: context.workspaceId, importId: result.import.id },
    idempotencyKey: `knowledge-import:${result.import.id}`,
  }),
})

/**
 * Stops an import. During its upload that aborts the transfer; once the
 * runner is going it stops after the document in flight, and the documents
 * already imported stay in the new base.
 */
export const cancelKnowledgeImport = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.importCancel,
  resolveContext: ({ principal, input }: { principal: Principal; input: KnowledgeImportInput }) =>
    resolveImportContext(principal, input),
  async execute({ principal, context }): Promise<KnowledgeImportResult> {
    if ('record' in context)
      return { import: fromRecord(await stopKnowledgeImport(context.record)) }
    const started = await findStartedImport(context)
    if (started) return { import: fromRecord(await stopKnowledgeImport(started)) }
    assertUploadSessionAuthBinding(context.upload, principal)
    const aborted = await abortUploadSession(context.upload)
    // A completion finalizing alongside this abort may have written the record first.
    const late = await findStartedImport(context)
    if (late) return { import: fromRecord(await stopKnowledgeImport(late)) }
    return { import: fromUpload(aborted, context.workspaceId) }
  },
})
