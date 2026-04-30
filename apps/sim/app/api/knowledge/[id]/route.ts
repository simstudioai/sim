import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { updateKnowledgeBaseContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  deleteKnowledgeBase,
  getKnowledgeBaseById,
  KnowledgeBaseConflictError,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('KnowledgeBaseByIdAPI')

export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

    try {
      const auth = await checkSessionOrInternalAuth(_request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized knowledge base access attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const accessCheck = await checkKnowledgeBaseAccess(id, userId)

      if (!accessCheck.hasAccess) {
        if ('notFound' in accessCheck && accessCheck.notFound) {
          logger.warn(`[${requestId}] Knowledge base not found: ${id}`)
          return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted to access unauthorized knowledge base ${id}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const knowledgeBaseData = await getKnowledgeBaseById(id)

      if (!knowledgeBaseData) {
        return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
      }

      logger.info(`[${requestId}] Retrieved knowledge base: ${id} for user ${userId}`)

      return NextResponse.json({
        success: true,
        data: knowledgeBaseData,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error fetching knowledge base`, error)
      return NextResponse.json({ error: 'Failed to fetch knowledge base' }, { status: 500 })
    }
  }
)

export const PUT = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await context.params

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized knowledge base update attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const accessCheck = await checkKnowledgeBaseWriteAccess(id, userId)

      if (!accessCheck.hasAccess) {
        if ('notFound' in accessCheck && accessCheck.notFound) {
          logger.warn(`[${requestId}] Knowledge base not found: ${id}`)
          return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted to update unauthorized knowledge base ${id}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(updateKnowledgeBaseContract, req, context)
      if (!parsed.success) return parsed.response

      const validatedData = parsed.data.body

      const updatedKnowledgeBase = await updateKnowledgeBase(
        id,
        {
          name: validatedData.name,
          description: validatedData.description,
          workspaceId: validatedData.workspaceId,
          chunkingConfig: validatedData.chunkingConfig,
        },
        requestId
      )

      logger.info(`[${requestId}] Knowledge base updated: ${id} for user ${userId}`)

      recordAudit({
        workspaceId: accessCheck.knowledgeBase.workspaceId ?? null,
        actorId: userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.KNOWLEDGE_BASE_UPDATED,
        resourceType: AuditResourceType.KNOWLEDGE_BASE,
        resourceId: id,
        resourceName: validatedData.name ?? updatedKnowledgeBase.name,
        description: `Updated knowledge base "${validatedData.name ?? updatedKnowledgeBase.name}"`,
        metadata: {
          updatedFields: Object.keys(validatedData).filter(
            (k) => validatedData[k as keyof typeof validatedData] !== undefined
          ),
          ...(validatedData.name && { newName: validatedData.name }),
          ...(validatedData.description !== undefined && {
            description: validatedData.description,
          }),
          ...(validatedData.chunkingConfig && {
            chunkMaxSize: validatedData.chunkingConfig.maxSize,
            chunkMinSize: validatedData.chunkingConfig.minSize,
            chunkOverlap: validatedData.chunkingConfig.overlap,
          }),
        },
        request: req,
      })

      return NextResponse.json({
        success: true,
        data: updatedKnowledgeBase,
      })
    } catch (error) {
      if (error instanceof KnowledgeBaseConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }

      logger.error(`[${requestId}] Error updating knowledge base`, error)
      return NextResponse.json({ error: 'Failed to update knowledge base' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

    try {
      const auth = await checkSessionOrInternalAuth(_request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized knowledge base delete attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const accessCheck = await checkKnowledgeBaseWriteAccess(id, userId)

      if (!accessCheck.hasAccess) {
        if ('notFound' in accessCheck && accessCheck.notFound) {
          logger.warn(`[${requestId}] Knowledge base not found: ${id}`)
          return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted to delete unauthorized knowledge base ${id}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      await deleteKnowledgeBase(id, requestId)

      try {
        PlatformEvents.knowledgeBaseDeleted({
          knowledgeBaseId: id,
        })
      } catch {
        // Telemetry should not fail the operation
      }

      logger.info(`[${requestId}] Knowledge base deleted: ${id} for user ${userId}`)

      recordAudit({
        workspaceId: accessCheck.knowledgeBase.workspaceId ?? null,
        actorId: userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.KNOWLEDGE_BASE_DELETED,
        resourceType: AuditResourceType.KNOWLEDGE_BASE,
        resourceId: id,
        resourceName: accessCheck.knowledgeBase.name,
        description: `Deleted knowledge base "${accessCheck.knowledgeBase.name || id}"`,
        metadata: {
          knowledgeBaseName: accessCheck.knowledgeBase.name,
        },
        request: _request,
      })

      return NextResponse.json({
        success: true,
        data: { message: 'Knowledge base deleted successfully' },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting knowledge base`, error)
      return NextResponse.json({ error: 'Failed to delete knowledge base' }, { status: 500 })
    }
  }
)
