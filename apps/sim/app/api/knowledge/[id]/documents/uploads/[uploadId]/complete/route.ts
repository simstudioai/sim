import { type NextRequest, NextResponse } from 'next/server'
import { completeKnowledgeDocumentUploadContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeUploadSession } from '@/lib/uploads/upload-session/service'
import { uploadSessionErrorResponse } from '@/app/api/files/uploads/utils'
import {
  requireKnowledgeDocumentUploadAccess,
  requireKnowledgeDocumentUploadActor,
  resolveKnowledgeDocumentUploadAttribution,
} from '@/app/api/knowledge/[id]/documents/uploads/utils'
import {
  finalizeKnowledgeDocumentUpload,
  getOwnedKnowledgeDocumentUpload,
  toV2KnowledgeDocumentUpload,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

interface KnowledgeDocumentUploadRouteParams {
  params: Promise<{ id: string; uploadId: string }>
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: KnowledgeDocumentUploadRouteParams) => {
    const actor = await requireKnowledgeDocumentUploadActor()
    if (actor instanceof NextResponse) return actor
    const parsed = await parseRequest(completeKnowledgeDocumentUploadContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: knowledgeBaseId, uploadId } = parsed.data.params
    const { workspaceId } = parsed.data.query
    const access = await requireKnowledgeDocumentUploadAccess({
      knowledgeBaseId,
      workspaceId,
      userId: actor.id,
    })
    if (access instanceof NextResponse) return access
    const requestId = generateRequestId()
    try {
      const upload = await getOwnedKnowledgeDocumentUpload({
        knowledgeBaseId,
        uploadId,
        workspaceId,
        userId: actor.id,
        uploadToken: parsed.data.headers['upload-token'],
      })
      const completed = await completeUploadSession({
        session: upload,
        finalize: (claimed) =>
          finalizeKnowledgeDocumentUpload({
            claimed,
            knowledgeBaseId,
            knowledgeBaseName: access.knowledgeBase.name,
            workspaceId,
            userId: actor.id,
            resolveAttribution: () =>
              resolveKnowledgeDocumentUploadAttribution({ workspaceId, userId: actor.id }),
            source: 'ui',
            requestId,
            request,
            actorName: actor.name,
            actorEmail: actor.email,
          }),
      })
      return NextResponse.json({
        data: toV2KnowledgeDocumentUpload(completed.session, completed.value),
      })
    } catch (error) {
      const classified = uploadSessionErrorResponse(error)
      if (classified) return classified
      throw error
    }
  }
)
