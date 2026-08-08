import { type NextRequest, NextResponse } from 'next/server'
import { createKnowledgeDocumentUploadContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createKnowledgeDocumentUpload } from '@/lib/knowledge/application/upload-sessions'
import {
  knowledgeDocumentUploadErrorResponse,
  requireKnowledgeDocumentUploadActor,
} from '@/app/api/knowledge/[id]/documents/uploads/utils'
import { toV2KnowledgeDocumentUpload } from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

interface KnowledgeDocumentUploadsRouteParams {
  params: Promise<{ id: string }>
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: KnowledgeDocumentUploadsRouteParams) => {
    const actor = await requireKnowledgeDocumentUploadActor()
    if (actor instanceof NextResponse) return actor
    const parsed = await parseRequest(createKnowledgeDocumentUploadContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: knowledgeBaseId } = parsed.data.params
    const { workspaceId, name, contentType, size, ...metadata } = parsed.data.body
    try {
      const upload = await createKnowledgeDocumentUpload.execute({
        principal: { kind: 'session', userId: actor.id, sessionId: actor.sessionId },
        input: {
          knowledgeBaseId,
          assertedWorkspaceId: workspaceId,
          name,
          contentType,
          size,
          metadata,
        },
        request,
      })
      return NextResponse.json(
        {
          data: {
            session: toV2KnowledgeDocumentUpload(upload, null),
            uploadToken: upload.uploadToken,
            transfer: upload.transfer,
          },
        },
        { status: 201 }
      )
    } catch (error) {
      const classified = knowledgeDocumentUploadErrorResponse(error)
      if (classified) return classified
      throw error
    }
  }
)
