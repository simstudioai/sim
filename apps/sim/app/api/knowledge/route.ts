import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createKnowledgeBaseContract,
  listKnowledgeBasesQuerySchema,
} from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performCreateKnowledgeBase } from '@/lib/knowledge/orchestration'
import { getKnowledgeBases, type KnowledgeBaseScope } from '@/lib/knowledge/service'

const logger = createLogger('KnowledgeBaseAPI')

export const GET = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized knowledge base access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const query = listKnowledgeBasesQuerySchema.safeParse({
      workspaceId: searchParams.get('workspaceId') ?? undefined,
      scope: searchParams.get('scope') ?? undefined,
    })
    if (!query.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: query.error.issues },
        { status: 400 }
      )
    }
    const { workspaceId, scope } = query.data

    const knowledgeBasesWithCounts = await getKnowledgeBases(
      session.user.id,
      workspaceId,
      scope as KnowledgeBaseScope
    )

    return NextResponse.json({
      success: true,
      data: knowledgeBasesWithCounts,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching knowledge bases`, error)
    return NextResponse.json({ error: 'Failed to fetch knowledge bases' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized knowledge base creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(
    createKnowledgeBaseContract,
    req,
    {},
    {
      validationErrorResponse: (error) => {
        logger.warn(`[${requestId}] Invalid knowledge base data`, { errors: error.issues })
        return NextResponse.json(
          { error: 'Invalid request data', details: error.issues },
          { status: 400 }
        )
      },
    }
  )
  if (!parsed.success) return parsed.response

  const body = parsed.data.body

  const outcome = await performCreateKnowledgeBase({
    userId: session.user.id,
    actorName: session.user.name,
    actorEmail: session.user.email,
    source: 'ui',
    workspaceId: body.workspaceId,
    name: body.name,
    description: body.description,
    folderId: body.folderId,
    chunkingConfig: body.chunkingConfig,
    requestId,
    request: req,
  })
  if (!outcome.success) {
    return NextResponse.json(
      { error: messageForOrchestrationError(outcome, 'Failed to create knowledge base') },
      { status: statusForOrchestrationError(outcome.errorCode) }
    )
  }

  return NextResponse.json({ success: true, data: outcome.knowledgeBase })
})
