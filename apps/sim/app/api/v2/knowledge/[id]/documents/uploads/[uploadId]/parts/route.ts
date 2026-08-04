import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { v2CreateKnowledgeDocumentUploadPartUrlsContract } from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createUploadPartUrls } from '@/lib/uploads/multipart-session/service'
import { checkRateLimit } from '@/app/api/v1/middleware'
import {
  getOwnedKnowledgeDocumentUpload,
  resolveKnowledgeDocumentUploadAccess,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2KnowledgeDocumentUploadPartsAPI')

interface KnowledgeDocumentUploadRouteParams {
  params: Promise<{ id: string; uploadId: string }>
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: KnowledgeDocumentUploadRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'knowledge-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(
        v2CreateKnowledgeDocumentUploadPartUrlsContract,
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
      const parts = await createUploadPartUrls({
        session,
        partNumbers: parsed.data.body.partNumbers,
        localOrigin: request.nextUrl.origin,
      })
      return v2Data({ parts }, { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to create knowledge-document upload part URLs', {
        error: getErrorMessage(error),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
