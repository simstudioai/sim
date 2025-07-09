import { sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCopilotConfig, getCopilotModel } from '@/lib/copilot/config'
import { createLogger } from '@/lib/logs/console-logger'
import { generateEmbeddings } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { docsEmbeddings } from '@/db/schema'
import { executeProviderRequest } from '@/providers'
import { getApiKey } from '@/providers/utils'

const logger = createLogger('DocsRAG')

const DocsQuerySchema = z.object({
  query: z.string().min(1, 'Query is required'),
  topK: z.number().min(1).max(20).default(10),
  provider: z.string().optional(), // Allow override of provider per request
  model: z.string().optional(), // Allow override of model per request
  stream: z.boolean().optional().default(false), // Enable streaming responses
})

/**
 * Generate embedding for search query
 */
async function generateSearchEmbedding(query: string): Promise<number[]> {
  try {
    const embeddings = await generateEmbeddings([query])
    return embeddings[0] || []
  } catch (error) {
    logger.error('Failed to generate search embedding:', error)
    throw new Error('Failed to generate search embedding')
  }
}

/**
 * Search docs embeddings using vector similarity
 */
async function searchDocs(queryEmbedding: number[], topK: number) {
  try {
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

    return results
  } catch (error) {
    logger.error('Failed to search docs:', error)
    throw new Error('Failed to search docs')
  }
}

/**
 * Generate response using LLM with retrieved context
 */
async function generateResponse(
  query: string,
  chunks: any[],
  provider?: string,
  model?: string,
  stream = false,
  conversationHistory: any[] = []
): Promise<string | ReadableStream> {
  const config = getCopilotConfig()

  // Determine which provider and model to use - allow overrides
  const selectedProvider = provider || config.rag.defaultProvider
  const selectedModel = model || config.rag.defaultModel

  // Get API key using the provider utils
  let apiKey: string
  try {
    // Use rotating key directly for hosted providers
    if (selectedProvider === 'openai' || selectedProvider === 'anthropic') {
      const { getRotatingApiKey } = require('@/lib/utils')
      apiKey = getRotatingApiKey(selectedProvider)
    } else {
      apiKey = getApiKey(selectedProvider, selectedModel)
    }
  } catch (error) {
    logger.error(`Failed to get API key for ${selectedProvider} ${selectedModel}:`, error)
    throw new Error(
      `API key not configured for ${selectedProvider}. Please set up API keys for this provider or use a different one.`
    )
  }

  // Format chunks as context with numbered sources
  const context = chunks
    .map((chunk, index) => {
      // Ensure all chunk properties are strings to avoid object serialization
      const headerText =
        typeof chunk.headerText === 'string'
          ? chunk.headerText
          : String(chunk.headerText || 'Untitled Section')
      const sourceDocument =
        typeof chunk.sourceDocument === 'string'
          ? chunk.sourceDocument
          : String(chunk.sourceDocument || 'Unknown Document')
      const sourceLink =
        typeof chunk.sourceLink === 'string' ? chunk.sourceLink : String(chunk.sourceLink || '#')
      const chunkText =
        typeof chunk.chunkText === 'string' ? chunk.chunkText : String(chunk.chunkText || '')

      return `[${index + 1}] ${headerText}
Document: ${sourceDocument}
URL: ${sourceLink}
Content: ${chunkText}`
    })
    .join('\n\n')

  // Build conversation context if we have history
  let conversationContext = ''
  if (conversationHistory.length > 0) {
    conversationContext = '\n\nConversation History:\n'
    conversationHistory.slice(-config.general.maxConversationHistory).forEach((msg: any) => {
      // Use config for conversation history limit
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

The sources are numbered [1] through [${chunks.length}] in the context below.`

  const userPrompt = `${conversationContext}Current Question: ${query}

Documentation Context:
${context}`

  try {
    logger.info(`Generating response using provider: ${selectedProvider}, model: ${selectedModel}`)

    const providerRequest = {
      model: selectedModel,
      systemPrompt,
      context: userPrompt,
      temperature: config.rag.temperature,
      maxTokens: config.rag.maxTokens,
      apiKey,
      stream,
    }

    const response = await executeProviderRequest(selectedProvider, providerRequest)

    // Handle different response types
    if (response instanceof ReadableStream) {
      if (stream) {
        return response // Return the stream directly for streaming requests
      }
      throw new Error('Unexpected streaming response when non-streaming was requested')
    }

    if ('stream' in response && 'execution' in response) {
      // Handle StreamingExecution for providers like Anthropic
      if (stream) {
        return response.stream // Return the stream from StreamingExecution
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

    return cleanedContent
  } catch (error) {
    logger.error('Failed to generate LLM response:', error)
    throw new Error(
      `Failed to generate response using ${selectedProvider}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * POST /api/docs/ask
 * Ask questions about Sim Studio documentation using RAG (no chat functionality)
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const body = await req.json()
    const { query, topK, provider, model, stream } = DocsQuerySchema.parse(body)

    const config = getCopilotConfig()
    const ragConfig = getCopilotModel('rag')

    logger.info(`[${requestId}] Docs RAG query: "${query}"`, {
      provider: provider || ragConfig.provider,
      model: model || ragConfig.model,
      topK,
    })

    // Step 1: Generate embedding for the query
    logger.info(`[${requestId}] Generating query embedding...`)
    const queryEmbedding = await generateSearchEmbedding(query)

    if (queryEmbedding.length === 0) {
      return NextResponse.json({ error: 'Failed to generate query embedding' }, { status: 500 })
    }

    // Step 2: Search for relevant docs chunks
    logger.info(`[${requestId}] Searching docs for top ${topK} chunks...`)
    const chunks = await searchDocs(queryEmbedding, topK)

    if (chunks.length === 0) {
      return NextResponse.json({
        success: true,
        response:
          "I couldn't find any relevant documentation for your question. Please try rephrasing your query or check if you're asking about a feature that exists in Sim Studio.",
        sources: [],
        metadata: {
          requestId,
          chunksFound: 0,
          query,
          provider: provider || ragConfig.provider,
          model: model || ragConfig.model,
        },
      })
    }

    // Step 3: Generate response using LLM
    logger.info(`[${requestId}] Generating LLM response with ${chunks.length} chunks...`)
    const response = await generateResponse(query, chunks, provider, model, stream, [])

    // Step 4: Format sources for response
    const sources = chunks.map((chunk) => ({
      title: chunk.headerText,
      document: chunk.sourceDocument,
      link: chunk.sourceLink,
      similarity: Math.round(chunk.similarity * 100) / 100,
    }))

    // Handle streaming response
    if (response instanceof ReadableStream) {
      logger.info(`[${requestId}] Returning streaming response`)

      const encoder = new TextEncoder()
      const decoder = new TextDecoder()

      return new Response(
        new ReadableStream({
          async start(controller) {
            const reader = response.getReader()

            // Send initial metadata
            const metadata = {
              type: 'metadata',
              sources,
              metadata: {
                requestId,
                chunksFound: chunks.length,
                query,
                topSimilarity: sources[0]?.similarity,
                provider: provider || ragConfig.provider,
                model: model || ragConfig.model,
              },
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`))

            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunkText = decoder.decode(value)
                const cleanedChunk = chunkText.replace(/\[object Object\],?/g, '')

                const contentChunk = {
                  type: 'content',
                  content: cleanedChunk,
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`))
              }

              controller.enqueue(encoder.encode(`data: {"type":"done"}\n\n`))
            } catch (error) {
              logger.error(`[${requestId}] Streaming error:`, error)
              const errorChunk = {
                type: 'error',
                error: 'Streaming failed',
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`))
            } finally {
              controller.close()
            }
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        }
      )
    }

    logger.info(`[${requestId}] RAG response generated successfully`)

    return NextResponse.json({
      success: true,
      response,
      sources,
      metadata: {
        requestId,
        chunksFound: chunks.length,
        query,
        topSimilarity: sources[0]?.similarity,
        provider: provider || ragConfig.provider,
        model: model || ragConfig.model,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] RAG error:`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
