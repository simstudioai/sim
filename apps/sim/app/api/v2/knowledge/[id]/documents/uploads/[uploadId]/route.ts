import { NextResponse } from 'next/server'
import { v2AbortKnowledgeDocumentUploadContract } from '@/lib/api/contracts/v2/knowledge'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import {
  abortKnowledgeDocumentUpload,
  getOwnedKnowledgeDocumentUpload,
  resolveKnowledgeDocumentUploadAccess,
  toV2KnowledgeDocumentUpload,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'
import { v2CaughtOrchestrationError, v2Data } from '@/app/api/v2/lib/response'

export const DELETE = withPublicApiRouteHandler({
  contract: v2AbortKnowledgeDocumentUploadContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
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
      const aborted = await abortKnowledgeDocumentUpload(session, knowledgeBaseId)
      return v2Data(toV2KnowledgeDocumentUpload(aborted, null), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
