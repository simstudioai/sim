import { and, eq, isNull, like } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { memory } from '@/db/schema'

const logger = createLogger('MemoryAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET handler for searching and retrieving memories
 * Supports query parameters:
 * - query: Search string for memory keys
 * - type: Filter by memory type
 * - limit: Maximum number of results (default: 50)
 * - workflowId: Filter by workflow ID (required)
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Processing memory search request`)

    // Extract workflowId from query parameters
    const url = new URL(request.url)
    const workflowId = url.searchParams.get('workflowId')
    const searchQuery = url.searchParams.get('query')
    const type = url.searchParams.get('type')
    const limit = Number.parseInt(url.searchParams.get('limit') || '50')

    // Require workflowId for security
    if (!workflowId) {
      logger.warn(`[${requestId}] Missing required parameter: workflowId`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'workflowId parameter is required',
          },
        },
        { status: 400 }
      )
    }

    // Build query conditions
    const conditions = []

    // Only include non-deleted memories
    conditions.push(isNull(memory.deletedAt))

    // Filter by workflow ID (required)
    conditions.push(eq(memory.workflowId, workflowId))

    // Add type filter if provided
    if (type) {
      conditions.push(eq(memory.type, type))
    }

    // Add search query if provided (leverages index on key field)
    if (searchQuery) {
      conditions.push(like(memory.key, `%${searchQuery}%`))
    }

    // Execute the query
    const memories = await db
      .select()
      .from(memory)
      .where(and(...conditions))
      .orderBy(memory.createdAt)
      .limit(limit)

    logger.info(`[${requestId}] Found ${memories.length} memories for workflow: ${workflowId}`)
    return NextResponse.json(
      {
        success: true,
        data: { memories },
      },
      { status: 200 }
    )
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message || 'Failed to search memories',
        },
      },
      { status: 500 }
    )
  }
}

/**
 * POST handler for creating new memories
 * Requires:
 * - key: Unique identifier for the memory (within workflow scope)
 * - type: Memory type ('agent')
 * - data: Memory content (agent message with role and content)
 * - workflowId: ID of the workflow this memory belongs to
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.info(`[${requestId}] Processing memory creation request`)

    // Parse request body
    const body = await request.json()
    const { key, type, data, workflowId } = body

    // Validate required fields
    if (!key) {
      logger.warn(`[${requestId}] Missing required field: key`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Memory key is required',
          },
        },
        { status: 400 }
      )
    }

    if (!type || type !== 'agent') {
      logger.warn(`[${requestId}] Invalid memory type: ${type}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Memory type must be "agent"',
          },
        },
        { status: 400 }
      )
    }

    if (!data) {
      logger.warn(`[${requestId}] Missing required field: data`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Memory data is required',
          },
        },
        { status: 400 }
      )
    }

    if (!workflowId) {
      logger.warn(`[${requestId}] Missing required field: workflowId`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'workflowId is required',
          },
        },
        { status: 400 }
      )
    }

    // Additional validation for agent type
    if (type === 'agent') {
      if (!data.role || !data.content) {
        logger.warn(`[${requestId}] Missing agent memory fields`)
        return NextResponse.json(
          {
            success: false,
            error: {
              message: 'Agent memory requires role and content',
            },
          },
          { status: 400 }
        )
      }

      if (!['user', 'assistant', 'system'].includes(data.role)) {
        logger.warn(`[${requestId}] Invalid agent role: ${data.role}`)
        return NextResponse.json(
          {
            success: false,
            error: {
              message: 'Agent role must be user, assistant, or system',
            },
          },
          { status: 400 }
        )
      }
    }

    // Check if memory with the same key already exists for this workflow
    const existingMemory = await db
      .select()
      .from(memory)
      .where(and(eq(memory.key, key), eq(memory.workflowId, workflowId), isNull(memory.deletedAt)))
      .limit(1)

    let statusCode = 201 // Default status code for new memory

    if (existingMemory.length > 0) {
      logger.info(`[${requestId}] Memory with key ${key} exists, checking if we can append`)

      // Check if types match
      if (existingMemory[0].type !== type) {
        logger.warn(
          `[${requestId}] Memory type mismatch: existing=${existingMemory[0].type}, new=${type}`
        )
        return NextResponse.json(
          {
            success: false,
            error: {
              message: `Cannot append memory of type '${type}' to existing memory of type '${existingMemory[0].type}'`,
            },
          },
          { status: 400 }
        )
      }

      // Handle appending for agent type
      let updatedData

      // For agent type
      const newMessage = data
      const existingData = existingMemory[0].data

      // If existing data is an array, append to it
      if (Array.isArray(existingData)) {
        updatedData = [...existingData, newMessage]
      }
      // If existing data is a single message object, convert to array
      else {
        updatedData = [existingData, newMessage]
      }

      // Update the existing memory with appended data
      await db
        .update(memory)
        .set({
          data: updatedData,
          updatedAt: new Date(),
        })
        .where(and(eq(memory.key, key), eq(memory.workflowId, workflowId)))

      statusCode = 200 // Status code for updated memory
    } else {
      // Insert the new memory
      const newMemory = {
        id: `mem_${crypto.randomUUID().replace(/-/g, '')}`,
        workflowId,
        key,
        type,
        data: Array.isArray(data) ? data : [data],
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      await db.insert(memory).values(newMemory)
      logger.info(`[${requestId}] Memory created successfully: ${key} for workflow: ${workflowId}`)
    }

    // Fetch all memories with the same key for this workflow to return the complete list
    const allMemories = await db
      .select()
      .from(memory)
      .where(and(eq(memory.key, key), eq(memory.workflowId, workflowId), isNull(memory.deletedAt)))
      .orderBy(memory.createdAt)

    if (allMemories.length === 0) {
      // This shouldn't happen but handle it just in case
      logger.warn(`[${requestId}] No memories found after creating/updating memory: ${key}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Failed to retrieve memory after creation/update',
          },
        },
        { status: 500 }
      )
    }

    // Get the memory object to return
    const memoryRecord = allMemories[0]

    logger.info(`[${requestId}] Memory operation successful: ${key} for workflow: ${workflowId}`)
    return NextResponse.json(
      {
        success: true,
        data: memoryRecord,
      },
      { status: statusCode }
    )
  } catch (error: any) {
    // Handle unique constraint violation
    if (error.code === '23505') {
      logger.warn(`[${requestId}] Duplicate key violation`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Memory with this key already exists',
          },
        },
        { status: 409 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message || 'Failed to create memory',
        },
      },
      { status: 500 }
    )
  }
}
