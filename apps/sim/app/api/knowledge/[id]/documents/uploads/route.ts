import { type NextRequest, NextResponse } from 'next/server'
import { createKnowledgeDocumentUploadContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createUploadSession } from '@/lib/uploads/multipart-session/service'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { uploadSessionErrorResponse } from '@/app/api/files/uploads/utils'
import {
  requireKnowledgeDocumentUploadAccess,
  requireKnowledgeDocumentUploadActor,
  requireKnowledgeDocumentUploadBilling,
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
    const access = await requireKnowledgeDocumentUploadAccess({
      knowledgeBaseId,
      workspaceId,
      userId: actor.id,
    })
    if (access instanceof NextResponse) return access
    const billing = await requireKnowledgeDocumentUploadBilling({
      workspaceId,
      userId: actor.id,
    })
    if (billing instanceof NextResponse) return billing
    const fileTypeError = validateFileType(name, contentType)
    if (fileTypeError) {
      return NextResponse.json({ error: fileTypeError.message }, { status: 415 })
    }
    try {
      const upload = await createUploadSession({
        workspaceId,
        userId: actor.id,
        knowledgeBaseId,
        purpose: 'knowledge_document',
        fileName: name,
        contentType,
        fileSize: size,
        metadata,
      })
      return NextResponse.json({ data: toV2KnowledgeDocumentUpload(upload, null) }, { status: 201 })
    } catch (error) {
      const classified = uploadSessionErrorResponse(error)
      if (classified) return classified
      throw error
    }
  }
)
