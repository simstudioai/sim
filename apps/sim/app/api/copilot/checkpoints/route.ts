import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { copilotChats, workflowCheckpoints } from '@/db/schema'

const logger = createLogger('WorkflowCheckpointsAPI')

const CreateCheckpointSchema = z.object({
  workflowId: z.string(),
  chatId: z.string(),
  messageId: z.string().optional(), // ID of the user message that triggered this checkpoint
  workflowState: z.string(), // JSON stringified workflow state
})

/**
 * POST /api/copilot/checkpoints
 * Create a new checkpoint with JSON workflow state
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { workflowId, chatId, messageId, workflowState } = CreateCheckpointSchema.parse(body)

    logger.info(`[${requestId}] Creating workflow checkpoint`, {
      userId: session.user.id,
      workflowId,
      chatId,
      messageId,
      fullRequestBody: body,
      parsedData: { workflowId, chatId, messageId },
      messageIdType: typeof messageId,
      messageIdExists: !!messageId,
    })

    // Verify that the chat belongs to the user
    const [chat] = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .limit(1)

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found or unauthorized' }, { status: 404 })
    }

    // Parse the workflow state to validate it's valid JSON
    let parsedWorkflowState
    try {
      parsedWorkflowState = JSON.parse(workflowState)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid workflow state JSON' }, { status: 400 })
    }

    // Create checkpoint with JSON workflow state
    const [checkpoint] = await db
      .insert(workflowCheckpoints)
      .values({
        userId: session.user.id,
        workflowId,
        chatId,
        messageId,
        workflowState: parsedWorkflowState, // Store as JSON object
      })
      .returning()

    logger.info(`[${requestId}] Workflow checkpoint created successfully`, {
      checkpointId: checkpoint.id,
      savedData: {
        checkpointId: checkpoint.id,
        userId: checkpoint.userId,
        workflowId: checkpoint.workflowId,
        chatId: checkpoint.chatId,
        messageId: checkpoint.messageId,
        createdAt: checkpoint.createdAt,
      },
    })

    return NextResponse.json({
      success: true,
      checkpoint: {
        id: checkpoint.id,
        userId: checkpoint.userId,
        workflowId: checkpoint.workflowId,
        chatId: checkpoint.chatId,
        messageId: checkpoint.messageId,
        createdAt: checkpoint.createdAt,
        updatedAt: checkpoint.updatedAt,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to create workflow checkpoint:`, error)
    return NextResponse.json({ error: 'Failed to create checkpoint' }, { status: 500 })
  }
}

/**
 * GET /api/copilot/checkpoints?chatId=xxx
 * Retrieve workflow checkpoints for a chat
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const chatId = searchParams.get('chatId')

    if (!chatId) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 })
    }

    logger.info(`[${requestId}] Fetching workflow checkpoints for chat`, {
      userId: session.user.id,
      chatId,
    })

    // Fetch checkpoints for this user and chat
    const checkpoints = await db
      .select({
        id: workflowCheckpoints.id,
        userId: workflowCheckpoints.userId,
        workflowId: workflowCheckpoints.workflowId,
        chatId: workflowCheckpoints.chatId,
        messageId: workflowCheckpoints.messageId,
        createdAt: workflowCheckpoints.createdAt,
        updatedAt: workflowCheckpoints.updatedAt,
      })
      .from(workflowCheckpoints)
      .where(
        and(eq(workflowCheckpoints.chatId, chatId), eq(workflowCheckpoints.userId, session.user.id))
      )
      .orderBy(desc(workflowCheckpoints.createdAt))

    logger.info(`[${requestId}] Retrieved ${checkpoints.length} workflow checkpoints`)

    return NextResponse.json({
      success: true,
      checkpoints,
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch workflow checkpoints:`, error)
    return NextResponse.json({ error: 'Failed to fetch checkpoints' }, { status: 500 })
  }
}
