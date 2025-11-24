import { db } from '@sim/db'
import { memory, workflowBlocks } from '@sim/db/schema'
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { getWorkflowAccessContext } from '@/lib/workflows/utils'

const logger = createLogger('MemoryAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Parse memory key into conversationId and blockId
 * Key format: conversationId:blockId
 * @param key The memory key to parse
 * @returns Object with conversationId and blockId, or null if invalid
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
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized memory access attempt`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: authResult.error || 'Authentication required',
          },
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Processing memory search request`)

    const url = new URL(request.url)
    const workflowId = url.searchParams.get('workflowId')
    const searchQuery = url.searchParams.get('query')
    const blockNameFilter = url.searchParams.get('blockName')
    const limit = Number.parseInt(url.searchParams.get('limit') || '50')

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

    const accessContext = await getWorkflowAccessContext(workflowId, authResult.userId)
    if (!accessContext) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for user ${authResult.userId}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Workflow not found',
          },
        },
        { status: 404 }
      )
    }

    const { workspacePermission, isOwner } = accessContext

    if (!isOwner && !workspacePermission) {
      logger.warn(
        `[${requestId}] User ${authResult.userId} denied access to workflow ${workflowId}`
      )
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Access denied to this workflow',
          },
        },
        { status: 403 }
      )
    }

    logger.info(
      `[${requestId}] User ${authResult.userId} (${authResult.authType}) accessing memories for workflow ${workflowId}`
    )

    const conditions = []

    conditions.push(isNull(memory.deletedAt))

    conditions.push(eq(memory.workflowId, workflowId))

    let blockIdsToFilter: string[] | null = null
    if (blockNameFilter) {
      const blocks = await db
        .select({ id: workflowBlocks.id })
        .from(workflowBlocks)
        .where(
          and(eq(workflowBlocks.workflowId, workflowId), eq(workflowBlocks.name, blockNameFilter))
        )

      if (blocks.length === 0) {
        logger.info(
          `[${requestId}] No blocks found with name "${blockNameFilter}" for workflow: ${workflowId}`
        )
        return NextResponse.json(
          {
            success: true,
            data: { memories: [] },
          },
          { status: 200 }
        )
      }

      blockIdsToFilter = blocks.map((b) => b.id)
    }

    if (searchQuery) {
      conditions.push(like(memory.key, `%${searchQuery}%`))
    }

    const rawMemories = await db
      .select()
      .from(memory)
      .where(and(...conditions))
      .orderBy(memory.createdAt)
      .limit(limit)

    const filteredMemories = blockIdsToFilter
      ? rawMemories.filter((mem) => {
          const parsed = parseMemoryKey(mem.key)
          return parsed && blockIdsToFilter.includes(parsed.blockId)
        })
      : rawMemories

    const blockIds = new Set<string>()
    const parsedKeys = new Map<string, { conversationId: string; blockId: string }>()

    for (const mem of filteredMemories) {
      const parsed = parseMemoryKey(mem.key)
      if (parsed) {
        blockIds.add(parsed.blockId)
        parsedKeys.set(mem.key, parsed)
      }
    }

    const blockNameMap = new Map<string, string>()
    if (blockIds.size > 0) {
      const blocks = await db
        .select({ id: workflowBlocks.id, name: workflowBlocks.name })
        .from(workflowBlocks)
        .where(
          and(
            eq(workflowBlocks.workflowId, workflowId),
            inArray(workflowBlocks.id, Array.from(blockIds))
          )
        )

      for (const block of blocks) {
        blockNameMap.set(block.id, block.name)
      }
    }

    const enrichedMemories = filteredMemories.map((mem) => {
      const parsed = parsedKeys.get(mem.key)

      if (!parsed) {
        return {
          conversationId: mem.key,
          blockId: 'unknown',
          blockName: 'unknown',
          data: mem.data,
        }
      }

      const { conversationId, blockId } = parsed
      const blockName = blockNameMap.get(blockId) || 'unknown'

      return {
        conversationId,
        blockId,
        blockName,
        data: mem.data,
      }
    })

    logger.info(
      `[${requestId}] Found ${enrichedMemories.length} memories for workflow: ${workflowId}`
    )
    return NextResponse.json(
      {
        success: true,
        data: { memories: enrichedMemories },
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
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized memory creation attempt`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: authResult.error || 'Authentication required',
          },
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Processing memory creation request`)

    const body = await request.json()
    const { key, data, workflowId } = body

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

    const accessContext = await getWorkflowAccessContext(workflowId, authResult.userId)
    if (!accessContext) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for user ${authResult.userId}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Workflow not found',
          },
        },
        { status: 404 }
      )
    }

    const { workspacePermission, isOwner } = accessContext

    const hasWritePermission =
      isOwner || workspacePermission === 'write' || workspacePermission === 'admin'

    if (!hasWritePermission) {
      logger.warn(
        `[${requestId}] User ${authResult.userId} denied write access to workflow ${workflowId}`
      )
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Write access denied to this workflow',
          },
        },
        { status: 403 }
      )
    }

    logger.info(
      `[${requestId}] User ${authResult.userId} (${authResult.authType}) creating memory for workflow ${workflowId}`
    )

    const dataToValidate = Array.isArray(data) ? data : [data]

    for (const msg of dataToValidate) {
      if (!msg || typeof msg !== 'object' || !msg.role || !msg.content) {
        logger.warn(`[${requestId}] Missing required message fields`)
        return NextResponse.json(
          {
            success: false,
            error: {
              message: 'Memory requires messages with role and content',
            },
          },
          { status: 400 }
        )
      }

      if (!['user', 'assistant', 'system'].includes(msg.role)) {
        logger.warn(`[${requestId}] Invalid message role: ${msg.role}`)
        return NextResponse.json(
          {
            success: false,
            error: {
              message: 'Message role must be user, assistant, or system',
            },
          },
          { status: 400 }
        )
      }
    }

    const initialData = Array.isArray(data) ? data : [data]
    const now = new Date()
    const id = `mem_${crypto.randomUUID().replace(/-/g, '')}`

    const { sql } = await import('drizzle-orm')

    await db
      .insert(memory)
      .values({
        id,
        workflowId,
        key,
        data: initialData,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memory.workflowId, memory.key],
        set: {
          data: sql`${memory.data} || ${JSON.stringify(initialData)}::jsonb`,
          updatedAt: now,
        },
      })

    logger.info(
      `[${requestId}] Memory operation successful (atomic): ${key} for workflow: ${workflowId}`
    )

    const allMemories = await db
      .select()
      .from(memory)
      .where(and(eq(memory.key, key), eq(memory.workflowId, workflowId), isNull(memory.deletedAt)))
      .orderBy(memory.createdAt)

    if (allMemories.length === 0) {
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

    const memoryRecord = allMemories[0]
    const parsed = parseMemoryKey(memoryRecord.key)

    let enrichedMemory
    if (!parsed) {
      enrichedMemory = {
        conversationId: memoryRecord.key,
        blockId: 'unknown',
        blockName: 'unknown',
        data: memoryRecord.data,
      }
    } else {
      const { conversationId, blockId } = parsed
      const blockName = await (async () => {
        const blocks = await db
          .select({ name: workflowBlocks.name })
          .from(workflowBlocks)
          .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
          .limit(1)
        return blocks.length > 0 ? blocks[0].name : 'unknown'
      })()

      enrichedMemory = {
        conversationId,
        blockId,
        blockName,
        data: memoryRecord.data,
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: enrichedMemory,
      },
      { status: 200 }
    )
  } catch (error: any) {
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

/**
 * DELETE handler for pattern-based memory deletion
 * Supports query parameters:
 * - workflowId: Required
 * - conversationId: Optional - delete all memories for this conversation
 * - blockId: Optional - delete all memories for this block
 * - blockName: Optional - delete all memories for blocks with this name
 */
export async function DELETE(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized memory deletion attempt`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: authResult.error || 'Authentication required',
          },
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Processing memory deletion request`)

    const url = new URL(request.url)
    const workflowId = url.searchParams.get('workflowId')
    const conversationId = url.searchParams.get('conversationId')
    const blockId = url.searchParams.get('blockId')
    const blockName = url.searchParams.get('blockName')

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

    if (!conversationId && !blockId && !blockName) {
      logger.warn(`[${requestId}] No filter parameters provided`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'At least one of conversationId, blockId, or blockName must be provided',
          },
        },
        { status: 400 }
      )
    }

    const accessContext = await getWorkflowAccessContext(workflowId, authResult.userId)
    if (!accessContext) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for user ${authResult.userId}`)
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Workflow not found',
          },
        },
        { status: 404 }
      )
    }

    const { workspacePermission, isOwner } = accessContext

    const hasWritePermission =
      isOwner || workspacePermission === 'write' || workspacePermission === 'admin'

    if (!hasWritePermission) {
      logger.warn(
        `[${requestId}] User ${authResult.userId} denied delete access to workflow ${workflowId}`
      )
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Write access denied to this workflow',
          },
        },
        { status: 403 }
      )
    }

    logger.info(
      `[${requestId}] User ${authResult.userId} (${authResult.authType}) deleting memories for workflow ${workflowId}`
    )

    let deletedCount = 0

    if (conversationId && blockId) {
      const key = `${conversationId}:${blockId}`
      const result = await db
        .delete(memory)
        .where(and(eq(memory.key, key), eq(memory.workflowId, workflowId)))
        .returning({ id: memory.id })

      deletedCount = result.length
    } else if (conversationId && blockName) {
      const blocks = await db
        .select({ id: workflowBlocks.id })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.workflowId, workflowId), eq(workflowBlocks.name, blockName)))

      if (blocks.length === 0) {
        return NextResponse.json(
          {
            success: true,
            data: {
              message: `No blocks found with name "${blockName}"`,
              deletedCount: 0,
            },
          },
          { status: 200 }
        )
      }

      for (const block of blocks) {
        const key = `${conversationId}:${block.id}`
        const result = await db
          .delete(memory)
          .where(and(eq(memory.key, key), eq(memory.workflowId, workflowId)))
          .returning({ id: memory.id })

        deletedCount += result.length
      }
    } else if (conversationId) {
      const pattern = `${conversationId}:%`
      const result = await db
        .delete(memory)
        .where(and(like(memory.key, pattern), eq(memory.workflowId, workflowId)))
        .returning({ id: memory.id })

      deletedCount = result.length
    } else if (blockId) {
      const pattern = `%:${blockId}`
      const result = await db
        .delete(memory)
        .where(and(like(memory.key, pattern), eq(memory.workflowId, workflowId)))
        .returning({ id: memory.id })

      deletedCount = result.length
    } else if (blockName) {
      const blocks = await db
        .select({ id: workflowBlocks.id })
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.workflowId, workflowId), eq(workflowBlocks.name, blockName)))

      if (blocks.length === 0) {
        return NextResponse.json(
          {
            success: true,
            data: {
              message: `No blocks found with name "${blockName}"`,
              deletedCount: 0,
            },
          },
          { status: 200 }
        )
      }

      for (const block of blocks) {
        const pattern = `%:${block.id}`
        const result = await db
          .delete(memory)
          .where(and(like(memory.key, pattern), eq(memory.workflowId, workflowId)))
          .returning({ id: memory.id })

        deletedCount += result.length
      }
    }

    logger.info(
      `[${requestId}] Successfully deleted ${deletedCount} memories for workflow: ${workflowId}`
    )
    return NextResponse.json(
      {
        success: true,
        data: {
          message:
            deletedCount > 0
              ? `Successfully deleted ${deletedCount} memories`
              : 'No memories found matching the criteria',
          deletedCount,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error deleting memories`, { error })
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message || 'Failed to delete memories',
        },
      },
      { status: 500 }
    )
  }
}
