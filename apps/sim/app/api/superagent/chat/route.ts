import { db } from '@sim/db'
import { account, superagentChats, workflow } from '@sim/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { env } from '@/lib/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { generateChatTitle } from '@/lib/sim-agent/utils'
import { generateRequestId } from '@/lib/utils'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { executeProviderRequest } from '@/providers'
import { tools } from '@/tools/registry'

const logger = createLogger('SuperagentChatAPI')

/**
 * Built-in superagent tool names
 */
const BUILTIN_TOOL_NAMES = [
  'list_user_workflows',
  'get_workflow_by_name',
  'run_workflow',
  'get_credentials',
  'set_environment_variables',
]

/**
 * Execute a built-in superagent tool
 */
async function executeBuiltinTool(
  toolName: string,
  toolInput: Record<string, any>,
  context: { userId: string; workspaceId: string }
): Promise<{ success: boolean; output: any; error?: string } | null> {
  const { userId, workspaceId } = context

  // Return null if not a built-in tool (will fall back to executeTool)
  if (!BUILTIN_TOOL_NAMES.includes(toolName)) {
    return null
  }

  logger.info('Executing built-in superagent tool', { toolName, workspaceId })

  switch (toolName) {
    case 'list_user_workflows': {
      const workflows = await db
        .select({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          createdAt: workflow.createdAt,
          updatedAt: workflow.updatedAt,
        })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))
        .orderBy(sql`${workflow.updatedAt} DESC`)

      return {
        success: true,
        output: {
          workflows: workflows.map((w) => ({
            id: w.id,
            name: w.name,
            description: w.description,
            createdAt: w.createdAt.toISOString(),
            updatedAt: w.updatedAt.toISOString(),
          })),
          total: workflows.length,
        },
      }
    }

    case 'get_workflow_by_name': {
      const workflowName = toolInput.workflow_name
      if (!workflowName) {
        return { success: false, output: null, error: 'workflow_name is required' }
      }

      const workflows = await db
        .select()
        .from(workflow)
        .where(and(eq(workflow.workspaceId, workspaceId), eq(workflow.name, workflowName)))
        .limit(1)

      if (workflows.length === 0) {
        return { success: false, output: null, error: `Workflow "${workflowName}" not found` }
      }

      const w = workflows[0]
      return {
        success: true,
        output: {
          id: w.id,
          name: w.name,
          description: w.description,
          createdAt: w.createdAt.toISOString(),
          updatedAt: w.updatedAt.toISOString(),
        },
      }
    }

    case 'run_workflow': {
      const workflowId = toolInput.workflow_id
      if (!workflowId) {
        return { success: false, output: null, error: 'workflow_id is required' }
      }

      const baseUrl = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const response = await fetch(`${baseUrl}/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: toolInput.input || {},
          triggerType: 'api',
          useDraftState: false,
        }),
      })

      const data = await response.json()
      return {
        success: data?.success ?? false,
        output: {
          workflowId: data?.workflowId,
          workflowName: data?.workflowName,
          output: data?.output ?? {},
          duration: data?.metadata?.duration,
        },
        error: data?.error,
      }
    }

    case 'get_credentials': {
      const result = await getCredentialsServerTool.execute({}, { userId })
      return { success: true, output: result }
    }

    case 'set_environment_variables': {
      const variables = toolInput.variables
      if (!variables || typeof variables !== 'object') {
        return { success: false, output: null, error: 'variables is required' }
      }

      const result = await setEnvironmentVariablesServerTool.execute({ variables }, { userId })
      return { success: true, output: result }
    }

    default:
      return null
  }
}

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
    const chats = await db
      .select()
      .from(superagentChats)
      .where(eq(superagentChats.id, chatId))
      .limit(1)

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
    const title = currentMessages.length === 0 ? await generateChatTitle(userMessage) : chat.title

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

    // Get credentials and pre-fetch access tokens + environment variables
    let credentialsText = ''
    const accessTokenMap: Record<string, string> = {} // provider -> accessToken
    let decryptedEnvVars: Record<string, string> = {} // env var name -> decrypted value
    let envVarNames: string[] = []

    try {
      logger.info('Fetching credentials', { userId })
      const credentialsResult = await getCredentialsServerTool.execute({ userId }, { userId })

      logger.info('Credentials fetched', {
        oauthCount: credentialsResult.oauth?.credentials?.length || 0,
        envVarCount: credentialsResult.environment?.count || 0,
      })

      const oauthCreds = credentialsResult.oauth?.credentials || []

      // Pre-fetch access tokens for all OAuth credentials
      const requestId = generateRequestId()
      for (const cred of oauthCreds) {
        try {
          const accounts = await db.select().from(account).where(eq(account.id, cred.id)).limit(1)

          if (accounts.length > 0) {
            const acc = accounts[0]
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

      // Fetch decrypted environment variables for API keys
      try {
        decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)
        envVarNames = Object.keys(decryptedEnvVars)
        logger.info('Fetched decrypted environment variables', {
          count: Object.keys(decryptedEnvVars).length,
          keys: Object.keys(decryptedEnvVars),
        })
      } catch (error) {
        logger.warn('Failed to fetch decrypted environment variables', {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      logger.info('Pre-fetched credentials', {
        providersWithTokens: Object.keys(accessTokenMap),
        tokenCount: Object.keys(accessTokenMap).length,
        envVarCount: Object.keys(decryptedEnvVars).length,
      })

      credentialsText = `\n\n**Available Credentials:**\n`
      if (oauthCreds.length > 0) {
        credentialsText += `\nOAuth Integrations (connected):\n${oauthCreds
          .map((c: any) => `- ${c.name} (${c.provider})`)
          .join('\n')}`
      }
      if (envVarNames.length > 0) {
        credentialsText += `\n\nAPI Keys Configured:\n${envVarNames.map((v: string) => `- ${v}`).join('\n')}`
      }
      if (oauthCreds.length === 0 && envVarNames.length === 0) {
        credentialsText = '\n\n**No credentials or API keys configured yet.**'
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

    // Workflow and credential management tools (non-deferred, always available)
    const workflowTools = [
      {
        name: 'list_user_workflows',
        description:
          'List all workflows available to the user in the current workspace. Returns workflow names and IDs. Use this to discover what workflows exist before running or inspecting them.',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_workflow_by_name',
        description:
          'Get detailed information about a specific workflow by its name. Returns the workflow structure including blocks, edges, and configuration. Use this after list_user_workflows to inspect a specific workflow.',
        input_schema: {
          type: 'object',
          properties: {
            workflow_name: {
              type: 'string',
              description: 'The exact name of the workflow to retrieve',
            },
          },
          required: ['workflow_name'],
        },
      },
      {
        name: 'run_workflow',
        description:
          'Execute a workflow by its ID with optional input parameters. The workflow will run and return its output. Use list_user_workflows first to get workflow IDs.',
        input_schema: {
          type: 'object',
          properties: {
            workflow_id: {
              type: 'string',
              description: 'The ID of the workflow to execute',
            },
            input: {
              type: 'object',
              description:
                'Optional input parameters to pass to the workflow. Keys should match the workflow input field names.',
            },
          },
          required: ['workflow_id'],
        },
      },
      {
        name: 'get_credentials',
        description:
          'Get a list of all connected OAuth integrations (Google, GitHub, etc.) and configured API key names. Use this to check what credentials the user has available before attempting to use integration tools.',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'set_environment_variables',
        description:
          'Set or update environment variables (API keys, secrets) for the user. Variables are encrypted and stored securely. Use this when the user wants to configure an API key.',
        input_schema: {
          type: 'object',
          properties: {
            variables: {
              type: 'object',
              description:
                'Key-value pairs of environment variables to set. Keys should be uppercase with underscores (e.g., EXA_API_KEY, OPENAI_API_KEY).',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['variables'],
        },
      },
    ]

    // Mark all integration tools with defer_loading: true
    // This means they won't be loaded into context until Claude searches for them
    const { createUserToolSchema } = await import('@/tools/params')

    /**
     * Maps environment variable names to tool API key parameters
     * Convention: {PROVIDER}_API_KEY -> apiKey for tools starting with {provider}_
     */
    const mapEnvVarsToToolParams = (
      toolId: string,
      toolConfig: any,
      envVars: Record<string, string>
    ): Record<string, string> => {
      const params: Record<string, string> = {}

      // Check if tool has an apiKey parameter that needs to be filled
      const hasApiKeyParam =
        toolConfig.params?.apiKey &&
        toolConfig.params.apiKey.visibility === 'user-only' &&
        toolConfig.params.apiKey.required

      if (!hasApiKeyParam) return params

      // Extract provider prefix from tool ID (e.g., 'exa' from 'exa_search')
      const toolPrefix = toolId.split('_')[0]?.toUpperCase()

      // Common API key environment variable patterns to check
      const envKeyPatterns = [
        `${toolPrefix}_API_KEY`, // EXA_API_KEY
        `${toolPrefix}AI_API_KEY`, // EXAAI_API_KEY
        `${toolPrefix}_KEY`, // EXA_KEY
      ]

      // Special mappings for tools with non-standard naming
      const specialMappings: Record<string, string[]> = {
        firecrawl: ['FIRECRAWL_API_KEY', 'FIRECRAWL_KEY'],
        tavily: ['TAVILY_API_KEY', 'TAVILY_KEY'],
        exa: ['EXA_API_KEY', 'EXAAI_API_KEY', 'EXA_KEY'],
        linkup: ['LINKUP_API_KEY', 'LINKUP_KEY'],
        google: ['GOOGLE_API_KEY', 'GOOGLE_SEARCH_API_KEY'],
        serper: ['SERPER_API_KEY', 'SERPER_KEY'],
        serpapi: ['SERPAPI_API_KEY', 'SERPAPI_KEY'],
        bing: ['BING_API_KEY', 'BING_SEARCH_API_KEY'],
        brave: ['BRAVE_API_KEY', 'BRAVE_SEARCH_API_KEY'],
        perplexity: ['PERPLEXITY_API_KEY', 'PPLX_API_KEY'],
        jina: ['JINA_API_KEY', 'JINA_KEY'],
      }

      // Combine standard patterns with special mappings
      const keysToCheck = [...envKeyPatterns]
      if (specialMappings[toolPrefix.toLowerCase()]) {
        keysToCheck.push(...specialMappings[toolPrefix.toLowerCase()])
      }

      // Find the first matching environment variable
      for (const envKey of keysToCheck) {
        if (envVars[envKey]) {
          params.apiKey = envVars[envKey]
          logger.info('Mapped environment variable to tool apiKey', {
            toolId,
            envKey,
            hasValue: true,
          })
          break
        }
      }

      return params
    }

    const deferredIntegrationTools = await Promise.all(
      Object.entries(tools).map(async ([toolId, toolConfig]) => {
        const preConfiguredParams: Record<string, any> = {}

        // Add OAuth access token if available
        if (toolConfig.oauth?.required && toolConfig.oauth.provider) {
          const provider = toolConfig.oauth.provider
          const accessToken = accessTokenMap[provider]

          if (accessToken) {
            preConfiguredParams.accessToken = accessToken
          }
        }

        // Map environment variables to tool parameters (for API keys)
        const envParams = mapEnvVarsToToolParams(toolId, toolConfig, decryptedEnvVars)
        Object.assign(preConfiguredParams, envParams)

        // Expose the user-facing schema so Superagent can supply user-only parameters
        const userSchema = createUserToolSchema(toolConfig)

        return {
          name: toolId, // Anthropic uses 'name' not 'id'
          description: toolConfig.description || toolConfig.name || toolId,
          input_schema: userSchema,
          defer_loading: true, // Don't load into context upfront!
          params: preConfiguredParams, // Pre-configured params (access tokens + API keys)
        }
      })
    )

    // Log a sample tool to verify schema is correct
    const sampleTool = deferredIntegrationTools.find((t) => t.name === 'google_calendar_create')
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
      toolsWithSchemas: deferredIntegrationTools.filter(
        (t) => Object.keys(t.input_schema.properties || {}).length > 0
      ).length,
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

    // Get current date for system prompt context
    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const systemPrompt = `Current date: ${currentDate}

You are a powerful AI assistant with seamless access to 600+ integrations including GitHub, Slack, Google Drive, Gmail, Calendar, Notion, Airtable, Discord, Jira, Linear, Salesforce, Stripe, HubSpot, and many more.

CRITICAL BEHAVIOR RULES:
1. NEVER mention that you are "searching for tools", "finding tools", "discovering tools", or "loading tools"
2. NEVER say things like "Let me search for the appropriate tool" or "I found the right tool"
3. Act as if you inherently know how to do everything - just DO IT
4. When you need a tool, silently search for it and use it without narrating the process
5. Respond naturally as if the capabilities are built into you

CREDENTIAL RULES:
- You may ONLY call OAuth-based tools for providers the user has already connected (see "Available Credentials" appended to the user's request). If a required credential is missing, ask the user to connect it before attempting the tool call.
- You may ONLY call API-key-based tools when the relevant API key name is listed under "API Keys Configured". If it is missing, ask the user to add it first.

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
      toolsCount: deferredIntegrationTools.length + searchTools.length + workflowTools.length,
      workflowToolsCount: workflowTools.length,
    })

    // Create custom tool executor for built-in superagent tools
    const customToolExecutor = async (toolName: string, toolInput: Record<string, any>) => {
      return executeBuiltinTool(toolName, toolInput, { userId, workspaceId })
    }

    const response = await executeProviderRequest('anthropic', {
      model,
      systemPrompt,
      messages,
      tools: [...searchTools, ...workflowTools, ...deferredIntegrationTools] as any,
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
      customToolExecutor,
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
    const toolCalls: any[] = []

    // Handle streaming - check if response has a stream property
    if (response && typeof response === 'object' && 'stream' in response) {
      logger.info('Returning streaming response to client')

      const streamResult = response as any
      const encoder = new TextEncoder()

      const stream = new ReadableStream({
        async start(controller) {
          try {
            logger.info('Starting stream iteration')

            // Send chat ID so client can track the conversation
            const chatIdChunk = { type: 'chat_id', chatId: chat.id }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chatIdChunk)}\n\n`))

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
          Connection: 'keep-alive',
        },
      })
    }

    // Non-streaming response - convert to SSE format for client compatibility
    logger.info('Converting non-streaming response to SSE format')
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send chat ID so client can track the conversation
          const chatIdChunk = { type: 'chat_id', chatId: chat.id }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chatIdChunk)}\n\n`))

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
        Connection: 'keep-alive',
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
