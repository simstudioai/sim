import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { v2CreateKnowledgeDocumentUploadContract } from '@/lib/api/contracts/v2/knowledge'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createUploadSession } from '@/lib/uploads/multipart-session/service'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { checkRateLimit } from '@/app/api/v1/middleware'
import {
  resolveKnowledgeDocumentUploadAccess,
  resolveKnowledgeDocumentUploadBilling,
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

const logger = createLogger('V2KnowledgeDocumentUploadsAPI')

interface KnowledgeDocumentUploadsRouteParams {
  params: Promise<{ id: string }>
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: KnowledgeDocumentUploadsRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'knowledge-detail')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate

      const parsed = await parseRequest(v2CreateKnowledgeDocumentUploadContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const { id: knowledgeBaseId } = parsed.data.params
      const { workspaceId, name, contentType, size, ...metadata } = parsed.data.body

      const access = await resolveKnowledgeDocumentUploadAccess({
        knowledgeBaseId,
        workspaceId,
        userId,
        rateLimit,
      })
      if (access instanceof NextResponse) return access

      const billing = await resolveKnowledgeDocumentUploadBilling({
        workspaceId,
        userId,
        rateLimit,
      })
      if (billing instanceof NextResponse) return billing

      const fileTypeError = validateFileType(name, contentType)
      if (fileTypeError) {
        return v2Error('UNSUPPORTED_MEDIA_TYPE', fileTypeError.message)
      }

      const session = await createUploadSession({
        workspaceId,
        userId,
        knowledgeBaseId,
        purpose: 'knowledge_document',
        fileName: name,
        contentType,
        fileSize: size,
        metadata,
      })
      return v2Data(toV2KnowledgeDocumentUpload(session, null), { rateLimit, status: 201 })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to create knowledge-document upload session', {
        error: getErrorMessage(error),
      })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
