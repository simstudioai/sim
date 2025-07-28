import { and, desc, eq, sql } from 'drizzle-orm'
import { getCopilotConfig, getCopilotModel } from '@/lib/copilot/config'
import {
  AGENT_MODE_SYSTEM_PROMPT,
  ASK_MODE_SYSTEM_PROMPT,
  TITLE_GENERATION_SYSTEM_PROMPT,
  TITLE_GENERATION_USER_PROMPT,
  validateSystemPrompts,
} from '@/lib/copilot/prompts'
import { createLogger } from '@/lib/logs/console/logger'
import { getRotatingApiKey } from '@/lib/utils'
import { generateEmbeddings } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { copilotChats, docsEmbeddings } from '@/db/schema'
import { executeProviderRequest } from '@/providers'
import type { ProviderToolConfig } from '@/providers/types'
import { getApiKey } from '@/providers/utils'

const logger = createLogger('CopilotService')

// Validate system prompts on module load
const promptValidation = validateSystemPrompts()
if (!promptValidation.askMode.valid) {
  logger.error('Ask mode system prompt validation failed:', promptValidation.askMode.issues)
}
if (!promptValidation.agentMode.valid) {
  logger.error('Agent mode system prompt validation failed:', promptValidation.agentMode.issues)
}

/**
 * Citation information for documentation references
 */
export interface Citation {
  id: number
  title: string
  url: string
  similarity?: number
}

/**
 * Message interface for copilot conversations
 */
export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: Citation[]
}

/**
 * Chat interface for copilot conversations
 */
export interface CopilotChat {
  id: string
  title: string | null
  model: string
  messages: CopilotMessage[]
  messageCount: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Options for generating chat responses
 */
export interface GenerateChatResponseOptions {
  stream?: boolean
  workflowId?: string
  requestId?: string
  mode?: 'ask' | 'agent'
  chatId?: string
}

/**
 * Request interface for sending messages
 */
export interface SendMessageRequest {
  message: string
  chatId?: string
  workflowId?: string
  mode?: 'ask' | 'agent'
  createNewChat?: boolean
  stream?: boolean
  userId: string
}

/**
 * Response interface for sending messages
 */
export interface SendMessageResponse {
  content: string
  chatId?: string
  citations?: Citation[]
  metadata?: Record<string, any>
}

/**
 * Documentation search result
 */
export interface DocumentationSearchResult {
  id: number
  title: string
  url: string
  content: string
  similarity: number
}

/**
 * Options for creating a new chat
 */
export interface CreateChatOptions {
  title?: string
  initialMessage?: string
}

/**
 * Options for updating a chat
 */
export interface UpdateChatOptions {
  title?: string
  messages?: CopilotMessage[]
}

/**
 * Options for listing chats
 */
export interface ListChatsOptions {
  limit?: number
  offset?: number
}

/**
 * Options for documentation search
 */
export interface SearchDocumentationOptions {
  topK?: number
  threshold?: number
}

/**
 * Get API key for the given provider
 */
function getProviderApiKey(provider: string, model: string): string {
  if (provider === 'openai' || provider === 'anthropic') {
    return getRotatingApiKey(provider)
  }
  return getApiKey(provider, model)
}

/**
 * Build conversation messages for LLM
 */
function buildConversationMessages(
  message: string,
  conversationHistory: CopilotMessage[],
  maxHistory: number
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  const messages = []

  // Add conversation history (limited by config)
  const recentHistory = conversationHistory.slice(-maxHistory)

  for (const msg of recentHistory) {
    messages.push({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    })
  }

  // Add current user message
  messages.push({
    role: 'user' as const,
    content: message,
  })

  return messages
}

/**
 * Get available tools for the given mode
 */
function getAvailableTools(mode: 'ask' | 'agent'): ProviderToolConfig[] {
  const allTools: ProviderToolConfig[] = [
    {
      id: 'docs_search_internal',
      name: 'Search Documentation',
      description:
        'Search Sim Studio documentation for information about features, tools, workflows, and functionality',
      params: {},
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant documentation',
          },
          topK: {
            type: 'number',
            description: 'Number of results to return (default: 10, max: 10)',
            default: 10,
          },
        },
        required: ['query'],
      },
    },
    {
      id: 'get_user_workflow',
      name: "Get User's Specific Workflow",
      description:
        "Get the user's current workflow - this shows ONLY the blocks they have actually built and configured in their specific workflow, not general Sim Studio capabilities.",
      params: {},
      parameters: {
        type: 'object',
        properties: {
          includeMetadata: {
            type: 'boolean',
            description:
              'Whether to include additional metadata about the workflow (default: false)',
            default: false,
          },
        },
        required: [],
      },
    },
    {
      id: 'get_blocks_and_tools',
      name: 'Get All Blocks and Tools',
      description:
        'Get a comprehensive list of all available blocks and tools in Sim Studio with their descriptions, categories, and capabilities.',
      params: {},
      parameters: {
        type: 'object',
        properties: {
          includeDetails: {
            type: 'boolean',
            description:
              'Whether to include detailed information like inputs, outputs, and sub-blocks (default: false)',
            default: false,
          },
          filterCategory: {
            type: 'string',
            description: 'Optional category filter for blocks (e.g., "tools", "blocks", "ai")',
          },
        },
        required: [],
      },
    },
    {
      id: 'get_blocks_metadata',
      name: 'Get Block Metadata',
      description:
        'Get detailed metadata including descriptions, schemas, inputs, outputs, and subblocks for specific blocks and their associated tools.',
      params: {},
      parameters: {
        type: 'object',
        properties: {
          blockIds: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Array of block IDs to get metadata for',
          },
        },
        required: ['blockIds'],
      },
    },
    {
      id: 'get_yaml_structure',
      name: 'Get YAML Workflow Structure Guide',
      description:
        'Get comprehensive YAML workflow syntax guide and examples to understand how to structure Sim Studio workflows.',
      params: {},
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      id: 'edit_workflow',
      name: 'Edit Workflow',
      description:
        'Save/edit the current workflow by providing YAML content. This performs the same action as saving in the YAML code editor.',
      params: {},
      parameters: {
        type: 'object',
        properties: {
          yamlContent: {
            type: 'string',
            description: 'The complete YAML workflow content to save',
          },
          description: {
            type: 'string',
            description: 'Optional description of the changes being made',
          },
        },
        required: ['yamlContent'],
      },
    },
  ]

  // Filter tools based on mode
  return mode === 'ask' ? allTools.filter((tool) => tool.id !== 'edit_workflow') : allTools
}

/**
 * Validate system prompt for the given mode
 */
function validateSystemPrompt(mode: 'ask' | 'agent', systemPrompt: string): void {
  if (!systemPrompt || systemPrompt.length < 100) {
    throw new Error(`System prompt not properly configured for mode: ${mode}`)
  }
}

/**
 * Generate a chat title using LLM
 */
export async function generateChatTitle(userMessage: string): Promise<string> {
  try {
    const { provider, model } = getCopilotModel('title')
    const apiKey = getProviderApiKey(provider, model)

    const response = await executeProviderRequest(provider, {
      model,
      systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
      context: TITLE_GENERATION_USER_PROMPT(userMessage),
      temperature: 0.3,
      maxTokens: 50,
      apiKey,
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
 * Search documentation using RAG
 */
export async function searchDocumentation(
  query: string,
  options: SearchDocumentationOptions = {}
): Promise<DocumentationSearchResult[]> {
  const config = getCopilotConfig()
  const { topK = config.rag.maxSources, threshold = config.rag.similarityThreshold } = options

  try {
    // Generate embedding for the query
    const embeddings = await generateEmbeddings([query])
    const queryEmbedding = embeddings[0]

    if (!queryEmbedding || queryEmbedding.length === 0) {
      logger.warn('Failed to generate query embedding')
      return []
    }

    // Search docs embeddings using vector similarity
    const results = await db
      .select({
        chunkId: docsEmbeddings.chunkId,
        chunkText: docsEmbeddings.chunkText,
        sourceDocument: docsEmbeddings.sourceDocument,
        sourceLink: docsEmbeddings.sourceLink,
        headerText: docsEmbeddings.headerText,
        headerLevel: docsEmbeddings.headerLevel,
        similarity: sql<number>`1 - (${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector)`,
      })
      .from(docsEmbeddings)
      .orderBy(sql`${docsEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(topK)

    // Filter by similarity threshold
    const filteredResults = results.filter((result) => result.similarity >= threshold)

    return filteredResults.map((result, index) => ({
      id: index + 1,
      title: String(result.headerText || 'Untitled Section'),
      url: String(result.sourceLink || '#'),
      content: String(result.chunkText || ''),
      similarity: result.similarity,
    }))
  } catch (error) {
    logger.error('Failed to search documentation:', error)
    return []
  }
}

/**
 * Generate chat response using LLM with optional documentation search
 */
export async function generateChatResponse(
  message: string,
  conversationHistory: CopilotMessage[] = [],
  options: GenerateChatResponseOptions = {}
): Promise<string | ReadableStream> {
  const config = getCopilotConfig()
  const { provider, model } = getCopilotModel('chat')
  const { stream = config.general.streamingEnabled, mode = 'ask' } = options

  try {
    const apiKey = getProviderApiKey(provider, model)

    // Build conversation context
    const messages = buildConversationMessages(
      message,
      conversationHistory,
      config.general.maxConversationHistory
    )

    // Get available tools for the mode
    const tools = getAvailableTools(mode)

    // Get the appropriate system prompt for the mode
    const systemPrompt = mode === 'ask' ? ASK_MODE_SYSTEM_PROMPT : AGENT_MODE_SYSTEM_PROMPT

    // Validate system prompt
    validateSystemPrompt(mode, systemPrompt)

    const response = await executeProviderRequest(provider, {
      model,
      systemPrompt,
      messages,
      tools,
      temperature: config.chat.temperature,
      maxTokens: config.chat.maxTokens,
      apiKey,
      stream,
      streamToolCalls: true, // Enable tool call streaming for copilot
      workflowId: options.workflowId,
      chatId: options.chatId,
    })

    // Handle StreamingExecution (from providers with tool calls)
    if (
      typeof response === 'object' &&
      response &&
      'stream' in response &&
      'execution' in response
    ) {
      return (response as any).stream
    }

    // Handle ProviderResponse (non-streaming with tool calls)
    if (typeof response === 'object' && 'content' in response) {
      const content = response.content || 'Sorry, I could not generate a response.'

      // If streaming was requested, wrap the content in a ReadableStream
      if (stream) {
        return new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(encoder.encode(content))
            controller.close()
          },
        })
      }

      return content
    }

    // Handle direct ReadableStream response
    if (response instanceof ReadableStream) {
      return response
    }

    return 'Sorry, I could not generate a response.'
  } catch (error) {
    logger.error('Failed to generate chat response:', error)
    throw new Error(
      `Failed to generate response: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Create a new copilot chat
 */
export async function createChat(
  userId: string,
  workflowId: string,
  options: CreateChatOptions = {}
): Promise<CopilotChat> {
  const { provider, model } = getCopilotModel('chat')
  const { title, initialMessage } = options

  try {
    // Prepare initial messages array
    const initialMessages: CopilotMessage[] = initialMessage
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
        userId,
        workflowId,
        title: title || null,
        model,
        messages: initialMessages,
      })
      .returning()

    if (!newChat) {
      throw new Error('Failed to create chat')
    }

    return {
      id: newChat.id,
      title: newChat.title,
      model: newChat.model,
      messages: Array.isArray(newChat.messages) ? newChat.messages : [],
      messageCount: Array.isArray(newChat.messages) ? newChat.messages.length : 0,
      createdAt: newChat.createdAt,
      updatedAt: newChat.updatedAt,
    }
  } catch (error) {
    logger.error('Failed to create chat:', error)
    throw new Error(
      `Failed to create chat: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Get a specific chat
 */
export async function getChat(chatId: string, userId: string): Promise<CopilotChat | null> {
  try {
    const [chat] = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .limit(1)

    if (!chat) {
      return null
    }

    return {
      id: chat.id,
      title: chat.title,
      model: chat.model,
      messages: Array.isArray(chat.messages) ? chat.messages : [],
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    }
  } catch (error) {
    logger.error('Failed to get chat:', error)
    return null
  }
}

/**
 * List chats for a workflow
 */
export async function listChats(
  userId: string,
  workflowId: string,
  options: ListChatsOptions = {}
): Promise<CopilotChat[]> {
  const { limit = 50, offset = 0 } = options

  try {
    const chats = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.userId, userId), eq(copilotChats.workflowId, workflowId)))
      .orderBy(desc(copilotChats.createdAt))
      .limit(limit)
      .offset(offset)

    return chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      model: chat.model,
      messages: Array.isArray(chat.messages) ? chat.messages : [],
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    }))
  } catch (error) {
    logger.error('Failed to list chats:', error)
    return []
  }
}

/**
 * Update a chat (add messages, update title, etc.)
 */
export async function updateChat(
  chatId: string,
  userId: string,
  updates: UpdateChatOptions
): Promise<CopilotChat | null> {
  try {
    // Verify the chat exists and belongs to the user
    const existingChat = await getChat(chatId, userId)
    if (!existingChat) {
      return null
    }

    // Prepare update data
    const updateData: any = {
      updatedAt: new Date(),
    }

    if (updates.title !== undefined) updateData.title = updates.title
    if (updates.messages !== undefined) updateData.messages = updates.messages

    // Update the chat
    const [updatedChat] = await db
      .update(copilotChats)
      .set(updateData)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .returning()

    if (!updatedChat) {
      return null
    }

    return {
      id: updatedChat.id,
      title: updatedChat.title,
      model: updatedChat.model,
      messages: Array.isArray(updatedChat.messages) ? updatedChat.messages : [],
      messageCount: Array.isArray(updatedChat.messages) ? updatedChat.messages.length : 0,
      createdAt: updatedChat.createdAt,
      updatedAt: updatedChat.updatedAt,
    }
  } catch (error) {
    logger.error('Failed to update chat:', error)
    return null
  }
}

/**
 * Delete a chat
 */
export async function deleteChat(chatId: string, userId: string): Promise<boolean> {
  try {
    const result = await db
      .delete(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .returning({ id: copilotChats.id })

    return result.length > 0
  } catch (error) {
    logger.error('Failed to delete chat:', error)
    return false
  }
}

/**
 * Send a message and get a response
 */
export async function sendMessage(request: SendMessageRequest): Promise<{
  response: string | ReadableStream | any
  chatId?: string
}> {
  const { message, chatId, workflowId, mode, createNewChat, stream, userId } = request

  try {
    // Handle chat context
    let currentChat: CopilotChat | null = null
    let conversationHistory: CopilotMessage[] = []

    if (chatId) {
      // Load existing chat
      currentChat = await getChat(chatId, userId)
      if (currentChat) {
        conversationHistory = currentChat.messages
      }
    } else if (createNewChat && workflowId) {
      // Create new chat
      currentChat = await createChat(userId, workflowId)
    }

    // Generate chat response
    const response = await generateChatResponse(message, conversationHistory, {
      stream,
      workflowId,
      mode,
      chatId: currentChat?.id,
    })

    // For non-streaming responses, save immediately
    if (currentChat && typeof response === 'string') {
      const userMessage: CopilotMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      }

      const assistantMessage: CopilotMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
      }

      const updatedMessages = [...conversationHistory, userMessage, assistantMessage]

      // Generate title if this is the first message
      let updatedTitle = currentChat.title
      if (!updatedTitle && conversationHistory.length === 0) {
        updatedTitle = await generateChatTitle(message)
      }

      await updateChat(currentChat.id, userId, {
        title: updatedTitle || undefined,
        messages: updatedMessages,
      })
    }

    return {
      response,
      chatId: currentChat?.id,
    }
  } catch (error) {
    logger.error('Failed to send message:', error)
    throw error
  }
}

// Update existing chat messages (for streaming responses)
export async function updateChatMessages(
  chatId: string,
  messages: CopilotMessage[]
): Promise<void> {
  try {
    await db
      .update(copilotChats)
      .set({
        messages,
        updatedAt: new Date(),
      })
      .where(eq(copilotChats.id, chatId))
      .execute()
  } catch (error) {
    logger.error('Failed to update chat messages:', error)
    throw error
  }
}
