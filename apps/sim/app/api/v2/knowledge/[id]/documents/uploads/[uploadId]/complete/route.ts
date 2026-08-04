import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { v2CompleteKnowledgeDocumentUploadContract } from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeUploadSession } from '@/lib/uploads/upload-session/service'
import { checkRateLimit } from '@/app/api/v1/middleware'
import {
  finalizeKnowledgeDocumentUpload,
  getOwnedKnowledgeDocumentUpload,
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

      const session = getOwnedKnowledgeDocumentUpload({
        knowledgeBaseId,
        uploadId,
        workspaceId,
        userId,
        uploadToken: parsed.data.headers['upload-token'],
      })
      const result = await completeUploadSession({
        session,
        completion: parsed.data.body,
        finalize: (claimed) =>
          finalizeKnowledgeDocumentUpload({
            claimed,
            knowledgeBaseId,
            knowledgeBaseName: access.kb.name,
            workspaceId,
            userId,
            resolveAttribution: () =>
              resolveKnowledgeDocumentUploadAttribution({ workspaceId, userId, rateLimit }),
            source: 'api',
            requestId,
            request,
          }),
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
