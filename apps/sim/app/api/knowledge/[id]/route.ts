import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { updateKnowledgeBaseContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  performDeleteKnowledgeBase,
  performUpdateKnowledgeBase,
} from '@/lib/knowledge/orchestration'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
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

    const body = parsed.data.body

    const outcome = await performUpdateKnowledgeBase({
      knowledgeBaseId: id,
      workspaceId: accessCheck.knowledgeBase.workspaceId ?? null,
      userId,
      actorName: auth.userName,
      actorEmail: auth.userEmail,
      source: 'ui',
      updates: {
        name: body.name,
        description: body.description,
        workspaceId: body.workspaceId,
        folderId: body.folderId,
        chunkingConfig: body.chunkingConfig,
      },
      requestId,
      request: req,
    })
    if (!outcome.success) {
      return NextResponse.json(
        { error: messageForOrchestrationError(outcome, 'Failed to update knowledge base') },
        { status: statusForOrchestrationError(outcome.errorCode) }
      )
    }

    return NextResponse.json({ success: true, data: outcome.knowledgeBase })
  }
)

export const DELETE = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await params

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

    const outcome = await performDeleteKnowledgeBase({
      knowledgeBase: {
        id,
        name: accessCheck.knowledgeBase.name,
        workspaceId: accessCheck.knowledgeBase.workspaceId ?? null,
      },
      userId,
      actorName: auth.userName,
      actorEmail: auth.userEmail,
      source: 'ui',
      requestId,
      request: _request,
    })
    if (!outcome.success) {
      return NextResponse.json(
        { error: messageForOrchestrationError(outcome, 'Failed to delete knowledge base') },
        { status: statusForOrchestrationError(outcome.errorCode) }
      )
    }

    return NextResponse.json({
      success: true,
      data: { message: 'Knowledge base deleted successfully' },
    })
  }
)
