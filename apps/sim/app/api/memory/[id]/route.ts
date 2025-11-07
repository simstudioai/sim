import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('MemoryByIdAPI')

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

    // Get workflowId from query parameter (required)
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

    // Query the database for the memory
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

    logger.info(
      `[${requestId}] Memory retrieved successfully: ${id} for workflow: ${validatedWorkflowId}`
    )
    return NextResponse.json(
      {
        success: true,
        data: memories[0],
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

    // Get workflowId from query parameter (required)
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

    // Verify memory exists before attempting to delete
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

    // Hard delete the memory
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

    // Verify memory exists before attempting to update
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

    const existingMemory = existingMemories[0]

    // Additional validation for agent memory type
    if (existingMemory.type === 'agent') {
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
    }

    // Update the memory with new data
    await db
      .delete(memory)
      .where(and(eq(memory.key, id), eq(memory.workflowId, validatedWorkflowId)))

    // Fetch the updated memory
    const updatedMemories = await db
      .select()
      .from(memory)
      .where(and(eq(memory.key, id), eq(memory.workflowId, validatedWorkflowId)))
      .limit(1)

    logger.info(
      `[${requestId}] Memory updated successfully: ${id} for workflow: ${validatedWorkflowId}`
    )
    return NextResponse.json(
      {
        success: true,
        data: updatedMemories[0],
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
