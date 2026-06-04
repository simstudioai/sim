import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type NextRequest, NextResponse } from 'next/server'
import {
  v1DeleteKnowledgeBaseContract,
  v1GetKnowledgeBaseContract,
  v1UpdateKnowledgeBaseContract,
} from '@/lib/api/contracts/v1/knowledge'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { deleteKnowledgeBase, updateKnowledgeBase } from '@/lib/knowledge/service'
import {
  formatKnowledgeBase,
  handleError,
  resolveKnowledgeBase,
} from '@/app/api/v1/knowledge/utils'
import { authenticateRequest } from '@/app/api/v1/middleware'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface KnowledgeRouteParams {
  params: Promise<{ id: string }>
}

/** GET /api/v1/knowledge/[id] — Get knowledge base details. */
export const GET = withRouteHandler(async (request: NextRequest, context: KnowledgeRouteParams) => {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const parsed = await parseRequest(v1GetKnowledgeBaseContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const result = await resolveKnowledgeBase(id, parsed.data.query.workspaceId, userId, rateLimit)
    if (result instanceof NextResponse) return result

    return NextResponse.json({
      success: true,
      data: {
        knowledgeBase: formatKnowledgeBase(result.kb),
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to get knowledge base')
  }
})

/** PUT /api/v1/knowledge/[id] — Update a knowledge base. */
export const PUT = withRouteHandler(async (request: NextRequest, context: KnowledgeRouteParams) => {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const parsed = await parseRequest(v1UpdateKnowledgeBaseContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, name, description, chunkingConfig } = parsed.data.body

    const result = await resolveKnowledgeBase(id, workspaceId, userId, rateLimit, 'write')
    if (result instanceof NextResponse) return result

    const updates: {
      name?: string
      description?: string
      chunkingConfig?: { maxSize: number; minSize: number; overlap: number }
    } = {}
    if (name !== undefined) updates.name = name
    if (description !== undefined) updates.description = description
    if (chunkingConfig !== undefined) updates.chunkingConfig = chunkingConfig

    const updatedKb = await updateKnowledgeBase(id, updates, requestId)

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.KNOWLEDGE_BASE_UPDATED,
      resourceType: AuditResourceType.KNOWLEDGE_BASE,
      resourceId: id,
      resourceName: updatedKb.name,
      description: `Updated knowledge base "${updatedKb.name}" via API`,
      metadata: { updatedFields: Object.keys(updates) },
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        knowledgeBase: formatKnowledgeBase(updatedKb),
        message: 'Knowledge base updated successfully',
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to update knowledge base')
  }
})

/** DELETE /api/v1/knowledge/[id] — Delete a knowledge base. */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: KnowledgeRouteParams) => {
    const auth = await authenticateRequest(request, 'knowledge-detail')
    if (auth instanceof NextResponse) return auth
    const { requestId, userId, rateLimit } = auth

    try {
      const parsed = await parseRequest(v1DeleteKnowledgeBaseContract, request, context)
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const result = await resolveKnowledgeBase(
        id,
        parsed.data.query.workspaceId,
        userId,
        rateLimit,
        'write'
      )
      if (result instanceof NextResponse) return result

      await deleteKnowledgeBase(id, requestId)

      recordAudit({
        workspaceId: parsed.data.query.workspaceId,
        actorId: userId,
        action: AuditAction.KNOWLEDGE_BASE_DELETED,
        resourceType: AuditResourceType.KNOWLEDGE_BASE,
        resourceId: id,
        resourceName: result.kb.name,
        description: `Deleted knowledge base "${result.kb.name}" via API`,
        request,
      })

      return NextResponse.json({
        success: true,
        data: {
          message: 'Knowledge base deleted successfully',
        },
      })
    } catch (error) {
      return handleError(requestId, error, 'Failed to delete knowledge base')
    }
  }
)
