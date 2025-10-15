import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { executeProviderRequest } from '@/providers'
import { getApiKey, getProviderFromModel } from '@/providers/utils'

const logger = createLogger('HallucinationValidator')

export interface HallucinationValidationResult {
  passed: boolean
  error?: string
  score?: number
  reasoning?: string
}

export interface HallucinationValidationInput {
  userInput: string
  knowledgeBaseId: string
  threshold: number // 0-10 confidence scale, default 3 (scores below 3 fail)
  topK: number // Number of chunks to retrieve, default 10
  model: string
  apiKey?: string
  workflowId?: string
  requestId: string
}

/**
 * Query knowledge base to get relevant context chunks using the search API
 */
async function queryKnowledgeBase(
  knowledgeBaseId: string,
  query: string,
  topK: number,
  requestId: string,
  workflowId?: string
): Promise<string[]> {
  try {
    logger.info(`[${requestId}] Querying knowledge base`, {
      knowledgeBaseId,
      query: query.substring(0, 100),
      topK,
    })

    // Call the knowledge base search API directly
    const searchUrl = `${getBaseUrl()}/api/knowledge/search`

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        knowledgeBaseIds: [knowledgeBaseId],
        query,
        topK,
        workflowId,
      }),
    })

    if (!response.ok) {
      logger.error(`[${requestId}] Knowledge base query failed`, {
        status: response.status,
      })
      return []
    }

    const result = await response.json()
    const results = result.data?.results || []

    const chunks = results.map((r: any) => r.content || '').filter((c: string) => c.length > 0)

    logger.info(`[${requestId}] Retrieved ${chunks.length} chunks from knowledge base`)

    return chunks
  } catch (error: any) {
    logger.error(`[${requestId}] Error querying knowledge base`, {
      error: error.message,
    })
    return []
  }
}

/**
 * Use an LLM to score confidence based on RAG context
 * Returns a confidence score from 0-10 where:
 * - 0 = full hallucination (completely unsupported)
 * - 10 = fully grounded (completely supported)
 */
async function scoreHallucinationWithLLM(
  userInput: string,
  ragContext: string[],
  model: string,
  apiKey: string,
  requestId: string
): Promise<{ score: number; reasoning: string }> {
  try {
    const contextText = ragContext.join('\n\n---\n\n')

    const systemPrompt = `You are a confidence scoring system. Your job is to evaluate how well a user's input is supported by the provided reference context from a knowledge base.

Score the input on a confidence scale from 0 to 10:
- 0-2: Full hallucination - completely unsupported by context, contradicts the context
- 3-4: Low confidence - mostly unsupported, significant claims not in context
- 5-6: Medium confidence - partially supported, some claims not in context
- 7-8: High confidence - mostly supported, minor details not in context
- 9-10: Very high confidence - fully supported by context, all claims verified

Respond ONLY with valid JSON in this exact format:
{
  "score": <number between 0-10>,
  "reasoning": "<brief explanation of your score>"
}

Do not include any other text, markdown formatting, or code blocks. Only output the raw JSON object. Be strict - only give high scores (7+) if the input is well-supported by the context.`

    const userPrompt = `Reference Context:
${contextText}

User Input to Evaluate:
${userInput}

Evaluate the consistency and provide your score and reasoning in JSON format.`

    logger.info(`[${requestId}] Calling LLM for hallucination scoring`, {
      model,
      contextChunks: ragContext.length,
    })

    const providerId = getProviderFromModel(model)

    const response = await executeProviderRequest(providerId, {
      model,
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: 0.1, // Low temperature for consistent scoring
      apiKey,
    })

    if (response instanceof ReadableStream || ('stream' in response && 'execution' in response)) {
      throw new Error('Unexpected streaming response from LLM')
    }

    const content = response.content.trim()
    logger.debug(`[${requestId}] LLM response:`, { content })

    let jsonContent = content

    if (content.includes('```')) {
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
      if (jsonMatch) {
        jsonContent = jsonMatch[1]
      }
    }

    const result = JSON.parse(jsonContent)

    if (typeof result.score !== 'number' || result.score < 0 || result.score > 10) {
      throw new Error('Invalid score format from LLM')
    }

    logger.info(`[${requestId}] Confidence score: ${result.score}/10`, {
      reasoning: result.reasoning,
    })

    return {
      score: result.score,
      reasoning: result.reasoning || 'No reasoning provided',
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error scoring with LLM`, {
      error: error.message,
    })
    throw new Error(`Failed to score confidence: ${error.message}`)
  }
}

/**
 * Validate user input against knowledge base using RAG + LLM scoring
 */
export async function validateHallucination(
  input: HallucinationValidationInput
): Promise<HallucinationValidationResult> {
  const { userInput, knowledgeBaseId, threshold, topK, model, apiKey, workflowId, requestId } =
    input

  try {
    if (!userInput || userInput.trim().length === 0) {
      return {
        passed: false,
        error: 'User input is required',
      }
    }

    if (!knowledgeBaseId) {
      return {
        passed: false,
        error: 'Knowledge base ID is required',
      }
    }

    let finalApiKey: string
    try {
      const providerId = getProviderFromModel(model)
      finalApiKey = getApiKey(providerId, model, apiKey)
    } catch (error: any) {
      return {
        passed: false,
        error: `API key error: ${error.message}`,
      }
    }

    // Step 1: Query knowledge base with RAG
    const ragContext = await queryKnowledgeBase(
      knowledgeBaseId,
      userInput,
      topK,
      requestId,
      workflowId
    )

    if (ragContext.length === 0) {
      return {
        passed: false,
        error: 'No relevant context found in knowledge base',
      }
    }

    // Step 2: Use LLM to score confidence
    const { score, reasoning } = await scoreHallucinationWithLLM(
      userInput,
      ragContext,
      model,
      finalApiKey,
      requestId
    )

    logger.info(`[${requestId}] Confidence score: ${score}`, {
      reasoning,
      threshold,
    })

    // Step 3: Check against threshold. Lower scores = less confidence = fail validation
    const passed = score >= threshold

    return {
      passed,
      score,
      reasoning,
      error: passed
        ? undefined
        : `Low confidence: score ${score}/10 is below threshold ${threshold}`,
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Hallucination validation error`, {
      error: error.message,
    })
    return {
      passed: false,
      error: `Validation error: ${error.message}`,
    }
  }
}
