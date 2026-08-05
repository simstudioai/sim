import { type NextRequest, NextResponse } from 'next/server'
import { createKnowledgeDocumentUploadPartUrlsContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createUploadPartUrls } from '@/lib/uploads/upload-session/service'
import { uploadSessionErrorResponse } from '@/app/api/files/uploads/utils'
import {
  requireKnowledgeDocumentUploadAccess,
  requireKnowledgeDocumentUploadActor,
} from '@/app/api/knowledge/[id]/documents/uploads/utils'
import { getOwnedKnowledgeDocumentUpload } from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

interface KnowledgeDocumentUploadRouteParams {
  params: Promise<{ id: string; uploadId: string }>
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: KnowledgeDocumentUploadRouteParams) => {
    const actor = await requireKnowledgeDocumentUploadActor()
    if (actor instanceof NextResponse) return actor
    const parsed = await parseRequest(
      createKnowledgeDocumentUploadPartUrlsContract,
      request,
      context
    )
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
      const upload = await getOwnedKnowledgeDocumentUpload({
        knowledgeBaseId,
        uploadId,
        workspaceId,
        userId: actor.id,
        uploadToken: parsed.data.headers['upload-token'],
      })
      const parts = await createUploadPartUrls({
        session: upload,
        partNumbers: parsed.data.body.partNumbers,
        localOrigin: request.nextUrl.origin,
      })
      return NextResponse.json({ data: { parts } })
    } catch (error) {
      const classified = uploadSessionErrorResponse(error)
      if (classified) return classified
      throw error
    }
  }
)
