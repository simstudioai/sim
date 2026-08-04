import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { v2CompleteKnowledgeDocumentUploadContract } from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performUploadKnowledgeDocument } from '@/lib/knowledge/orchestration'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import {
  completeUploadSession,
  type UploadSessionRecord,
} from '@/lib/uploads/multipart-session/service'
import { deleteFileMetadata, recordKnowledgeBaseFileOwnership } from '@/lib/uploads/server/metadata'
import { checkRateLimit } from '@/app/api/v1/middleware'
import {
  getOwnedKnowledgeDocumentUpload,
  knowledgeDocumentFileUrl,
  resolveKnowledgeDocumentUploadAccess,
  resolveKnowledgeDocumentUploadAttribution,
  toV2KnowledgeDocumentUpload,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2CompleteKnowledgeDocumentUploadAPI')

interface KnowledgeDocumentUploadRouteParams {
  params: Promise<{ id: string; uploadId: string }>
}

async function cleanupFailedKnowledgeDocumentUpload(session: UploadSessionRecord): Promise<void> {
  await deleteFile({ key: session.storageKey, context: 'knowledge-base' })
  await deleteFileMetadata(session.storageKey)
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: KnowledgeDocumentUploadRouteParams) => {
    const requestId = generateRequestId()

    try {
      const rateLimit = await checkRateLimit(request, 'knowledge-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(
        v2CompleteKnowledgeDocumentUploadContract,
        request,
        context,
        { validationErrorResponse: v2ValidationError }
      )
      if (!parsed.success) return parsed.response
      const { id: knowledgeBaseId, uploadId } = parsed.data.params
      const { workspaceId } = parsed.data.query

      const access = await resolveKnowledgeDocumentUploadAccess({
        knowledgeBaseId,
        workspaceId,
        userId,
        rateLimit,
      })
      if (access instanceof NextResponse) return access

      const billingAttribution = await resolveKnowledgeDocumentUploadAttribution({
        workspaceId,
        userId,
        rateLimit,
      })

      const session = getOwnedKnowledgeDocumentUpload({
        knowledgeBaseId,
        uploadId,
        workspaceId,
        userId,
        uploadToken: parsed.data.headers['upload-token'],
      })
      const result = await completeUploadSession({
        session,
        parts: parsed.data.body.parts,
        finalize: async (claimed) => {
          try {
            await recordKnowledgeBaseFileOwnership({
              key: claimed.storageKey,
              userId,
              workspaceId,
              originalName: claimed.fileName,
              contentType: claimed.contentType,
              size: claimed.fileSize,
            })
            const outcome = await performUploadKnowledgeDocument({
              knowledgeBase: {
                id: knowledgeBaseId,
                name: access.kb.name,
                workspaceId,
              },
              document: {
                filename: claimed.fileName,
                fileUrl: knowledgeDocumentFileUrl(claimed),
                fileSize: claimed.fileSize,
                mimeType: claimed.contentType,
              },
              documentId: claimed.id,
              startProcessing: 'queue',
              billingAttribution,
              uploadedBy: billingAttribution.actorUserId,
              userId,
              source: 'api',
              requestId,
              request,
            })
            if (!outcome.success) {
              throw new OrchestrationError(outcome.errorCode, outcome.error)
            }
            return {
              value: outcome.document,
              completedFileId: outcome.document.id,
            }
          } catch (error) {
            await cleanupFailedKnowledgeDocumentUpload(claimed)
            throw error
          }
        },
      })

      return v2Data(toV2KnowledgeDocumentUpload(result.session, result.value), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error(`[${requestId}] Failed to complete knowledge-document upload`, {
        error: getErrorMessage(error),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
