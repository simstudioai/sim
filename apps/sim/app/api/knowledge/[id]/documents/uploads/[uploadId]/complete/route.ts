import { type NextRequest, NextResponse } from 'next/server'
import { completeKnowledgeDocumentUploadContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { PlatformEvents } from '@/lib/core/telemetry'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeKnowledgeDocumentUpload } from '@/lib/knowledge/application/upload-sessions'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  knowledgeDocumentUploadErrorResponse,
  requireKnowledgeDocumentUploadActor,
} from '@/app/api/knowledge/[id]/documents/uploads/utils'
import { toV2KnowledgeDocumentUpload } from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

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
    try {
      const completed = await completeKnowledgeDocumentUpload.execute({
        principal: { kind: 'session', userId: actor.id, sessionId: actor.sessionId },
        input: {
          knowledgeBaseId,
          assertedWorkspaceId: workspaceId,
          uploadId,
          uploadToken: parsed.data.headers['upload-token'],
          source: 'ui',
        },
        request,
      })
      if (completed.value.created) {
        captureServerEvent(
          actor.id,
          'knowledge_base_document_uploaded',
          {
            knowledge_base_id: completed.knowledgeBaseId,
            workspace_id: completed.workspaceId,
            document_count: 1,
            upload_type: 'single',
          },
          {
            groups: { workspace: completed.workspaceId },
            setOnce: { first_document_uploaded_at: new Date().toISOString() },
          }
        )
        PlatformEvents.knowledgeBaseDocumentsUploaded({
          knowledgeBaseId: completed.knowledgeBaseId,
          documentsCount: 1,
          uploadType: 'single',
          mimeType: completed.value.document.mimeType,
          fileSize: completed.value.document.fileSize,
        })
      }
      return NextResponse.json({
        data: toV2KnowledgeDocumentUpload(completed.session, completed.value.document),
      })
    } catch (error) {
      const classified = knowledgeDocumentUploadErrorResponse(error)
      if (classified) return classified
      throw error
    }
  }
)
