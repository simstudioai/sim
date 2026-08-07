import { NextResponse } from 'next/server'
import { v2CreateKnowledgeDocumentUploadPartUrlsContract } from '@/lib/api/contracts/v2/knowledge'
import { createUploadPartUrls } from '@/lib/uploads/upload-session/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import {
  getOwnedKnowledgeDocumentUpload,
  resolveKnowledgeDocumentUploadAccess,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'
import { v2CaughtOrchestrationError, v2Data } from '@/app/api/v2/lib/response'

export const POST = withPublicApiRouteHandler({
  contract: v2CreateKnowledgeDocumentUploadPartUrlsContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    try {
      const { id: knowledgeBaseId, uploadId } = input.params
      const { workspaceId } = input.query

      const access = await resolveKnowledgeDocumentUploadAccess({
        knowledgeBaseId,
        workspaceId,
        userId,
        rateLimit,
      })
      if (access instanceof NextResponse) return access

      const session = await getOwnedKnowledgeDocumentUpload({
        knowledgeBaseId,
        uploadId,
        workspaceId,
        userId,
        uploadToken: input.headers['upload-token'],
      })
      const parts = await createUploadPartUrls({
        session,
        partNumbers: input.body.partNumbers,
        localOrigin: request.nextUrl.origin,
      })
      return v2Data({ parts }, { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
