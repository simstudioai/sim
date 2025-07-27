import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { verifyInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { apiKey as apiKeyTable, copilotCheckpoints, workflow } from '@/db/schema'

const logger = createLogger('CopilotCheckpointsAPI')

/**
 * GET /api/copilot/checkpoints
 * List checkpoints for a specific chat
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    // Check for internal JWT token for server-side calls
    const authHeader = request.headers.get('authorization')
    let isInternalCall = false

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      isInternalCall = await verifyInternalToken(token)
    }

    let authenticatedUserId: string | null = null

    if (isInternalCall) {
      // For internal calls, we need chatId to determine context
      const { searchParams } = new URL(request.url)
      const chatId = searchParams.get('chatId')
      
      if (!chatId) {
        return NextResponse.json({ error: 'chatId required for internal calls' }, { status: 400 })
      }
      
      // Get the first checkpoint for this chat to determine the user
      const [firstCheckpoint] = await db
        .select({ userId: copilotCheckpoints.userId })
        .from(copilotCheckpoints)
        .where(eq(copilotCheckpoints.chatId, chatId))
        .limit(1)
      
      if (!firstCheckpoint) {
        return NextResponse.json({ error: 'No checkpoints found for chat' }, { status: 404 })
      }
      authenticatedUserId = firstCheckpoint.userId
    } else {
      // Try session auth first (for web UI)
      const session = await getSession()
      authenticatedUserId = session?.user?.id || null

      // If no session, check for API key auth
      if (!authenticatedUserId) {
        const apiKeyHeader = request.headers.get('x-api-key')
        if (apiKeyHeader) {
          // Verify API key
          const [apiKeyRecord] = await db
            .select({ userId: apiKeyTable.userId })
            .from(apiKeyTable)
            .where(eq(apiKeyTable.key, apiKeyHeader))
            .limit(1)

          if (apiKeyRecord) {
            authenticatedUserId = apiKeyRecord.userId
          }
        }
      }

      if (!authenticatedUserId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // TypeScript assertion: authenticatedUserId is guaranteed non-null at this point
    const userId = authenticatedUserId as string

    const { searchParams } = new URL(request.url)
    const chatId = searchParams.get('chatId')
    const limit = Number(searchParams.get('limit')) || 10
    const offset = Number(searchParams.get('offset')) || 0

    if (!chatId) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 })
    }

    logger.info(`[${requestId}] Listing checkpoints for chat: ${chatId}`, {
      userId,
      limit,
      offset,
    })

    const checkpoints = await db
      .select()
      .from(copilotCheckpoints)
      .where(
        and(eq(copilotCheckpoints.userId, userId), eq(copilotCheckpoints.chatId, chatId))
      )
      .orderBy(desc(copilotCheckpoints.createdAt))
      .limit(limit)
      .offset(offset)

    // Format timestamps to ISO strings for consistent timezone handling
    const formattedCheckpoints = checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      userId: checkpoint.userId,
      workflowId: checkpoint.workflowId,
      chatId: checkpoint.chatId,
      yaml: checkpoint.yaml,
      createdAt: checkpoint.createdAt.toISOString(),
      updatedAt: checkpoint.updatedAt.toISOString(),
    }))

    return NextResponse.json({ checkpoints: formattedCheckpoints })
  } catch (error) {
    logger.error(`[${requestId}] Error listing checkpoints:`, error)
    return NextResponse.json({ error: 'Failed to list checkpoints' }, { status: 500 })
  }
}
