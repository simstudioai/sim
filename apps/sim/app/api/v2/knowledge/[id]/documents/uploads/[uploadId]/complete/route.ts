import { NextResponse } from 'next/server'
import { v2CompleteKnowledgeDocumentUploadContract } from '@/lib/api/contracts/v2/knowledge'
import { completeUploadSession } from '@/lib/uploads/upload-session/service'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import {
  finalizeKnowledgeDocumentUpload,
  getOwnedKnowledgeDocumentUpload,
  resolveKnowledgeDocumentUploadAccess,
  resolveKnowledgeDocumentUploadAttribution,
  toV2KnowledgeDocumentUpload,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'
import { v2CaughtOrchestrationError, v2Data } from '@/app/api/v2/lib/response'

export const POST = withPublicApiRouteHandler({
  contract: v2CompleteKnowledgeDocumentUploadContract,
  rateLimitEndpoint: 'knowledge-detail',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
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
        userId: rateLimit.principalUserId ?? userId,
        uploadToken: input.headers['upload-token'],
      })
      const result = await completeUploadSession({
        session,
        finalize: (claimed) =>
          finalizeKnowledgeDocumentUpload({
            claimed,
            knowledgeBaseId,
            knowledgeBaseName: access.kb.name,
            workspaceId,
            userId,
            resolveAttribution: () =>
              resolveKnowledgeDocumentUploadAttribution({ session: claimed }),
            source: 'api',
            requestId,
            request,
          }),
      })

      return v2Data(toV2KnowledgeDocumentUpload(result.session, result.value), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
  },
})
