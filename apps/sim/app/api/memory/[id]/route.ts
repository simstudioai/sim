import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MemoryByIdAPI')

const memoryQuerySchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
})

const agentMemoryDataSchema = z.object({
  role: z.enum(['user', 'assistant', 'system'], {
    errorMap: () => ({ message: 'Role must be user, assistant, or system' }),
  }),
  content: z.string().min(1, 'Content is required'),
})

const genericMemoryDataSchema = z.record(z.unknown())

const memoryPutBodySchema = z.object({
  data: z.union([agentMemoryDataSchema, genericMemoryDataSchema], {
    errorMap: () => ({ message: 'Invalid memory data structure' }),
  }),
  workspaceId: z.string().uuid('Invalid workspace ID format'),
})

async function validateMemoryAccess(
  request: NextRequest,
  workspaceId: string,
  requestId: string,
  action: 'read' | 'write'
): Promise<{ userId: string } | { error: NextResponse }> {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    logger.warn(`[${requestId}] Unauthorized memory ${action} attempt`)
    return {
      error: NextResponse.json(
        { success: false, error: { message: 'Authentication required' } },
        { status: 401 }
      ),
    }
  }

  const access = await checkWorkspaceAccess(workspaceId, authResult.userId)
  if (!access.exists || !access.hasAccess) {
    return {
      error: NextResponse.json(
        { success: false, error: { message: 'Workspace not found' } },
        { status: 404 }
      ),
    }
  }

  if (action === 'write' && !access.canWrite) {
    return {
      error: NextResponse.json(
        { success: false, error: { message: 'Write access denied' } },
        { status: 403 }
      ),
    }
  }

  return { userId: authResult.userId }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get('workspaceId')

    const validation = memoryQuerySchema.safeParse({ workspaceId })
    if (!validation.success) {
      const errorMessage = validation.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ')
      return NextResponse.json(
        { success: false, error: { message: errorMessage } },
        { status: 400 }
      )
    }

    const { workspaceId: validatedWorkspaceId } = validation.data

    const accessCheck = await validateMemoryAccess(request, validatedWorkspaceId, requestId, 'read')
    if ('error' in accessCheck) {
      return accessCheck.error
    }

    const memories = await db
      .select()
      .from(memory)
      .where(and(eq(memory.key, id), eq(memory.workspaceId, validatedWorkspaceId)))
      .orderBy(memory.createdAt)
      .limit(1)

    if (memories.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'Memory not found' } },
        { status: 404 }
      )
    }

    const mem = memories[0]

    logger.info(`[${requestId}] Memory retrieved: ${id} for workspace: ${validatedWorkspaceId}`)
    return NextResponse.json(
      { success: true, data: { conversationId: mem.key, data: mem.data } },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error retrieving memory`, { error })
    return NextResponse.json(
      { success: false, error: { message: error.message || 'Failed to retrieve memory' } },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const url = new URL(request.url)
    const workspaceId = url.searchParams.get('workspaceId')

    const validation = memoryQuerySchema.safeParse({ workspaceId })
    if (!validation.success) {
      const errorMessage = validation.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ')
      return NextResponse.json(
        { success: false, error: { message: errorMessage } },
        { status: 400 }
      )
    }

    const { workspaceId: validatedWorkspaceId } = validation.data

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
      .where(and(eq(memory.key, id), eq(memory.workspaceId, validatedWorkspaceId)))
      .limit(1)

    if (existingMemory.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'Memory not found' } },
        { status: 404 }
      )
    }

    await db
      .delete(memory)
      .where(and(eq(memory.key, id), eq(memory.workspaceId, validatedWorkspaceId)))

    logger.info(`[${requestId}] Memory deleted: ${id} for workspace: ${validatedWorkspaceId}`)
    return NextResponse.json(
      { success: true, data: { message: 'Memory deleted successfully' } },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error deleting memory`, { error })
    return NextResponse.json(
      { success: false, error: { message: error.message || 'Failed to delete memory' } },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    let validatedData
    let validatedWorkspaceId
    try {
      const body = await request.json()
      const validation = memoryPutBodySchema.safeParse(body)

      if (!validation.success) {
        const errorMessage = validation.error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ')
        return NextResponse.json(
          { success: false, error: { message: `Invalid request body: ${errorMessage}` } },
          { status: 400 }
        )
      }

      validatedData = validation.data.data
      validatedWorkspaceId = validation.data.workspaceId
    } catch {
      return NextResponse.json(
        { success: false, error: { message: 'Invalid JSON in request body' } },
        { status: 400 }
      )
    }

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
      .where(and(eq(memory.key, id), eq(memory.workspaceId, validatedWorkspaceId)))
      .limit(1)

    if (existingMemories.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'Memory not found' } },
        { status: 404 }
      )
    }

    const agentValidation = agentMemoryDataSchema.safeParse(validatedData)
    if (!agentValidation.success) {
      const errorMessage = agentValidation.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ')
      return NextResponse.json(
        { success: false, error: { message: `Invalid agent memory data: ${errorMessage}` } },
        { status: 400 }
      )
    }

    const now = new Date()
    await db
      .update(memory)
      .set({ data: validatedData, updatedAt: now })
      .where(and(eq(memory.key, id), eq(memory.workspaceId, validatedWorkspaceId)))

    const updatedMemories = await db
      .select()
      .from(memory)
      .where(and(eq(memory.key, id), eq(memory.workspaceId, validatedWorkspaceId)))
      .limit(1)

    const mem = updatedMemories[0]

    logger.info(`[${requestId}] Memory updated: ${id} for workspace: ${validatedWorkspaceId}`)
    return NextResponse.json(
      { success: true, data: { conversationId: mem.key, data: mem.data } },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error updating memory`, { error })
    return NextResponse.json(
      { success: false, error: { message: error.message || 'Failed to update memory' } },
      { status: 500 }
    )
  }
}
