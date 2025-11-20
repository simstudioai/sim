import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { duplicateWorkspace } from '@/lib/workspaces/duplicate'

const logger = createLogger('WorkspaceDuplicateAPI')

const DuplicateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
})

// POST /api/workspaces/[id]/duplicate - Duplicate a workspace with all its workflows
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceWorkspaceId } = await params
  const requestId = generateRequestId()
  const startTime = Date.now()

  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(
      `[${requestId}] Unauthorized workspace duplication attempt for ${sourceWorkspaceId}`
    )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name } = DuplicateRequestSchema.parse(body)

    logger.info(
      `[${requestId}] Duplicating workspace ${sourceWorkspaceId} for user ${session.user.id}`
    )

    const result = await duplicateWorkspace({
      sourceWorkspaceId,
      userId: session.user.id,
      name,
      requestId,
    })

    const elapsed = Date.now() - startTime
    logger.info(
      `[${requestId}] Successfully duplicated workspace ${sourceWorkspaceId} to ${result.id} in ${elapsed}ms`
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Source workspace not found') {
        logger.warn(`[${requestId}] Source workspace ${sourceWorkspaceId} not found`)
        return NextResponse.json({ error: 'Source workspace not found' }, { status: 404 })
      }

      if (error.message === 'Source workspace not found or access denied') {
        logger.warn(
          `[${requestId}] User ${session.user.id} denied access to source workspace ${sourceWorkspaceId}`
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
      `[${requestId}] Error duplicating workspace ${sourceWorkspaceId} after ${elapsed}ms:`,
      error
    )
    return NextResponse.json({ error: 'Failed to duplicate workspace' }, { status: 500 })
  }
}
