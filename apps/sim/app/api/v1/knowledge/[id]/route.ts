import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { deleteKnowledgeBase, updateKnowledgeBase } from '@/lib/knowledge/service'
import {
  authenticateRequest,
  formatKnowledgeBase,
  handleError,
  parseJsonBody,
  resolveKnowledgeBase,
  validateSchema,
} from '@/app/api/v1/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface KnowledgeRouteParams {
  params: Promise<{ id: string }>
}

const WorkspaceIdSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
})

const UpdateKBSchema = z
  .object({
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    name: z.string().min(1).max(255, 'Name must be 255 characters or less').optional(),
    description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
    chunkingConfig: z
      .object({
        maxSize: z.number().min(100).max(4000),
        minSize: z.number().min(1).max(2000),
        overlap: z.number().min(0).max(500),
      })
      .optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.chunkingConfig !== undefined,
    { message: 'At least one of name, description, or chunkingConfig must be provided' }
  )

/** GET /api/v1/knowledge/[id] — Get knowledge base details. */
export async function GET(request: NextRequest, { params }: KnowledgeRouteParams) {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)

    const validation = validateSchema(WorkspaceIdSchema, {
      workspaceId: searchParams.get('workspaceId'),
    })
    if (!validation.success) return validation.response

    const result = await resolveKnowledgeBase(id, validation.data.workspaceId, userId, rateLimit)
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
}

/** PUT /api/v1/knowledge/[id] — Update a knowledge base. */
export async function PUT(request: NextRequest, { params }: KnowledgeRouteParams) {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const { id } = await params

    const body = await parseJsonBody(request)
    if (!body.success) return body.response

    const validation = validateSchema(UpdateKBSchema, body.data)
    if (!validation.success) return validation.response

    const { workspaceId, name, description, chunkingConfig } = validation.data

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
}

/** DELETE /api/v1/knowledge/[id] — Delete a knowledge base. */
export async function DELETE(request: NextRequest, { params }: KnowledgeRouteParams) {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)

    const validation = validateSchema(WorkspaceIdSchema, {
      workspaceId: searchParams.get('workspaceId'),
    })
    if (!validation.success) return validation.response

    const result = await resolveKnowledgeBase(
      id,
      validation.data.workspaceId,
      userId,
      rateLimit,
      'write'
    )
    if (result instanceof NextResponse) return result

    await deleteKnowledgeBase(id, requestId)

    recordAudit({
      workspaceId: validation.data.workspaceId,
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
