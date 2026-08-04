import { type NextRequest, NextResponse } from 'next/server'
import { abortKnowledgeDocumentUploadContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { uploadSessionErrorResponse } from '@/app/api/files/uploads/utils'
import {
  requireKnowledgeDocumentUploadAccess,
  requireKnowledgeDocumentUploadActor,
} from '@/app/api/knowledge/[id]/documents/uploads/utils'
import {
  abortKnowledgeDocumentUpload,
  getOwnedKnowledgeDocumentUpload,
  toV2KnowledgeDocumentUpload,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

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
    const access = await requireKnowledgeDocumentUploadAccess({
      knowledgeBaseId,
      workspaceId,
      userId: actor.id,
    })
    if (access instanceof NextResponse) return access
    try {
      const upload = getOwnedKnowledgeDocumentUpload({
        knowledgeBaseId,
        uploadId,
        workspaceId,
        userId: actor.id,
        uploadToken: parsed.data.headers['upload-token'],
      })
      const aborted = await abortKnowledgeDocumentUpload(upload, knowledgeBaseId)
      return NextResponse.json({ data: toV2KnowledgeDocumentUpload(aborted, null) })
    } catch (error) {
      const classified = uploadSessionErrorResponse(error)
      if (classified) return classified
      throw error
    }
  }
)
