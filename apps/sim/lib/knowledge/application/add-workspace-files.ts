import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { checkAttributedUsageLimits } from '@/lib/billing/core/billing-attribution'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { reportDurableSecretProvenanceRefusal } from '@/lib/execution/durable-secret-provenance-enforcement'
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
import { dispatchDocumentProcessing } from '@/lib/knowledge/documents/processing-dispatch'
import { createSingleDocument, type DocumentData } from '@/lib/knowledge/documents/service'
import { StorageService } from '@/lib/uploads'
import {
  loadActiveWorkspaceFileContext,
  resolveWorkspaceFileReference,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getBoundWorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  EMPTY_KNOWLEDGE_DOCUMENT_MESSAGE,
  MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE,
} from '@/lib/uploads/shared/types'
import { validateFileType } from '@/lib/uploads/utils/validation'

const logger = createLogger('AddWorkspaceFilesToKnowledgeBase')

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
  fileUrl: string
}

async function prepareWorkspaceFile(
  principal: Principal,
  context: AddWorkspaceFilesContext,
  reference: string
): Promise<PreparedWorkspaceFile> {
  const file = await resolveWorkspaceFileReference(context.workspaceId, reference)
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

  const provenance = await getBoundWorkspaceFileSecretProvenance(context.workspaceId, {
    fileId: file.id,
    key: file.key,
    context: 'workspace',
  })
  if (provenance.status !== 'exact' || provenance.entries.length > 0) {
    reportDurableSecretProvenanceRefusal({
      surface: 'knowledge',
      cause: 'knowledge-workspace-file-source-unavailable',
      workspaceId: context.workspaceId,
      resourceId: file.id,
    })
    throw new OrchestrationError(
      'validation',
      'Workspace file secret provenance prevents knowledge ingestion'
    )
  }

  return {
    reference,
    file,
    fileUrl: await StorageService.generatePresignedDownloadUrl(file.key, 'workspace', 5 * 60),
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
        const document = await createSingleDocument(
          {
            filename: candidate.file.name,
            fileUrl: candidate.fileUrl,
            fileSize: candidate.file.size,
            mimeType: candidate.file.type,
          },
          context.knowledgeBaseId,
          requestId,
          uploadedBy,
          undefined,
          undefined,
          { expectedWorkspaceId: context.workspaceId }
        )
        const processingDocument: DocumentData = {
          documentId: document.id,
          filename: document.filename,
          fileUrl: document.fileUrl,
          fileSize: document.fileSize,
          mimeType: document.mimeType,
        }
        void dispatchDocumentProcessing({
          documents: [processingDocument],
          knowledgeBaseId: context.knowledgeBaseId,
          processingOptions: {},
          requestId,
          billingAttribution,
        })
        added.push({
          documentId: document.id,
          filename: document.filename,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
        })
      } catch (error) {
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
