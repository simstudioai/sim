import { type NextRequest, NextResponse } from 'next/server'
import { abortKnowledgeDocumentUploadContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { cancelKnowledgeDocumentUpload } from '@/lib/knowledge/application/upload-sessions'
import {
  knowledgeDocumentUploadErrorResponse,
  requireKnowledgeDocumentUploadActor,
} from '@/app/api/knowledge/[id]/documents/uploads/utils'
import { toV2KnowledgeDocumentUpload } from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

interface KnowledgeDocumentUploadRouteParams {
  params: Promise<{ id: string; uploadId: string }>
}

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: KnowledgeDocumentUploadRouteParams) => {
    const actor = await requireKnowledgeDocumentUploadActor()
    if (actor instanceof NextResponse) return actor
    const parsed = await parseRequest(abortKnowledgeDocumentUploadContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: knowledgeBaseId, uploadId } = parsed.data.params
    const { workspaceId } = parsed.data.query
    try {
      const aborted = await cancelKnowledgeDocumentUpload.execute({
        principal: { kind: 'session', userId: actor.id, sessionId: actor.sessionId },
        input: {
          knowledgeBaseId,
          assertedWorkspaceId: workspaceId,
          uploadId,
          uploadToken: parsed.data.headers['upload-token'],
        },
        request,
      })
      return NextResponse.json({ data: toV2KnowledgeDocumentUpload(aborted, null) })
    } catch (error) {
      const classified = knowledgeDocumentUploadErrorResponse(error)
      if (classified) return classified
      throw error
    }
  }
)
