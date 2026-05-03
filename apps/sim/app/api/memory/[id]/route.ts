import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  agentMemoryDataSchemaContract,
  deleteMemoryByIdContract,
  getMemoryByIdContract,
  updateMemoryByIdContract,
} from '@/lib/api/contracts/memory'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MemoryByIdAPI')

interface MemoryRouteContext {
  params: Promise<{ id: string }>
}

function memoryEnvelopeError(message: string, status: number) {
  return NextResponse.json({ success: false, error: { message } }, { status })
}

async function validateMemoryAccess(
  request: NextRequest,
  workspaceId: string,
  requestId: string,
  action: 'read' | 'write'
): Promise<{ userId: string } | { error: NextResponse }> {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    logger.warn(`[${requestId}] Unauthorized memory ${action} attempt`)
    return { error: memoryEnvelopeError('Authentication required', 401) }
  }

  const access = await checkWorkspaceAccess(workspaceId, authResult.userId)
  if (!access.exists || !access.hasAccess) {
    return { error: memoryEnvelopeError('Workspace not found', 404) }
  }

  if (action === 'write' && !access.canWrite) {
    return { error: memoryEnvelopeError('Write access denied', 403) }
  }

  return { userId: authResult.userId }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withRouteHandler(async (request: NextRequest, context: MemoryRouteContext) => {
  const requestId = generateRequestId()
  const { id } = await context.params

  try {
    const validation = await parseRequest(getMemoryByIdContract, request, context, {
      validationErrorResponse: (error) =>
        memoryEnvelopeError(
          error.issues.map((err) => `${err.path.join('.')}: ${err.message}`).join(', '),
          400
        ),
    })
    if (!validation.success) return validation.response
    const { workspaceId: validatedWorkspaceId } = validation.data.query

    const accessCheck = await validateMemoryAccess(request, validatedWorkspaceId, requestId, 'read')
    if ('error' in accessCheck) {
      return accessCheck.error
    }

    const memories = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.key, id),
          eq(memory.workspaceId, validatedWorkspaceId),
          isNull(memory.deletedAt)
        )
      )
      .orderBy(memory.createdAt)
      .limit(1)

    if (memories.length === 0) {
      return NextResponse.json({ success: true, data: null }, { status: 200 })
    }

    const mem = memories[0]

    logger.info(`[${requestId}] Memory retrieved: ${id} for workspace: ${validatedWorkspaceId}`)
    return NextResponse.json(
      { success: true, data: { conversationId: mem.key, data: mem.data } },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error retrieving memory`, { error })
    return memoryEnvelopeError(error.message || 'Failed to retrieve memory', 500)
  }
})

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: MemoryRouteContext) => {
    const requestId = generateRequestId()
    const { id } = await context.params

    try {
      const validation = await parseRequest(deleteMemoryByIdContract, request, context, {
        validationErrorResponse: (error) =>
          memoryEnvelopeError(
            error.issues.map((err) => `${err.path.join('.')}: ${err.message}`).join(', '),
            400
          ),
      })
      if (!validation.success) return validation.response
      const { workspaceId: validatedWorkspaceId } = validation.data.query

      const accessCheck = await validateMemoryAccess(
        request,
        validatedWorkspaceId,
        requestId,
        'write'
      )
      if ('error' in accessCheck) {
        return accessCheck.error
      }

      const existingMemory = await db
        .select({ id: memory.id })
        .from(memory)
        .where(
          and(
            eq(memory.key, id),
            eq(memory.workspaceId, validatedWorkspaceId),
            isNull(memory.deletedAt)
          )
        )
        .limit(1)

      if (existingMemory.length === 0) {
        return memoryEnvelopeError('Memory not found', 404)
      }

      await db
        .delete(memory)
        .where(
          and(
            eq(memory.key, id),
            eq(memory.workspaceId, validatedWorkspaceId),
            isNull(memory.deletedAt)
          )
        )

      logger.info(`[${requestId}] Memory deleted: ${id} for workspace: ${validatedWorkspaceId}`)
      return NextResponse.json(
        { success: true, data: { message: 'Memory deleted successfully' } },
        { status: 200 }
      )
    } catch (error: any) {
      logger.error(`[${requestId}] Error deleting memory`, { error })
      return memoryEnvelopeError(error.message || 'Failed to delete memory', 500)
    }
  }
)

export const PUT = withRouteHandler(async (request: NextRequest, context: MemoryRouteContext) => {
  const requestId = generateRequestId()
  const { id } = await context.params

  try {
    const validation = await parseRequest(updateMemoryByIdContract, request, context, {
      validationErrorResponse: (error) =>
        memoryEnvelopeError(
          `Invalid request body: ${error.issues.map((err) => `${err.path.join('.')}: ${err.message}`).join(', ')}`,
          400
        ),
      invalidJsonResponse: () => memoryEnvelopeError('Invalid JSON in request body', 400),
    })
    if (!validation.success) return validation.response
    const { data: validatedData, workspaceId: validatedWorkspaceId } = validation.data.body

    const accessCheck = await validateMemoryAccess(
      request,
      validatedWorkspaceId,
      requestId,
      'write'
    )
    if ('error' in accessCheck) {
      return accessCheck.error
    }

    const existingMemories = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.key, id),
          eq(memory.workspaceId, validatedWorkspaceId),
          isNull(memory.deletedAt)
        )
      )
      .limit(1)

    if (existingMemories.length === 0) {
      return memoryEnvelopeError('Memory not found', 404)
    }

    const agentValidation = agentMemoryDataSchemaContract.safeParse(validatedData)
    if (!agentValidation.success) {
      const errorMessage = agentValidation.error.issues
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ')
      return memoryEnvelopeError(`Invalid agent memory data: ${errorMessage}`, 400)
    }

    const now = new Date()
    await db
      .update(memory)
      .set({ data: validatedData, updatedAt: now })
      .where(
        and(
          eq(memory.key, id),
          eq(memory.workspaceId, validatedWorkspaceId),
          isNull(memory.deletedAt)
        )
      )

    const updatedMemories = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.key, id),
          eq(memory.workspaceId, validatedWorkspaceId),
          isNull(memory.deletedAt)
        )
      )
      .limit(1)

    const mem = updatedMemories[0]

    logger.info(`[${requestId}] Memory updated: ${id} for workspace: ${validatedWorkspaceId}`)
    return NextResponse.json(
      { success: true, data: { conversationId: mem.key, data: mem.data } },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error updating memory`, { error })
    return memoryEnvelopeError(error.message || 'Failed to update memory', 500)
  }
})
