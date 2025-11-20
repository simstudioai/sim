import { db } from '@sim/db'
import { memory, workflowBlocks } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('MemoryByIdAPI')

/**
 * Parse memory key into conversationId and blockId
 * Key format: conversationId:blockId
 */
function parseMemoryKey(key: string): { conversationId: string; blockId: string } | null {
  const parts = key.split(':')
  if (parts.length !== 2) {
    return null
  }
  return {
    conversationId: parts[0],
    blockId: parts[1],
  }
}

/**
 * Lookup block name from block ID
 */
async function getBlockName(blockId: string, workflowId: string): Promise<string | undefined> {
  try {
    const result = await db
      .select({ name: workflowBlocks.name })
      .from(workflowBlocks)
      .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
      .limit(1)

    if (result.length === 0) {
      return undefined
    }

    return result[0].name
  } catch (error) {
    logger.error('Error looking up block name', { error, blockId, workflowId })
    return undefined
  }
}

const memoryQuerySchema = z.object({
  workflowId: z.string().uuid('Invalid workflow ID format'),
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
  workflowId: z.string().uuid('Invalid workflow ID format'),
})

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET handler for retrieving a specific memory by ID
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.info(`[${requestId}] Processing memory get request for ID: ${id}`)

    const url = new URL(request.url)
    const workflowId = url.searchParams.get('workflowId')

    const validation = memoryQuerySchema.safeParse({ workflowId })

    if (!validation.success) {
      const errorMessage = validation.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ')
      logger.warn(`[${requestId}] Validation error: ${errorMessage}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: errorMessage,
          },
        },
        { status: 400 }
      )
    }

    const { workflowId: validatedWorkflowId } = validation.data

    const memories = await db
      .select()
      .from(memory)
      .where(and(eq(memory.key, id), eq(memory.workflowId, validatedWorkflowId)))
      .orderBy(memory.createdAt)
      .limit(1)

    if (memories.length === 0) {
      logger.warn(`[${requestId}] Memory not found: ${id} for workflow: ${validatedWorkflowId}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Memory not found',
          },
        },
        { status: 404 }
      )
    }

    const mem = memories[0]
    const parsed = parseMemoryKey(mem.key)

    let enrichedMemory
    if (!parsed) {
      enrichedMemory = {
        conversationId: mem.key,
        blockId: 'unknown',
        blockName: 'unknown',
        data: mem.data,
      }
    } else {
      const { conversationId, blockId } = parsed
      const blockName = (await getBlockName(blockId, validatedWorkflowId)) || 'unknown'

      enrichedMemory = {
        conversationId,
        blockId,
        blockName,
        data: mem.data,
      }
    }

    logger.info(
      `[${requestId}] Memory retrieved successfully: ${id} for workflow: ${validatedWorkflowId}`
    )
    return NextResponse.json(
      {
        success: true,
        data: enrichedMemory,
      },
      { status: 200 }
    )
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message || 'Failed to retrieve memory',
        },
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE handler for removing a specific memory
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.info(`[${requestId}] Processing memory delete request for ID: ${id}`)

    const url = new URL(request.url)
    const workflowId = url.searchParams.get('workflowId')

    const validation = memoryQuerySchema.safeParse({ workflowId })

    if (!validation.success) {
      const errorMessage = validation.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ')
      logger.warn(`[${requestId}] Validation error: ${errorMessage}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: errorMessage,
          },
        },
        { status: 400 }
      )
    }

    const { workflowId: validatedWorkflowId } = validation.data

    const existingMemory = await db
      .select({ id: memory.id })
      .from(memory)
      .where(and(eq(memory.key, id), eq(memory.workflowId, validatedWorkflowId)))
      .limit(1)

    if (existingMemory.length === 0) {
      logger.warn(`[${requestId}] Memory not found: ${id} for workflow: ${validatedWorkflowId}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Memory not found',
          },
        },
        { status: 404 }
      )
    }

    await db
      .delete(memory)
      .where(and(eq(memory.key, id), eq(memory.workflowId, validatedWorkflowId)))

    logger.info(
      `[${requestId}] Memory deleted successfully: ${id} for workflow: ${validatedWorkflowId}`
    )
    return NextResponse.json(
      {
        success: true,
        data: { message: 'Memory deleted successfully' },
      },
      { status: 200 }
    )
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message || 'Failed to delete memory',
        },
      },
      { status: 500 }
    )
  }
}

/**
 * PUT handler for updating a specific memory
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.info(`[${requestId}] Processing memory update request for ID: ${id}`)

    let validatedData
    let validatedWorkflowId
    try {
      const body = await request.json()
      const validation = memoryPutBodySchema.safeParse(body)

      if (!validation.success) {
        const errorMessage = validation.error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ')
        logger.warn(`[${requestId}] Validation error: ${errorMessage}`)
        return NextResponse.json(
          {
            success: false,
            error: {
              message: `Invalid request body: ${errorMessage}`,
            },
          },
          { status: 400 }
        )
      }

      validatedData = validation.data.data
      validatedWorkflowId = validation.data.workflowId
    } catch (error: any) {
      logger.warn(`[${requestId}] Failed to parse request body: ${error.message}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Invalid JSON in request body',
          },
        },
        { status: 400 }
      )
    }

    const existingMemories = await db
      .select()
      .from(memory)
      .where(and(eq(memory.key, id), eq(memory.workflowId, validatedWorkflowId)))
      .limit(1)

    if (existingMemories.length === 0) {
      logger.warn(`[${requestId}] Memory not found: ${id} for workflow: ${validatedWorkflowId}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Memory not found',
          },
        },
        { status: 404 }
      )
    }

    const agentValidation = agentMemoryDataSchema.safeParse(validatedData)
    if (!agentValidation.success) {
      const errorMessage = agentValidation.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join(', ')
      logger.warn(`[${requestId}] Agent memory validation error: ${errorMessage}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: `Invalid agent memory data: ${errorMessage}`,
          },
        },
        { status: 400 }
      )
    }

    const now = new Date()
    await db
      .update(memory)
      .set({
        data: validatedData,
        updatedAt: now,
      })
      .where(and(eq(memory.key, id), eq(memory.workflowId, validatedWorkflowId)))

    const updatedMemories = await db
      .select()
      .from(memory)
      .where(and(eq(memory.key, id), eq(memory.workflowId, validatedWorkflowId)))
      .limit(1)

    const mem = updatedMemories[0]
    const parsed = parseMemoryKey(mem.key)

    let enrichedMemory
    if (!parsed) {
      enrichedMemory = {
        conversationId: mem.key,
        blockId: 'unknown',
        blockName: 'unknown',
        data: mem.data,
      }
    } else {
      const { conversationId, blockId } = parsed
      const blockName = (await getBlockName(blockId, validatedWorkflowId)) || 'unknown'

      enrichedMemory = {
        conversationId,
        blockId,
        blockName,
        data: mem.data,
      }
    }

    logger.info(
      `[${requestId}] Memory updated successfully: ${id} for workflow: ${validatedWorkflowId}`
    )
    return NextResponse.json(
      {
        success: true,
        data: enrichedMemory,
      },
      { status: 200 }
    )
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message || 'Failed to update memory',
        },
      },
      { status: 500 }
    )
  }
}
