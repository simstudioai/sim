import { desc, eq, and } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { copilotChats } from '@/db/schema'

const logger = createLogger('CopilotChatsAPI')

const CreateChatSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  title: z.string().optional(),
  model: z.string().optional().default('claude-3-7-sonnet-latest'),
  initialMessage: z.string().optional(), // Optional first user message
})

const ListChatsSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
})

/**
 * GET /api/copilot/chats
 * List copilot chats for a user and workflow
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const workflowId = searchParams.get('workflowId')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const { workflowId: validatedWorkflowId, limit: validatedLimit, offset: validatedOffset } = 
      ListChatsSchema.parse({ workflowId, limit, offset })

    logger.info(`Listing chats for user ${session.user.id}, workflow ${validatedWorkflowId}`)

    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        model: copilotChats.model,
        createdAt: copilotChats.createdAt,
        updatedAt: copilotChats.updatedAt,
        messageCount: copilotChats.messages, // We'll process this to get count
      })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.userId, session.user.id),
          eq(copilotChats.workflowId, validatedWorkflowId)
        )
      )
      .orderBy(desc(copilotChats.updatedAt))
      .limit(validatedLimit)
      .offset(validatedOffset)

    // Process the results to add message counts and clean up data
    const processedChats = chats.map(chat => ({
      id: chat.id,
      title: chat.title,
      model: chat.model,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: Array.isArray(chat.messageCount) ? chat.messageCount.length : 0,
    }))

    return NextResponse.json({
      success: true,
      chats: processedChats,
      pagination: {
        limit: validatedLimit,
        offset: validatedOffset,
        total: processedChats.length,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request parameters', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to list copilot chats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/copilot/chats
 * Create a new copilot chat
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { workflowId, title, model, initialMessage } = CreateChatSchema.parse(body)

    logger.info(`Creating new chat for user ${session.user.id}, workflow ${workflowId}`)

    // Prepare initial messages array
    const initialMessages = initialMessage
      ? [
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: initialMessage,
            timestamp: new Date().toISOString(),
          },
        ]
      : []

    // Create the chat
    const [newChat] = await db
      .insert(copilotChats)
      .values({
        userId: session.user.id,
        workflowId,
        title: title || null, // Will be generated later if null
        model,
        messages: initialMessages,
      })
      .returning({
        id: copilotChats.id,
        title: copilotChats.title,
        model: copilotChats.model,
        messages: copilotChats.messages,
        createdAt: copilotChats.createdAt,
        updatedAt: copilotChats.updatedAt,
      })

    if (!newChat) {
      throw new Error('Failed to create chat')
    }

    logger.info(`Created chat ${newChat.id} for user ${session.user.id}`)

    return NextResponse.json({
      success: true,
      chat: {
        id: newChat.id,
        title: newChat.title,
        model: newChat.model,
        messages: newChat.messages,
        createdAt: newChat.createdAt,
        updatedAt: newChat.updatedAt,
        messageCount: Array.isArray(newChat.messages) ? newChat.messages.length : 0,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to create copilot chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 