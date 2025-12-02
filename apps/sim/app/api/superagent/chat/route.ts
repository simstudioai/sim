import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { createLogger } from '@/lib/logs/console/logger'
import { tools } from '@/tools/registry'
import { executeProviderRequest } from '@/providers'
import { env } from '@/lib/env'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { db } from '@sim/db'
import { account, superagentChats } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { generateRequestId } from '@/lib/utils'
import { generateChatTitle } from '@/lib/sim-agent/utils'
import { searchToolsDefinition } from '@/lib/superagent/search-tools'

const logger = createLogger('SuperagentChatAPI')

/**
 * Save chat messages to database
 */
async function saveChatMessages(
  chatId: string,
  userMessage: string,
  assistantResponse: string,
  toolCalls: any[]
) {
  try {
    // Fetch current chat
    const chats = await db.select().from(superagentChats).where(eq(superagentChats.id, chatId)).limit(1)
    
    if (chats.length === 0) {
      logger.error('Chat not found for saving messages', { chatId })
      return
    }
    
    const chat = chats[0]
    const currentMessages = (chat.messages as any[]) || []
    
    // Add new messages
    const updatedMessages = [
      ...currentMessages,
      {
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      },
      {
        role: 'assistant',
        content: assistantResponse,
        timestamp: Date.now(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    ]
    
    // Generate title if this is the first message
    const title = currentMessages.length === 0 
      ? await generateChatTitle(userMessage)
      : chat.title
    
    // Update chat in database
    await db
      .update(superagentChats)
      .set({
        messages: updatedMessages,
        title,
        updatedAt: new Date(),
      })
      .where(eq(superagentChats.id, chatId))
    
    logger.info('Chat messages saved', {
      chatId,
      messageCount: updatedMessages.length,
      title,
    })
  } catch (error) {
    logger.error('Failed to save chat messages', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

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
      'claude-sonnet-4-5-20250929', // Official Anthropic model name for Sonnet 4.5
    ])
    .optional()
    .default('claude-sonnet-4-5-20250929'),
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

      return new NextResponse(JSON.stringify({ chat: chats[0] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Load all chats for workspace
    const chats = await db
      .select()
      .from(superagentChats)
      .where(and(eq(superagentChats.userId, userId), eq(superagentChats.workspaceId, workspaceId)))
      .orderBy(desc(superagentChats.updatedAt))

    return new NextResponse(JSON.stringify({ chats }), {
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
 * Superagent endpoint that sends messages to Claude with all 600+ integration tools available
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

    const { message, workspaceId, chatId, model } = parsed.data
    const userId = session.user.id

    logger.info('Processing superagent message', {
      userId,
      workspaceId,
      chatId,
      model,
      messageLength: message.length,
    })

    // Load or create chat
    let chat
    let previousMessages: any[] = []
    
    if (chatId) {
      // Load existing chat
      const existingChats = await db
        .select()
        .from(superagentChats)
        .where(and(eq(superagentChats.id, chatId), eq(superagentChats.userId, userId)))
        .limit(1)
      
      if (existingChats.length > 0) {
        chat = existingChats[0]
        previousMessages = (chat.messages as any[]) || []
        logger.info('Loaded existing chat', {
          chatId,
          messageCount: previousMessages.length,
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
          title: message.slice(0, 100), // Temporary title, will be updated later
          messages: [],
          model,
        })
        .returning()
      
      chat = newChat[0]
      logger.info('Created new chat', {
        chatId: chat.id,
      })
    }

    // Get credentials and pre-fetch access tokens
    let credentialsText = ''
    const accessTokenMap: Record<string, string> = {} // provider -> accessToken
    
    try {
      logger.info('Fetching credentials', { userId })
      const credentialsResult = await getCredentialsServerTool.execute({ userId }, { userId })
      
      logger.info('Credentials fetched', {
        oauthCount: credentialsResult.oauth?.credentials?.length || 0,
        envVarCount: credentialsResult.environment?.count || 0,
      })
      
      const oauthCreds = credentialsResult.oauth?.credentials || []
      const envVars = credentialsResult.environment?.variableNames || []
      
      // Pre-fetch access tokens for all credentials
      // This avoids the need for tools to authenticate themselves
      const requestId = generateRequestId()
      for (const cred of oauthCreds) {
        try {
          // Fetch the account from database
          const accounts = await db
            .select()
            .from(account)
            .where(eq(account.id, cred.id))
            .limit(1)
          
          if (accounts.length > 0) {
            const acc = accounts[0]
            // Refresh token if needed and get fresh access token
            const { accessToken } = await refreshTokenIfNeeded(requestId, acc as any, cred.id)
            
            if (accessToken) {
              accessTokenMap[cred.provider] = accessToken
              logger.info('Pre-fetched access token', {
                provider: cred.provider,
                hasToken: !!accessToken,
              })
            }
          }
        } catch (error) {
          logger.warn('Failed to pre-fetch token for credential', {
            provider: cred.provider,
            credentialId: cred.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      
      logger.info('Pre-fetched access tokens', {
        providersWithTokens: Object.keys(accessTokenMap),
        tokenCount: Object.keys(accessTokenMap).length,
      })
      
      credentialsText = `\n\n**Available Credentials:**\n`
      if (oauthCreds.length > 0) {
        credentialsText += `\nOAuth Integrations:\n${oauthCreds.map((c: any) => `- ${c.name} (${c.provider})`).join('\n')}`
      }
      if (envVars.length > 0) {
        credentialsText += `\n\nEnvironment Variables:\n${envVars.map((v: string) => `- ${v}`).join('\n')}`
      }
      if (oauthCreds.length === 0 && envVars.length === 0) {
        credentialsText = '\n\n**No credentials configured yet.**'
      }
    } catch (error) {
      logger.warn('Failed to fetch credentials', {
        error,
        message: error instanceof Error ? error.message : String(error),
      })
      credentialsText = '\n\n**Could not fetch credentials.**'
    }

    // Build enhanced message
    const enhancedMessage = `${message}${credentialsText}`

    // Implement Anthropic's Advanced Tool Use with defer_loading
    logger.info('Setting up Anthropic tool search pattern', {
      totalToolsInRegistry: Object.keys(tools).length,
    })
    
    // Add Anthropic's native tool search tools (both BM25 and regex)
    // BM25 for better semantic search, regex for pattern matching
    const searchTools = [
      {
        type: 'tool_search_tool_bm25_20251119',
        name: 'tool_search_tool_bm25',
      },
      {
        type: 'tool_search_tool_regex_20251119',
        name: 'tool_search_tool_regex',
      },
    ]
    
    // Mark all integration tools with defer_loading: true
    // This means they won't be loaded into context until Claude searches for them
    const { createLLMToolSchema } = await import('@/tools/params')
    
    const deferredIntegrationTools = await Promise.all(
      Object.entries(tools).map(async ([toolId, toolConfig]) => {
        const preConfiguredParams: Record<string, any> = {}
        
        if (toolConfig.oauth?.required && toolConfig.oauth.provider) {
          const provider = toolConfig.oauth.provider
          const accessToken = accessTokenMap[provider]
          
          if (accessToken) {
            preConfiguredParams.accessToken = accessToken
          }
        }
        
        // Use the same schema generation as the agent block
        // This ensures LLM sees the correct parameters
        const llmSchema = await createLLMToolSchema(toolConfig, preConfiguredParams)
        
        return {
          name: toolId, // Anthropic uses 'name' not 'id'
          description: toolConfig.description || toolConfig.name || toolId,
          input_schema: llmSchema,
          defer_loading: true, // Don't load into context upfront!
          params: preConfiguredParams, // Pre-configured params (access tokens)
        }
      })
    )
    
    // Log a sample tool to verify schema is correct
    const sampleTool = deferredIntegrationTools.find(t => t.name === 'google_calendar_create')
    if (sampleTool) {
      logger.info('Sample tool schema (google_calendar_create)', {
        name: sampleTool.name,
        properties: Object.keys(sampleTool.input_schema.properties || {}),
        required: sampleTool.input_schema.required,
      })
    }
    
    logger.info('Tools configured with Anthropic defer_loading', {
      searchToolTypes: ['tool_search_tool_bm25_20251119', 'tool_search_tool_regex_20251119'],
      deferredTools: deferredIntegrationTools.length,
      toolsWithCredentials: deferredIntegrationTools.filter((t) => t.params.accessToken).length,
      toolsWithSchemas: deferredIntegrationTools.filter((t) => Object.keys(t.input_schema.properties || {}).length > 0).length,
    })

    // Build messages with previous history
    const messages = [
      ...previousMessages,
      {
        role: 'user' as const,
        content: enhancedMessage,
      },
    ]
    
    logger.info('Built message history', {
      totalMessages: messages.length,
      previousCount: previousMessages.length,
    })
    
    const systemPrompt = `You are a powerful AI assistant with seamless access to 600+ integrations including GitHub, Slack, Google Drive, Gmail, Calendar, Notion, Airtable, Discord, Jira, Linear, Salesforce, Stripe, HubSpot, and many more.

CRITICAL BEHAVIOR RULES:
1. NEVER mention that you are "searching for tools", "finding tools", "discovering tools", or "loading tools"
2. NEVER say things like "Let me search for the appropriate tool" or "I found the right tool"
3. Act as if you inherently know how to do everything - just DO IT
4. When you need a tool, silently search for it and use it without narrating the process
5. Respond naturally as if the capabilities are built into you

INTERNAL WORKFLOW (do not expose to user):
- Use tool_search_tool_bm25 or tool_search_tool_regex to find tools
- Call the discovered tools directly
- Present results naturally without mentioning the tool discovery process

GOOD RESPONSE: "I'll create that calendar event for you now." [then use tools silently]
BAD RESPONSE: "Let me search for calendar tools... I found google_calendar_quick_add..."

Be confident, capable, and seamless. You're not searching for tools - you simply HAVE the capabilities.`

    // Call provider directly
    // Use server-side API key from environment variables
    const apiKey = env.ANTHROPIC_API_KEY_1
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY_1 not configured')
    }
    
    logger.info('Calling provider API', {
      provider: 'anthropic',
      model,
      toolsCount: deferredIntegrationTools.length + 2, // +2 for BM25 and regex search tools
    })
    
    const response = await executeProviderRequest('anthropic', {
      model,
      systemPrompt,
      messages,
      tools: [...searchTools, ...deferredIntegrationTools] as any,
      temperature: 0.7,
      maxTokens: 4000,
      apiKey,
      stream: true,
      streamToolCalls: true,
      betas: ['advanced-tool-use-2025-11-20'], // Enable Anthropic's advanced tool use beta
      workflowId: undefined,
      workspaceId,
      userId,
      environmentVariables: {},
      workflowVariables: {},
      blockData: {},
      blockNameMapping: {},
    })
    
    logger.info('Provider response received', {
      hasStream: !!(response && typeof response === 'object' && 'stream' in response),
      responseType: typeof response,
      hasSuccess: !!(response && typeof response === 'object' && 'success' in response),
      hasContent: !!(response && typeof response === 'object' && 'content' in response),
      responseKeys: response && typeof response === 'object' ? Object.keys(response) : [],
    })
    
    // Track the assistant's response and tool calls for persistence
    let assistantResponse = ''
    let toolCalls: any[] = []

    // Handle streaming - check if response has a stream property
    if (response && typeof response === 'object' && 'stream' in response) {
      logger.info('Returning streaming response to client')
      
      const streamResult = response as any
      const encoder = new TextEncoder()
      
      const stream = new ReadableStream({
        async start(controller) {
          try {
            logger.info('Starting stream iteration')
            
            // Get tool calls from execution metadata
            const executionMetadata = (streamResult as any).execution
            const executedToolCalls = executionMetadata?.output?.toolCalls?.list || []
            
            // Send tool call events first
            for (const toolCall of executedToolCalls) {
              toolCalls.push({
                name: toolCall.name,
                status: toolCall.success ? 'success' : 'error',
                result: toolCall.result,
              })
              
              // Send tool call start event
              const toolCallChunk = {
                type: 'tool_call',
                name: toolCall.name,
                status: 'calling',
              }
              const toolData = `data: ${JSON.stringify(toolCallChunk)}\n\n`
              controller.enqueue(encoder.encode(toolData))
              
              // Send tool call complete event
              const toolCompleteChunk = {
                type: 'tool_call',
                name: toolCall.name,
                status: toolCall.success ? 'success' : 'error',
                result: toolCall.success ? toolCall.result : { error: toolCall.result },
              }
              const toolCompleteData = `data: ${JSON.stringify(toolCompleteChunk)}\n\n`
              controller.enqueue(encoder.encode(toolCompleteData))
            }
            
            // The Anthropic provider returns a ReadableStream with raw text chunks
            // We need to read it and convert to SSE format
            const reader = streamResult.stream.getReader()
            const decoder = new TextDecoder()
            
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              
              const text = decoder.decode(value, { stream: true })
              if (text) {
                assistantResponse += text
                
                // Send as SSE chunk
                const chunk = { type: 'text', text }
                const data = `data: ${JSON.stringify(chunk)}\n\n`
                controller.enqueue(encoder.encode(data))
              }
            }
            
            logger.info('Stream completed', { 
              totalLength: assistantResponse.length,
              toolCallsExecuted: toolCalls.length,
            })
            
            // Send done event
            const doneChunk = { type: 'done' }
            const doneData = `data: ${JSON.stringify(doneChunk)}\n\n`
            controller.enqueue(encoder.encode(doneData))
            
            // Save chat to database
            await saveChatMessages(chat.id, message, assistantResponse, toolCalls)
            
            controller.close()
          } catch (error) {
            logger.error('Streaming error', { 
              error,
              message: error instanceof Error ? error.message : String(error),
            })
            controller.error(error)
          }
        },
      })

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    // Non-streaming response - convert to SSE format for client compatibility
    logger.info('Converting non-streaming response to SSE format')
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const responseContent = (response as any).content || JSON.stringify(response)
          const responseToolCalls = (response as any).toolCalls || []
          
          // Send the content as a single SSE chunk
          const chunk = {
            type: 'content',
            content: responseContent,
          }
          const data = `data: ${JSON.stringify(chunk)}\n\n`
          controller.enqueue(encoder.encode(data))
          
          // Save chat to database
          await saveChatMessages(chat.id, message, responseContent, responseToolCalls)
          
          // Send done event
          const doneChunk = { type: 'done' }
          const doneData = `data: ${JSON.stringify(doneChunk)}\n\n`
          controller.enqueue(encoder.encode(doneData))
          
          controller.close()
        } catch (error) {
          logger.error('Error converting to SSE', { error })
          controller.error(error)
        }
      },
    })

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    logger.error('Chatbot chat error', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return new NextResponse(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
