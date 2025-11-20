import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { duplicateWorkflow } from '@/lib/workflows/duplicate'

const logger = createLogger('WorkflowDuplicateAPI')

const DuplicateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  color: z.string().optional(),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
})

// POST /api/workflows/[id]/duplicate - Duplicate a workflow with all its blocks, edges, and subflows
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceWorkflowId } = await params
  const requestId = generateRequestId()
  const startTime = Date.now()

  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized workflow duplication attempt for ${sourceWorkflowId}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, description, color, workspaceId, folderId } = DuplicateRequestSchema.parse(body)

    logger.info(
      `[${requestId}] Duplicating workflow ${sourceWorkflowId} for user ${session.user.id}`
    )

    const result = await duplicateWorkflow({
      sourceWorkflowId,
      userId: session.user.id,
      name,
      description,
      color,
      workspaceId,
      folderId,
      requestId,
    })

    const elapsed = Date.now() - startTime
    logger.info(
      `[${requestId}] Successfully duplicated workflow ${sourceWorkflowId} to ${result.id} in ${elapsed}ms`
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Source workflow not found') {
        logger.warn(`[${requestId}] Source workflow ${sourceWorkflowId} not found`)
        return NextResponse.json({ error: 'Source workflow not found' }, { status: 404 })
      }

      if (error.message === 'Source workflow not found or access denied') {
        logger.warn(
          `[${requestId}] User ${session.user.id} denied access to source workflow ${sourceWorkflowId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid duplication request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const elapsed = Date.now() - startTime
    logger.error(
      `[${requestId}] Error duplicating workflow ${sourceWorkflowId} after ${elapsed}ms:`,
      error
    )
    return NextResponse.json({ error: 'Failed to duplicate workflow' }, { status: 500 })
  }
}
