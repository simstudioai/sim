import { NextResponse } from 'next/server'
import { v2CreateKnowledgeDocumentUploadContract } from '@/lib/api/contracts/v2/knowledge'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import {
  createKnowledgeDocumentUploadSession,
  resolveKnowledgeDocumentUploadAccess,
  resolveKnowledgeDocumentUploadBilling,
  toV2KnowledgeDocumentUpload,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'
import { v2CaughtOrchestrationError, v2Data, v2Error } from '@/app/api/v2/lib/response'

export const POST = withPublicApiRouteHandler({
  contract: v2CreateKnowledgeDocumentUploadContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    try {
      const { id: knowledgeBaseId } = input.params
      const { workspaceId, name, contentType, size, ...metadata } = input.body

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

      const session = await createKnowledgeDocumentUploadSession({
        workspaceId,
        userId,
        knowledgeBaseId,
        fileName: name,
        contentType,
        fileSize: size,
        metadata,
        localOrigin: request.nextUrl.origin,
      })
      return v2Data(
        {
          session: toV2KnowledgeDocumentUpload(session, null),
          uploadToken: session.uploadToken,
          transfer: session.transfer,
        },
        { rateLimit, status: 201 }
      )
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
