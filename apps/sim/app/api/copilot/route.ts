import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { copilotChats } from '@/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { executeProviderRequest } from '@/providers'
import { getCopilotConfig, getCopilotModel } from '@/lib/copilot/config'
import { 
  TITLE_GENERATION_SYSTEM_PROMPT, 
  TITLE_GENERATION_USER_PROMPT 
} from '@/lib/copilot/prompts'

const logger = createLogger('CopilotAPI')

// Schema for creating chats
const CreateChatSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  title: z.string().optional(),
  initialMessage: z.string().optional(),
})

// Schema for updating chats
const UpdateChatSchema = z.object({
  chatId: z.string().min(1, 'Chat ID is required'),
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        timestamp: z.string(),
        citations: z
          .array(
            z.object({
              id: z.number(),
              title: z.string(),
              url: z.string(),
              similarity: z.number().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
  title: z.string().optional(),
  previewYaml: z.string().nullable().optional(),
})

// Interface for copilot chat
interface CopilotChat {
  id: string
  title: string | null
  model: string
  messages: any[]
  messageCount: number
  previewYaml: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Generate a chat title using LLM
 */
async function generateChatTitle(userMessage: string): Promise<string> {
  try {
    const { provider, model } = getCopilotModel('title')
    
    // Get the appropriate API key for the provider
    let apiKey: string | undefined
    if (provider === 'anthropic') {
      // Use rotating API key for Anthropic
      const { getRotatingApiKey } = require('@/lib/utils')
      try {
        apiKey = getRotatingApiKey('anthropic')
        logger.debug(`Using rotating API key for Anthropic title generation`)
      } catch (e) {
        // If rotation fails, let the provider handle it
        logger.warn(`Failed to get rotating API key for Anthropic:`, e)
      }
    }
    
    const response = await executeProviderRequest(provider, {
      model,
      systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
      context: TITLE_GENERATION_USER_PROMPT(userMessage),
      temperature: 0.3,
      maxTokens: 50,
      apiKey: apiKey || '', // Use rotating key or empty string
      stream: false,
    })

    if (typeof response === 'object' && 'content' in response) {
      return response.content?.trim() || 'New Chat'
    }

    return 'New Chat'
  } catch (error) {
    logger.error('Failed to generate chat title:', error)
    return 'New Chat'
  }
}

/**
 * GET /api/copilot
 * List chats or get a specific chat
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const chatId = searchParams.get('chatId')

    // If chatId is provided, get specific chat
    if (chatId) {
      const [chat] = await db
        .select()
        .from(copilotChats)
        .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
        .limit(1)

      if (!chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      const copilotChat: CopilotChat = {
        id: chat.id,
        title: chat.title,
        model: chat.model,
        messages: Array.isArray(chat.messages) ? chat.messages : [],
        messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
        previewYaml: chat.previewYaml,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      }

      return NextResponse.json({
        success: true,
        chat: copilotChat,
      })
    }

    // Otherwise, list chats
    const workflowId = searchParams.get('workflowId')
    const limit = Number.parseInt(searchParams.get('limit') || '50')
    const offset = Number.parseInt(searchParams.get('offset') || '0')

    if (!workflowId) {
      return NextResponse.json(
        { error: 'workflowId is required for listing chats' },
        { status: 400 }
      )
    }

    const chats = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.userId, session.user.id), eq(copilotChats.workflowId, workflowId)))
      .orderBy(desc(copilotChats.createdAt))
      .limit(limit)
      .offset(offset)

    const formattedChats: CopilotChat[] = chats.map(chat => ({
      id: chat.id,
      title: chat.title,
      model: chat.model,
      messages: Array.isArray(chat.messages) ? chat.messages : [],
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
      previewYaml: chat.previewYaml,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    }))

    return NextResponse.json({
      success: true,
      chats: formattedChats,
    })
  } catch (error) {
    logger.error('Failed to handle GET request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/copilot
 * Create a new chat
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { workflowId, title, initialMessage } = CreateChatSchema.parse(body)

    const { provider, model } = getCopilotModel('chat')

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
        title: title || null,
        model,
        messages: initialMessages,
      })
      .returning()

    if (!newChat) {
      throw new Error('Failed to create chat')
    }

    const copilotChat: CopilotChat = {
      id: newChat.id,
      title: newChat.title,
      model: newChat.model,
      messages: Array.isArray(newChat.messages) ? newChat.messages : [],
      messageCount: Array.isArray(newChat.messages) ? newChat.messages.length : 0,
      previewYaml: newChat.previewYaml,
      createdAt: newChat.createdAt,
      updatedAt: newChat.updatedAt,
    }

    logger.info(`Created chat ${copilotChat.id} for user ${session.user.id}`)

    return NextResponse.json({
      success: true,
      chat: copilotChat,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to create chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/copilot
 * Update a chat with new messages
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { chatId, messages, title, previewYaml } = UpdateChatSchema.parse(body)

    logger.info(`Updating chat ${chatId} for user ${session.user.id}`)

    // Get the current chat to check if it has a title
    const [existingChat] = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .limit(1)

    if (!existingChat) {
      return NextResponse.json({ error: 'Chat not found or access denied' }, { status: 404 })
    }

    let titleToUse = title

    // Generate title if chat doesn't have one and we have messages
    if (!titleToUse && !existingChat.title && messages && messages.length > 0) {
      const firstUserMessage = messages.find((msg) => msg.role === 'user')
      if (firstUserMessage) {
        logger.info('Generating LLM-based title for chat without title')
        try {
          titleToUse = await generateChatTitle(firstUserMessage.content)
          logger.info(`Generated title: ${titleToUse}`)
        } catch (error) {
          logger.error('Failed to generate chat title:', error)
          titleToUse = 'New Chat'
        }
      }
    }

    // Build update object
    const updateData: any = {
      updatedAt: new Date(),
    }

    if (messages !== undefined) {
      updateData.messages = messages
    }

    if (titleToUse !== undefined) {
      updateData.title = titleToUse
    }

    if (previewYaml !== undefined) {
      updateData.previewYaml = previewYaml
    }

    const [updatedChat] = await db
      .update(copilotChats)
      .set(updateData)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .returning()

    if (!updatedChat) {
      return NextResponse.json({ error: 'Failed to update chat' }, { status: 500 })
    }

    const copilotChat: CopilotChat = {
      id: updatedChat.id,
      title: updatedChat.title,
      model: updatedChat.model,
      messages: Array.isArray(updatedChat.messages) ? updatedChat.messages : [],
      messageCount: Array.isArray(updatedChat.messages) ? updatedChat.messages.length : 0,
      previewYaml: updatedChat.previewYaml,
      createdAt: updatedChat.createdAt,
      updatedAt: updatedChat.updatedAt,
    }

    return NextResponse.json({
      success: true,
      chat: copilotChat,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to update chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/copilot
 * Delete a chat
 */
export async function DELETE(req: NextRequest) {
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

    const result = await db
      .delete(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
      .returning({ id: copilotChats.id })

    if (result.length === 0) {
      return NextResponse.json({ error: 'Chat not found or access denied' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'Chat deleted successfully',
    })
  } catch (error) {
    logger.error('Failed to delete chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 