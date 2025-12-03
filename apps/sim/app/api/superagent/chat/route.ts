import { db } from '@sim/db'
import { superagentChats } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateChatTitle } from '@/lib/copilot/chat-title'
import { SIM_AGENT_API_URL_DEFAULT, SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { env } from '@/lib/core/config/env'
import { createLogger } from '@/lib/logs/console/logger'
import { tools } from '@/tools/registry'

const logger = createLogger('SuperagentChatAPI')

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

const ProviderConfigSchema = z
  .object({
    provider: z.enum(['anthropic', 'openai', 'azure-openai']),
    model: z.string().optional(),
    apiKey: z.string().optional(),
    apiVersion: z.string().optional(),
    endpoint: z.string().optional(),
  })
  .optional()

const ContextSchema = z.object({
  type: z.string(),
  tag: z.string().optional(),
  content: z.string(),
})

const FileAttachmentSchema = z.object({
  type: z.string(),
  source: z
    .object({
      type: z.string(),
      media_type: z.string(),
      data: z.string(),
    })
    .optional(),
})

const ChatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  chatId: z.string().nullable().optional(),
  model: z
    .enum([
      'gpt-5-fast',
      'gpt-5',
      'gpt-5-medium',
      'gpt-5-high',
      'gpt-5.1-fast',
      'gpt-5.1',
      'gpt-5.1-medium',
      'gpt-5.1-high',
      'gpt-5-codex',
      'gpt-5.1-codex',
      'gpt-4o',
      'gpt-4.1',
      'o3',
      'claude-4-sonnet',
      'claude-4.5-haiku',
      'claude-4.5-sonnet',
      'claude-4.5-opus',
      'claude-4.1-opus',
      'claude-sonnet-4-5',
      'claude-sonnet-4-0',
      'claude-sonnet-4-5-20250929',
    ])
    .optional()
    .default('claude-sonnet-4-5-20250929'),
  // Optional provider config override
  provider: ProviderConfigSchema,
  // Optional contexts
  contexts: z.array(ContextSchema).optional(),
  // Optional file attachments for multimodal
  fileAttachments: z.array(FileAttachmentSchema).optional(),
})

/**
 * GET /api/superagent/chat
 * Load chat history for the workspace
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')
    const chatId = searchParams.get('chatId')

    if (!workspaceId) {
      return new NextResponse(JSON.stringify({ error: 'Workspace ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const userId = session.user.id

    if (chatId) {
      // Load specific chat
      const chats = await db
        .select()
        .from(superagentChats)
        .where(and(eq(superagentChats.id, chatId), eq(superagentChats.userId, userId)))
        .limit(1)

      if (chats.length === 0) {
        return new NextResponse(JSON.stringify({ error: 'Chat not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new NextResponse(JSON.stringify({ success: true, chat: chats[0] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Load all chats for workspace
    const chats = await db
      .select()
      .from(superagentChats)
      .where(and(eq(superagentChats.userId, userId), eq(superagentChats.workspaceId, workspaceId)))
      .orderBy(desc(superagentChats.updatedAt))

    return new NextResponse(JSON.stringify({ success: true, chats }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Failed to load chats', { error })
    return new NextResponse(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/**
 * POST /api/superagent/chat
 * Superagent endpoint - forwards to Sim Agent service with tool definitions
 */
export async function POST(req: NextRequest) {
  try {
    // Authenticate
    const session = await getSession()
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Parse request
    const body = await req.json()
    const parsed = ChatMessageSchema.safeParse(body)
    if (!parsed.success) {
      logger.error('Invalid request body', { errors: parsed.error.errors })
      return new NextResponse(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { message, workspaceId, chatId, model, provider, contexts, fileAttachments } = parsed.data
    const userId = session.user.id
    const messageId = crypto.randomUUID()

    logger.info('Processing superagent message', {
      userId,
      workspaceId,
      chatId,
      model,
      messageLength: message.length,
      hasProvider: !!provider,
      hasContexts: !!contexts?.length,
      hasFileAttachments: !!fileAttachments?.length,
    })

    // Load or create chat
    let chat
    let conversationId: string | undefined

    if (chatId) {
      // Load existing chat
      const existingChats = await db
        .select()
        .from(superagentChats)
        .where(and(eq(superagentChats.id, chatId), eq(superagentChats.userId, userId)))
        .limit(1)

      if (existingChats.length > 0) {
        chat = existingChats[0]
        conversationId = (chat as any).conversationId
        logger.info('Loaded existing chat', {
          chatId,
          hasConversationId: !!conversationId,
        })
      }
    }

    if (!chat) {
      // Create new chat
      const newChat = await db
        .insert(superagentChats)
        .values({
          userId,
          workspaceId,
          title: message.slice(0, 100),
          messages: [],
          model,
        })
        .returning()

      chat = newChat[0]
      logger.info('Created new chat', { chatId: chat.id })
    }

    // Fetch user credentials (OAuth + API keys)
    let credentials: {
      oauth: Record<string, { accessToken: string; accountId: string; name: string; expiresAt?: string }>
      apiKeys: string[]
    } | null = null
    try {
      const rawCredentials = await getCredentialsServerTool.execute({ userId }, { userId })
      
      // Transform OAuth credentials to map format: { [provider]: { accessToken, accountId, ... } }
      const oauthMap: Record<string, { accessToken: string; accountId: string; name: string; expiresAt?: string }> = {}
      for (const cred of rawCredentials?.oauth?.credentials || []) {
        if (cred.accessToken) {
          oauthMap[cred.provider] = {
            accessToken: cred.accessToken,
            accountId: cred.id,
            name: cred.name,
          }
        }
      }
      
      credentials = {
        oauth: oauthMap,
        apiKeys: rawCredentials?.environment?.variableNames || [],
      }
      
      logger.info('Fetched credentials', {
        oauthProviders: Object.keys(oauthMap),
        apiKeyCount: credentials.apiKeys.length,
      })
    } catch (error) {
      logger.warn('Failed to fetch credentials', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Build tool definitions (schemas only)
    const { createUserToolSchema } = await import('@/tools/params')

    const integrationTools = Object.entries(tools).map(([toolId, toolConfig]) => {
      const userSchema = createUserToolSchema(toolConfig)
      return {
        name: toolId,
        description: toolConfig.description || toolConfig.name || toolId,
        input_schema: userSchema,
        defer_loading: true, // Anthropic Advanced Tool Use
      }
    })

    logger.info('Built tool definitions', {
      integrationToolCount: integrationTools.length,
    })

    // Build request payload for Sim Agent
    const requestPayload = {
      message,
      messageId,
      userId,
      workspaceId,
      chatId: chat.id,
      model,
      stream: true,
      streamToolCalls: true,
      version: SIM_AGENT_VERSION,
      ...(conversationId ? { conversationId } : {}),
      ...(session?.user?.name && { userName: session.user.name }),
      // Integration tool definitions (built-in tools handled by Sim Agent)
      tools: integrationTools,
      // User credentials (OAuth connections + API key names)
      ...(credentials ? { credentials } : {}),
      // Anthropic beta features
      betas: ['advanced-tool-use-2025-11-20'],
      // Optional provider config override
      ...(provider ? { provider } : {}),
      // Optional contexts
      ...(contexts?.length ? { contexts } : {}),
      // Optional file attachments
      ...(fileAttachments?.length ? { fileAttachments } : {}),
    }

    logger.info('Calling Sim Agent', {
      endpoint: `${SIM_AGENT_API_URL}/api/superagent/chat`,
      integrationToolCount: requestPayload.tools.length,
      hasCredentials: !!credentials,
      hasConversationId: !!conversationId,
      hasProvider: !!provider,
      hasContexts: !!contexts?.length,
      hasFileAttachments: !!fileAttachments?.length,
    })

    // Call Sim Agent service
    const simAgentResponse = await fetch(`${SIM_AGENT_API_URL}/api/superagent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(requestPayload),
    })

    if (!simAgentResponse.ok) {
      if (simAgentResponse.status === 401 || simAgentResponse.status === 402) {
        return new NextResponse(null, { status: simAgentResponse.status })
      }

      const errorText = await simAgentResponse.text().catch(() => '')
      logger.error('Sim Agent API error', {
        status: simAgentResponse.status,
        error: errorText,
      })

      return NextResponse.json(
        { error: `Sim Agent API error: ${simAgentResponse.statusText}` },
        { status: simAgentResponse.status }
      )
    }

    // Stream the response back to client
    if (simAgentResponse.body) {
      const userMessage = {
        id: messageId,
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      }

      // Create pass-through stream that captures response for persistence
      const transformedStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          let assistantContent = ''
          const toolCalls: any[] = []
          let buffer = ''
          let responseConversationId: string | undefined

          // Send chat ID first so client can track
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chat_id', chatId: chat.id })}\n\n`))

          const reader = simAgentResponse.body!.getReader()
          const decoder = new TextDecoder()

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              // Forward raw chunks to client
              controller.enqueue(value)

              // Also parse for persistence
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                const jsonStr = line.slice(6).trim()
                if (!jsonStr || jsonStr === '[DONE]') continue

                try {
                  const data = JSON.parse(jsonStr)

                  // Capture content
                  if (data.type === 'content' || data.type === 'text') {
                    const chunk = data.content || data.text || data.delta || ''
                    assistantContent += chunk
                  }

                  // Capture tool calls
                  if (data.type === 'tool_call') {
                    const toolData = data.data || data
                    if (toolData.id && toolData.name) {
                      const existing = toolCalls.find((tc) => tc.id === toolData.id)
                      if (existing) {
                        if (toolData.arguments) {
                          existing.arguments = toolData.arguments
                        }
                        if (toolData.status) {
                          existing.status = toolData.status
                        }
                      } else {
                        toolCalls.push({
                          id: toolData.id,
                          name: toolData.name,
                          arguments: toolData.arguments,
                          status: toolData.status || 'pending',
                        })
                      }
                    }
                  }

                  // Capture conversation ID
                  if (data.conversationId) {
                    responseConversationId = data.conversationId
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }

            // Save chat after stream completes
            try {
              const currentMessages = ((chat as any).messages as any[]) || []
              const assistantMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: assistantContent,
                timestamp: new Date().toISOString(),
                ...(toolCalls.length > 0 && { toolCalls }),
              }

              const updatedMessages = [...currentMessages, userMessage, assistantMessage]
              const title =
                currentMessages.length === 0 ? await generateChatTitle(message) : chat.title

              await db
                .update(superagentChats)
                .set({
                  messages: updatedMessages,
                  title,
                  updatedAt: new Date(),
                  ...(responseConversationId && { conversationId: responseConversationId }),
                })
                .where(eq(superagentChats.id, chat.id))

              logger.info('Chat saved', {
                chatId: chat.id,
                messageCount: updatedMessages.length,
                hasConversationId: !!responseConversationId,
              })
            } catch (saveError) {
              logger.error('Failed to save chat', {
                chatId: chat.id,
                error: saveError instanceof Error ? saveError.message : String(saveError),
              })
            }

            controller.close()
          } catch (streamError) {
            logger.error('Stream error', {
              error: streamError instanceof Error ? streamError.message : String(streamError),
            })
            controller.error(streamError)
          }
        },
      })

      return new Response(transformedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // Non-streaming response (fallback)
    const responseData = await simAgentResponse.json()
    return NextResponse.json(responseData)
  } catch (error) {
    logger.error('Superagent chat error', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new NextResponse(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
