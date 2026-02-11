import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, like } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MemoryAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized memory access attempt`)
      return NextResponse.json(
        { success: false, error: { message: authResult.error || 'Authentication required' } },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const workspaceId = url.searchParams.get('workspaceId')
    const searchQuery = url.searchParams.get('query')
    const limit = Number.parseInt(url.searchParams.get('limit') || '50')

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: { message: 'workspaceId parameter is required' } },
        { status: 400 }
      )
    }

    const access = await checkWorkspaceAccess(workspaceId, authResult.userId)
    if (!access.exists) {
      return NextResponse.json(
        { success: false, error: { message: 'Workspace not found' } },
        { status: 404 }
      )
    }
    if (!access.hasAccess) {
      return NextResponse.json(
        { success: false, error: { message: 'Access denied to this workspace' } },
        { status: 403 }
      )
    }

    const conditions = [isNull(memory.deletedAt), eq(memory.workspaceId, workspaceId)]

    if (searchQuery) {
      conditions.push(like(memory.key, `%${searchQuery}%`))
    }

    const rawMemories = await db
      .select()
      .from(memory)
      .where(and(...conditions))
      .orderBy(memory.createdAt)
      .limit(limit)

    const enrichedMemories = rawMemories.map((mem) => ({
      conversationId: mem.key,
      data: mem.data,
    }))

    logger.info(
      `[${requestId}] Found ${enrichedMemories.length} memories for workspace: ${workspaceId}`
    )
    return NextResponse.json(
      { success: true, data: { memories: enrichedMemories } },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error searching memories`, { error })
    return NextResponse.json(
      { success: false, error: { message: error.message || 'Failed to search memories' } },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized memory creation attempt`)
      return NextResponse.json(
        { success: false, error: { message: authResult.error || 'Authentication required' } },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { key, data, workspaceId } = body

    if (!key) {
      return NextResponse.json(
        { success: false, error: { message: 'Memory key is required' } },
        { status: 400 }
      )
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: { message: 'Memory data is required' } },
        { status: 400 }
      )
    }

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: { message: 'workspaceId is required' } },
        { status: 400 }
      )
    }

    const access = await checkWorkspaceAccess(workspaceId, authResult.userId)
    if (!access.exists) {
      return NextResponse.json(
        { success: false, error: { message: 'Workspace not found' } },
        { status: 404 }
      )
    }
    if (!access.hasAccess) {
      return NextResponse.json(
        { success: false, error: { message: 'Access denied to this workspace' } },
        { status: 403 }
      )
    }

    if (!access.canWrite) {
      return NextResponse.json(
        { success: false, error: { message: 'Write access denied to this workspace' } },
        { status: 403 }
      )
    }

    const dataToValidate = Array.isArray(data) ? data : [data]

    for (const msg of dataToValidate) {
      if (!msg || typeof msg !== 'object' || !msg.role || !msg.content) {
        return NextResponse.json(
          { success: false, error: { message: 'Memory requires messages with role and content' } },
          { status: 400 }
        )
      }

      if (!['user', 'assistant', 'system'].includes(msg.role)) {
        return NextResponse.json(
          { success: false, error: { message: 'Message role must be user, assistant, or system' } },
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
        workspaceId,
        key,
        data: initialData,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memory.workspaceId, memory.key],
        set: {
          data: sql`${memory.data} || ${JSON.stringify(initialData)}::jsonb`,
          updatedAt: now,
        },
      })

    logger.info(`[${requestId}] Memory operation successful: ${key} for workspace: ${workspaceId}`)

    const allMemories = await db
      .select()
      .from(memory)
      .where(
        and(eq(memory.key, key), eq(memory.workspaceId, workspaceId), isNull(memory.deletedAt))
      )
      .orderBy(memory.createdAt)

    if (allMemories.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'Failed to retrieve memory after creation/update' } },
        { status: 500 }
      )
    }

    const memoryRecord = allMemories[0]

    return NextResponse.json(
      { success: true, data: { conversationId: memoryRecord.key, data: memoryRecord.data } },
      { status: 200 }
    )
  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json(
        { success: false, error: { message: 'Memory with this key already exists' } },
        { status: 409 }
      )
    }

    logger.error(`[${requestId}] Error creating memory`, { error })
    return NextResponse.json(
      { success: false, error: { message: error.message || 'Failed to create memory' } },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized memory deletion attempt`)
      return NextResponse.json(
        { success: false, error: { message: authResult.error || 'Authentication required' } },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const workspaceId = url.searchParams.get('workspaceId')
    const conversationId = url.searchParams.get('conversationId')

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: { message: 'workspaceId parameter is required' } },
        { status: 400 }
      )
    }

    if (!conversationId) {
      return NextResponse.json(
        { success: false, error: { message: 'conversationId must be provided' } },
        { status: 400 }
      )
    }

    const access = await checkWorkspaceAccess(workspaceId, authResult.userId)
    if (!access.exists) {
      return NextResponse.json(
        { success: false, error: { message: 'Workspace not found' } },
        { status: 404 }
      )
    }
    if (!access.hasAccess) {
      return NextResponse.json(
        { success: false, error: { message: 'Access denied to this workspace' } },
        { status: 403 }
      )
    }

    if (!access.canWrite) {
      return NextResponse.json(
        { success: false, error: { message: 'Write access denied to this workspace' } },
        { status: 403 }
      )
    }

    const result = await db
      .delete(memory)
      .where(and(eq(memory.key, conversationId), eq(memory.workspaceId, workspaceId)))
      .returning({ id: memory.id })

    const deletedCount = result.length

    logger.info(`[${requestId}] Deleted ${deletedCount} memories for workspace: ${workspaceId}`)
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
      { success: false, error: { message: error.message || 'Failed to delete memories' } },
      { status: 500 }
    )
  }
}
