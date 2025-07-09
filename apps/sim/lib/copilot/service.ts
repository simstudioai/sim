import { and, desc, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { copilotChats } from '@/db/schema'
import { executeProviderRequest } from '@/providers'
import type { ProviderToolConfig } from '@/providers/types'
import { getApiKey } from '@/providers/utils'
import { getCopilotConfig, getCopilotModel } from './config'

const logger = createLogger('CopilotService')

/**
 * Message interface for copilot conversations
 */
export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: Array<{
    id: number
    title: string
    url: string
    similarity?: number
  }>
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
 * Request interface for sending messages
 */
export interface SendMessageRequest {
  message: string
  chatId?: string
  workflowId?: string
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
  citations?: Array<{
    id: number
    title: string
    url: string
    similarity?: number
  }>
  metadata?: Record<string, any>
}

/**
 * Generate a chat title using LLM
 */
export async function generateChatTitle(userMessage: string): Promise<string> {
  try {
    const { provider, model } = getCopilotModel('title')
    let apiKey: string
    try {
      // Use rotating key directly for hosted providers
      if (provider === 'openai' || provider === 'anthropic') {
        const { getRotatingApiKey } = await import('@/lib/utils')
        apiKey = getRotatingApiKey(provider)
      } else {
        apiKey = getApiKey(provider, model)
      }
    } catch (error) {
      logger.error(`Failed to get API key for title generation (${provider} ${model}):`, error)
      return 'New Chat' // Fallback if API key is not available
    }

    const response = await executeProviderRequest(provider, {
      model,
      systemPrompt:
        'You are a helpful assistant that generates concise, descriptive titles for chat conversations. Create a title that captures the main topic or question being discussed. Keep it under 50 characters and make it specific and clear.',
      context: `Generate a concise title for a conversation that starts with this user message: "${userMessage}"\n\nReturn only the title text, nothing else.`,
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
  options: {
    topK?: number
    threshold?: number
  } = {}
): Promise<
  Array<{
    id: number
    title: string
    url: string
    content: string
    similarity: number
  }>
> {
  const { generateEmbeddings } = await import('@/app/api/knowledge/utils')
  const { docsEmbeddings } = await import('@/db/schema')
  const { sql } = await import('drizzle-orm')

  const config = getCopilotConfig()
  const { topK = config.rag.maxSources, threshold = config.rag.similarityThreshold } = options

  try {
    logger.info('Documentation search requested', { query, topK, threshold })

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

    logger.info(`Found ${filteredResults.length} relevant documentation chunks`, {
      totalResults: results.length,
      afterFiltering: filteredResults.length,
      threshold,
    })

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
 * Generate documentation-based response using RAG
 */
export async function generateDocsResponse(
  query: string,
  conversationHistory: CopilotMessage[] = [],
  options: {
    stream?: boolean
    topK?: number
    provider?: string
    model?: string
    workflowId?: string
    requestId?: string
  } = {}
): Promise<{
  response: string | ReadableStream
  sources: Array<{
    id: number
    title: string
    url: string
    similarity: number
  }>
}> {
  const config = getCopilotConfig()
  const { provider, model } = getCopilotModel('rag')
  const {
    stream = config.general.streamingEnabled,
    topK = config.rag.maxSources,
    provider: overrideProvider,
    model: overrideModel,
  } = options

  const selectedProvider = overrideProvider || provider
  const selectedModel = overrideModel || model

  try {
    let apiKey: string
    try {
      // Use rotating key directly for hosted providers
      if (selectedProvider === 'openai' || selectedProvider === 'anthropic') {
        const { getRotatingApiKey } = await import('@/lib/utils')
        apiKey = getRotatingApiKey(selectedProvider)
      } else {
        apiKey = getApiKey(selectedProvider, selectedModel)
      }
    } catch (error) {
      logger.error(
        `Failed to get API key for docs response (${selectedProvider} ${selectedModel}):`,
        error
      )
      throw new Error(
        `API key not configured for ${selectedProvider}. Please set up API keys for this provider or use a different one.`
      )
    }

    // Search documentation
    const searchResults = await searchDocumentation(query, { topK })

    if (searchResults.length === 0) {
      const fallbackResponse =
        "I couldn't find any relevant documentation for your question. Please try rephrasing your query or check if you're asking about a feature that exists in Sim Studio."
      return {
        response: fallbackResponse,
        sources: [],
      }
    }

    // Format search results as context with numbered sources
    const context = searchResults
      .map((result, index) => {
        return `[${index + 1}] ${result.title}
Document: ${result.title}
URL: ${result.url}
Content: ${result.content}`
      })
      .join('\n\n')

    // Build conversation context if we have history
    let conversationContext = ''
    if (conversationHistory.length > 0) {
      conversationContext = '\n\nConversation History:\n'
      conversationHistory.slice(-config.general.maxConversationHistory).forEach((msg) => {
        const role = msg.role === 'user' ? 'Human' : 'Assistant'
        conversationContext += `${role}: ${msg.content}\n`
      })
      conversationContext += '\n'
    }

    const systemPrompt = `You are a helpful assistant that answers questions about Sim Studio documentation. You are having a conversation with the user, so refer to the conversation history when relevant.

IMPORTANT: Use inline citations strategically and sparingly. When referencing information from the sources, include the citation number in curly braces like {cite:1}, {cite:2}, etc.

Citation Guidelines:
- Cite each source only ONCE at the specific header or topic that relates to that source
- Do NOT repeatedly cite the same source throughout your response
- Place citations directly after the header or concept that the source specifically addresses
- If multiple sources support the same specific topic, cite them together like {cite:1}{cite:2}{cite:3}
- Each citation should be placed at the relevant header/topic it supports, not grouped at the beginning
- Avoid cluttering the text with excessive citations

Content Guidelines:
- Answer the user's question accurately using the provided documentation
- Consider the conversation history and refer to previous messages when relevant
- Format your response in clean, readable markdown
- Use bullet points, code blocks, and headers where appropriate
- If the question cannot be answered from the context, say so clearly
- Be conversational but precise
- NEVER include object representations like "[object Object]" - always use proper text
- When mentioning tool names, use their actual names from the documentation

The sources are numbered [1] through [${searchResults.length}] in the context below.`

    const userPrompt = `${conversationContext}Current Question: ${query}

Documentation Context:
${context}`

    logger.info(
      `Generating docs response using provider: ${selectedProvider}, model: ${selectedModel}`
    )

    const response = await executeProviderRequest(selectedProvider, {
      model: selectedModel,
      systemPrompt,
      context: userPrompt,
      temperature: config.rag.temperature,
      maxTokens: config.rag.maxTokens,
      apiKey,
      stream,
    })

    // Format sources for response
    const sources = searchResults.map((result) => ({
      id: result.id,
      title: result.title,
      url: result.url,
      similarity: Math.round(result.similarity * 100) / 100,
    }))

    // Handle different response types
    if (response instanceof ReadableStream) {
      return { response, sources }
    }

    if ('stream' in response && 'execution' in response) {
      // Handle StreamingExecution for providers like Anthropic
      if (stream) {
        return { response: response.stream, sources }
      }
      throw new Error('Unexpected streaming execution response when non-streaming was requested')
    }

    // At this point, we have a ProviderResponse
    const content = response.content || 'Sorry, I could not generate a response.'

    // Clean up any object serialization artifacts
    const cleanedContent = content
      .replace(/\[object Object\],?/g, '') // Remove [object Object] artifacts
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()

    return {
      response: cleanedContent,
      sources,
    }
  } catch (error) {
    logger.error('Failed to generate docs response:', error)
    throw new Error(
      `Failed to generate docs response: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Generate chat response using LLM with optional documentation search
 */
export async function generateChatResponse(
  message: string,
  conversationHistory: CopilotMessage[] = [],
  options: {
    stream?: boolean
    workflowId?: string
    requestId?: string
  } = {}
): Promise<string | ReadableStream> {
  const config = getCopilotConfig()
  const { provider, model } = getCopilotModel('chat')
  const { stream = config.general.streamingEnabled } = options

  try {
    let apiKey: string
    try {
      // Use rotating key directly for hosted providers
      if (provider === 'openai' || provider === 'anthropic') {
        const { getRotatingApiKey } = await import('@/lib/utils')
        apiKey = getRotatingApiKey(provider)
      } else {
        apiKey = getApiKey(provider, model)
      }
    } catch (error) {
      logger.error(`Failed to get API key for chat (${provider} ${model}):`, error)
      throw new Error(
        `API key not configured for ${provider}. Please set up API keys for this provider or use a different one.`
      )
    }

    // Build conversation context
    const messages = []

    // Add conversation history (limited by config)
    const historyLimit = config.general.maxConversationHistory
    const recentHistory = conversationHistory.slice(-historyLimit)

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

    // Define the documentation search tool for the LLM
    const tools: ProviderToolConfig[] = [
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
              description: 'Number of results to return (default: 5, max: 10)',
              default: 5,
            },
          },
          required: ['query'],
        },
      },
    ]

    const response = await executeProviderRequest(provider, {
      model,
      systemPrompt: config.chat.systemPrompt,
      messages,
      tools,
      temperature: config.chat.temperature,
      maxTokens: config.chat.maxTokens,
      apiKey,
      stream,
    })

    // Handle StreamingExecution (from providers with tool calls)
    if (
      typeof response === 'object' &&
      response &&
      'stream' in response &&
      'execution' in response
    ) {
      logger.info('Detected StreamingExecution from provider')
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
  options: {
    title?: string
    initialMessage?: string
  } = {}
): Promise<CopilotChat> {
  const config = getCopilotConfig()
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
        title: title || null, // Will be generated later if null
        model,
        messages: initialMessages,
      })
      .returning()

    if (!newChat) {
      throw new Error('Failed to create chat')
    }

    logger.info(`Created chat ${newChat.id} for user ${userId}`)

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
  options: {
    limit?: number
    offset?: number
  } = {}
): Promise<CopilotChat[]> {
  const { limit = 50, offset = 0 } = options

  try {
    const chats = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.userId, userId), eq(copilotChats.workflowId, workflowId)))
      .orderBy(desc(copilotChats.updatedAt))
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
  updates: {
    title?: string
    messages?: CopilotMessage[]
  }
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
  citations?: Array<{ id: number; title: string; url: string; similarity?: number }>
}> {
  const { message, chatId, workflowId, createNewChat, stream, userId } = request

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
    })

    // Extract citations from StreamingExecution if available
    let citations: Array<{ id: number; title: string; url: string; similarity?: number }> = []

    if (typeof response === 'object' && response && 'execution' in response) {
      // This is a StreamingExecution - extract citations from tool calls
      const execution = (response as any).execution
      logger.info('Extracting citations from StreamingExecution', {
        hasExecution: !!execution,
        hasToolResults: !!execution?.toolResults,
        toolResultsLength: execution?.toolResults?.length || 0,
      })

      if (execution?.toolResults) {
        for (const toolResult of execution.toolResults) {
          logger.info('Processing tool result for citations', {
            hasResult: !!toolResult,
            resultKeys: toolResult && typeof toolResult === 'object' ? Object.keys(toolResult) : [],
            hasResultsArray: !!(toolResult && typeof toolResult === 'object' && toolResult.results),
          })

          if (toolResult && typeof toolResult === 'object' && toolResult.results) {
            // Convert documentation search results to citations
            citations = toolResult.results.map((result: any, index: number) => ({
              id: index + 1,
              title: result.title || 'Documentation',
              url: result.url || '#',
              similarity: result.similarity,
            }))
            logger.info(`Extracted ${citations.length} citations from tool results`)
            break // Use first set of results found
          }
        }
      }
    }

    // For non-streaming responses, save immediately
    // For streaming responses, save will be handled by the API layer after stream completes
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
        citations: citations.length > 0 ? citations : undefined,
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
      citations,
    }
  } catch (error) {
    logger.error('Failed to send message:', error)
    throw error
  }
}
