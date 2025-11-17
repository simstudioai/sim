import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { and, eq, isNull, like } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

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
  const requestId = generateRequestId()

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
  const requestId = generateRequestId()

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

    // Use atomic UPSERT with JSONB append to prevent race conditions
    // If data is an array, insert it directly; if single message, wrap in array
    const initialData = Array.isArray(data) ? data : [data]
    const now = new Date()
    const id = `mem_${crypto.randomUUID().replace(/-/g, '')}`

    // Import sql helper for raw SQL in Drizzle
    const { sql } = await import('drizzle-orm')

    // Atomically insert or append using PostgreSQL JSONB concatenation
    await db
      .insert(memory)
      .values({
        id,
        workflowId,
        key,
        type,
        data: initialData,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memory.workflowId, memory.key],
        set: {
          // Atomically append: data = data || '[new_message]'::jsonb
          // This prevents lost updates in concurrent scenarios
          data: sql`${memory.data} || ${JSON.stringify(initialData)}::jsonb`,
          updatedAt: now,
        },
      })

    logger.info(
      `[${requestId}] Memory operation successful (atomic): ${key} for workflow: ${workflowId}`
    )

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

    return NextResponse.json(
      {
        success: true,
        data: memoryRecord,
      },
      { status: 200 }
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
