import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { reportDurableSecretProvenanceRefusal } from '@/lib/execution/durable-secret-provenance-enforcement'
import { PROVENANCE_MAX_ENTRIES } from '@/lib/execution/provenance-limits'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  ADD_WORKSPACE_FILES_COST_POLICY,
  type KnowledgeBatchExecutionResult,
  requireBoundedKnowledgeBatch,
  rethrowKnowledgeBatchTerminalFailure,
} from '@/lib/knowledge/application/batch-policy'
import {
  KnowledgeUsageLimitExceededError,
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeBaseContext,
  resolveActiveKnowledgeBaseContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { createSingleDocument } from '@/lib/knowledge/documents/service'
import { uploadKnowledgeArtifact } from '@/lib/knowledge/documents/storage-upload'
import { generateKnowledgeBaseFileKey } from '@/lib/uploads/contexts/knowledge-base/knowledge-base-file-manager'
import {
  fetchServableWorkspaceFileBuffer,
  getWorkspaceFile,
  loadActiveWorkspaceFileContext,
  resolveWorkspaceFileReference,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenanceIdentity,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  EMPTY_KNOWLEDGE_DOCUMENT_MESSAGE,
  MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
} from '@/lib/uploads/shared/types'
import { validateFileType } from '@/lib/uploads/utils/validation'

const SOURCE_READ_TIMEOUT_MS = 120_000

export interface AddWorkspaceFilesToKnowledgeBaseInput {
  knowledgeBaseId: string
  assertedWorkspaceId?: string
  fileReferences: string[]
  cancellationSignal?: AbortSignal
  source?: string
}

interface AddedWorkspaceFileDocument {
  documentId: string
  filename: string
  mimeType: string
  fileSize: number
}

export interface AddWorkspaceFilesToKnowledgeBaseResult {
  knowledgeBaseId: string
  knowledgeBaseName: string
  added: AddedWorkspaceFileDocument[]
  failed: string[]
  cancelled: boolean
}

interface AddWorkspaceFilesExecutionResult
  extends AddWorkspaceFilesToKnowledgeBaseResult,
    KnowledgeBatchExecutionResult {}

interface AddWorkspaceFilesContext extends ActiveKnowledgeBaseContext {
  fileReferences: string[]
}

interface PreparedWorkspaceFile {
  reference: string
  file: WorkspaceFileRecord
}

async function prepareWorkspaceFile(
  principal: Principal,
  context: AddWorkspaceFilesContext,
  reference: string,
  lookup: 'reference' | 'id' = 'reference'
): Promise<PreparedWorkspaceFile> {
  const file =
    lookup === 'id'
      ? await getWorkspaceFile(context.workspaceId, reference, { throwOnError: true })
      : await resolveWorkspaceFileReference(context.workspaceId, reference)
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  const canonical = await loadActiveWorkspaceFileContext(file.id)
  if (!canonical || canonical.workspaceId !== context.workspaceId) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  await authorizeWorkspaceOperation(principal, knowledgeOperations.addWorkspaceFiles, canonical, {
    delegation: knowledgeDelegationPolicy,
  })
  if (file.size < 0 || file.size > MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE) {
    throw new OrchestrationError('payload_too_large', 'Knowledge document exceeds the 100MB limit')
  }
  if (file.size === 0) {
    throw new OrchestrationError('validation', EMPTY_KNOWLEDGE_DOCUMENT_MESSAGE)
  }
  const fileTypeError = validateFileType(file.name, file.type)
  if (fileTypeError) throw new OrchestrationError('validation', fileTypeError.message)

  await assertImportProvenance(context.workspaceId, {
    fileId: file.id,
    key: file.key,
    context: file.storageContext ?? 'workspace',
    ...(file.contentUpdatedAt ? { contentUpdatedAt: file.contentUpdatedAt } : {}),
  })

  return {
    reference,
    file,
  }
}

async function assertImportProvenance(
  workspaceId: string,
  identity: WorkspaceFileSecretProvenanceIdentity
): Promise<void> {
  const provenance = await getBoundWorkspaceFileSecretProvenance(workspaceId, identity)
  if (provenance.status !== 'exact' || provenance.entries.length > 0) {
    reportDurableSecretProvenanceRefusal({
      surface: 'knowledge',
      cause: 'knowledge-workspace-file-source-unavailable',
      workspaceId,
      resourceId: identity.fileId,
    })
    throw new OrchestrationError(
      'validation',
      'Workspace file secret provenance prevents knowledge ingestion'
    )
  }
}

export const addWorkspaceFilesToKnowledgeBase = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.addWorkspaceFiles,
  async resolveContext({
    principal,
    input,
  }: {
    principal: Principal
    input: AddWorkspaceFilesToKnowledgeBaseInput
  }): Promise<AddWorkspaceFilesContext> {
    const fileReferences = requireBoundedKnowledgeBatch(
      input.fileReferences,
      'files',
      ADD_WORKSPACE_FILES_COST_POLICY.maxItems
    )
    return {
      ...(await resolveActiveKnowledgeBaseContext(input, principal)),
      fileReferences,
    }
  },
  async execute({ principal, input, context }): Promise<AddWorkspaceFilesExecutionResult> {
    const prepared: PreparedWorkspaceFile[] = []
    const failed: string[] = []
    const canonicalFileIds = new Set<string>()

    for (const reference of context.fileReferences) {
      if (input.cancellationSignal?.aborted) break
      try {
        const candidate = await prepareWorkspaceFile(principal, context, reference)
        if (canonicalFileIds.has(candidate.file.id)) continue
        canonicalFileIds.add(candidate.file.id)
        prepared.push(candidate)
      } catch (error) {
        if (input.cancellationSignal?.aborted) break
        const classified = asOrchestrationError(error)
        if (classified && classified.code !== 'internal') {
          failed.push(reference)
          continue
        }
        throw error
      }
    }

    if (prepared.length === 0) {
      return {
        knowledgeBaseId: context.knowledgeBaseId,
        knowledgeBaseName: context.knowledgeBase.name,
        added: [],
        failed,
        cancelled: input.cancellationSignal?.aborted ?? false,
      }
    }

    if (input.cancellationSignal?.aborted) {
      return {
        knowledgeBaseId: context.knowledgeBaseId,
        knowledgeBaseName: context.knowledgeBase.name,
        added: [],
        failed,
        cancelled: true,
      }
    }

    const billingAttribution = await resolveKnowledgeBillingAttribution(principal, context)
    const usage = await checkAttributedUsageLimits(billingAttribution)
    if (usage.isExceeded) {
      throw new KnowledgeUsageLimitExceededError(
        usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.'
      )
    }
    const uploadedBy = resolveKnowledgeAttributedUserId(principal, context)
    const added: AddedWorkspaceFileDocument[] = []
    let terminalFailure: KnowledgeBatchExecutionResult['terminalFailure']

    for (const candidate of prepared) {
      if (input.cancellationSignal?.aborted) break
      try {
        const requestId = generateRequestId()
        const current = await prepareWorkspaceFile(principal, context, candidate.file.id, 'id')
        const readSignal = AbortSignal.timeout(SOURCE_READ_TIMEOUT_MS)
        const signal = input.cancellationSignal
          ? AbortSignal.any([readSignal, input.cancellationSignal])
          : readSignal
        const artifact = await fetchServableWorkspaceFileBuffer(current.file, {
          maxBytes: MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
          signal,
          requestId,
        })
        signal.throwIfAborted()
        if (artifact.buffer.byteLength === 0) {
          throw new OrchestrationError('validation', EMPTY_KNOWLEDGE_DOCUMENT_MESSAGE)
        }
        const contributors = artifact.contributingFiles ?? []
        if (contributors.length > PROVENANCE_MAX_ENTRIES) {
          throw new OrchestrationError(
            'validation',
            'Too many source files in the rendered document'
          )
        }
        for (const identity of contributors) {
          signal.throwIfAborted()
          await assertImportProvenance(context.workspaceId, identity)
        }
        const documentId = generateId()
        const storedFile = await uploadKnowledgeArtifact({
          documentId,
          key: generateKnowledgeBaseFileKey(current.file.name),
          owner: { workspaceId: context.workspaceId, userId: uploadedBy },
          artifact: {
            bytes: artifact.buffer,
            fileName: current.file.name,
            mimeType: artifact.contentType,
          },
          signal: input.cancellationSignal,
        })
        const registrationContext = await resolveActiveKnowledgeBaseContext(input, principal)
        await authorizeWorkspaceOperation(
          principal,
          knowledgeOperations.addWorkspaceFiles,
          registrationContext,
          { delegation: knowledgeDelegationPolicy }
        )
        const finalized = await prepareWorkspaceFile(principal, context, current.file.id, 'id')
        if (
          finalized.file.key !== current.file.key ||
          finalized.file.contentUpdatedAt?.getTime() !== current.file.contentUpdatedAt?.getTime()
        ) {
          throw new OrchestrationError('conflict', 'Workspace file changed during knowledge import')
        }
        input.cancellationSignal?.throwIfAborted()
        const document = await createSingleDocument(
          {
            filename: current.file.name,
            fileUrl: `${storedFile.path}?context=knowledge-base`,
            fileSize: artifact.buffer.byteLength,
            mimeType: artifact.contentType,
          },
          registrationContext.knowledgeBaseId,
          requestId,
          uploadedBy,
          documentId,
          {
            filename: { status: 'exact', entries: [] },
            content: { status: 'exact', entries: [] },
            tags: [],
          },
          {
            expectedWorkspaceId: registrationContext.workspaceId,
            uploadedArtifact: storedFile,
            processing: { processingOptions: {}, billingAttribution },
          }
        )
        added.push({
          documentId: document.id,
          filename: document.filename,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
        })
      } catch (error) {
        if (input.cancellationSignal?.aborted) break
        const classified = asOrchestrationError(error)
        if (classified && classified.code !== 'internal') {
          failed.push(candidate.reference)
          continue
        }
        terminalFailure = { error }
        break
      }
    }

    return {
      knowledgeBaseId: context.knowledgeBaseId,
      knowledgeBaseName: context.knowledgeBase.name,
      added,
      failed,
      cancelled: input.cancellationSignal?.aborted ?? false,
      ...(terminalFailure && { terminalFailure }),
    }
  },
  projectAudit: ({ input, context, result }) =>
    result.added.map((document) => ({
      action: AuditAction.DOCUMENT_UPLOADED,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: document.documentId,
      resourceName: document.filename,
      description: `Uploaded document "${document.filename}" to knowledge base "${context.knowledgeBase.name}"`,
      metadata: {
        source: input.source,
        knowledgeBaseId: context.knowledgeBaseId,
        knowledgeBaseName: context.knowledgeBase.name,
        fileName: document.filename,
        fileType: document.mimeType,
        fileSize: document.fileSize,
      },
    })),
  afterSuccess: ({ result }) => rethrowKnowledgeBatchTerminalFailure(result),
})
