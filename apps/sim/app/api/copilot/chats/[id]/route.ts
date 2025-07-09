import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { getRotatingApiKey } from '@/lib/utils'
import { db } from '@/db'
import { copilotChats } from '@/db/schema'
import { executeProviderRequest } from '@/providers'

const logger = createLogger('CopilotChatAPI')

const UpdateChatSchema = z.object({
  title: z.string().optional(),
  messages: z.array(z.any()).optional(),
  model: z.string().optional(),
})

const AddMessageSchema = z.object({
  message: z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    timestamp: z.string().optional(),
    citations: z.array(z.any()).optional(),
  }),
})

/**
 * GET /api/copilot/chats/[id]
 * Get a specific copilot chat
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const chatId = params.id

    logger.info(`Getting chat ${chatId} for user ${session.user.id}`)

    const [chat] = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .limit(1)

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      chat: {
        id: chat.id,
        title: chat.title,
        model: chat.model,
        messages: chat.messages,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
      },
    })
  } catch (error) {
    logger.error('Failed to get copilot chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/copilot/chats/[id]
 * Update a copilot chat (add messages, update title, etc.)
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const chatId = params.id
    const body = await req.json()
    const { title, messages, model } = UpdateChatSchema.parse(body)

    logger.info(`Updating chat ${chatId} for user ${session.user.id}`)

    // First verify the chat exists and belongs to the user
    const [existingChat] = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .limit(1)

    if (!existingChat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Prepare update data
    const updateData: any = {
      updatedAt: new Date(),
    }

    if (title !== undefined) updateData.title = title
    if (messages !== undefined) updateData.messages = messages
    if (model !== undefined) updateData.model = model

    // Update the chat
    const [updatedChat] = await db
      .update(copilotChats)
      .set(updateData)
      .where(eq(copilotChats.id, chatId))
      .returning()

    if (!updatedChat) {
      throw new Error('Failed to update chat')
    }

    logger.info(`Updated chat ${chatId} for user ${session.user.id}`)

    return NextResponse.json({
      success: true,
      chat: {
        id: updatedChat.id,
        title: updatedChat.title,
        model: updatedChat.model,
        messages: updatedChat.messages,
        createdAt: updatedChat.createdAt,
        updatedAt: updatedChat.updatedAt,
        messageCount: Array.isArray(updatedChat.messages) ? updatedChat.messages.length : 0,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to update copilot chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/copilot/chats/[id]
 * Delete a copilot chat
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const chatId = params.id

    logger.info(`Deleting chat ${chatId} for user ${session.user.id}`)

    // First verify the chat exists and belongs to the user
    const [existingChat] = await db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .limit(1)

    if (!existingChat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Delete the chat
    await db.delete(copilotChats).where(eq(copilotChats.id, chatId))

    logger.info(`Deleted chat ${chatId} for user ${session.user.id}`)

    return NextResponse.json({
      success: true,
      message: 'Chat deleted successfully',
    })
  } catch (error) {
    logger.error('Failed to delete copilot chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Generate a chat title using LLM based on the first user message
 */
export async function generateChatTitle(userMessage: string): Promise<string> {
  try {
    const apiKey = getRotatingApiKey('anthropic')

    const response = await executeProviderRequest('anthropic', {
      model: 'claude-3-haiku-20240307', // Use faster, cheaper model for title generation
      systemPrompt:
        'You are a helpful assistant that generates concise, descriptive titles for chat conversations. Create a title that captures the main topic or question being discussed. Keep it under 50 characters and make it specific and clear.',
      context: `Generate a concise title for a conversation that starts with this user message: "${userMessage}"

Return only the title text, nothing else.`,
      temperature: 0.3,
      maxTokens: 50,
      apiKey,
      stream: false,
    })

    // Handle different response types
    if (typeof response === 'object' && 'content' in response) {
      return response.content?.trim() || 'New Chat'
    }

    return 'New Chat'
  } catch (error) {
    logger.error('Failed to generate chat title:', error)
    return 'New Chat' // Fallback title
  }
}
