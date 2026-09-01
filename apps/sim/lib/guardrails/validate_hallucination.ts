import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { searchKnowledgeAsExecutor } from '@/lib/internal/knowledge/search'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { resolveAccessTokenForAccount } from '@/lib/oauth/credential-service'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import { isAbortError } from '@/providers/streaming-tool-loop-shared'
import { getProviderFromModel } from '@/providers/utils'

const logger = createLogger('HallucinationValidator')
const HALLUCINATION_INPUT_PATHS = [['input']] as const

export interface HallucinationValidationResult {
  passed: boolean
  error?: string
  score?: number
  reasoning?: string
  /** Billable LLM cost (dollars) for the scoring call; 0 for BYOK/non-hosted. */
  cost?: number
}

export interface HallucinationValidationInput {
  userInput: string
  knowledgeBaseId: string
  threshold: number // 0-10 confidence scale, default 3 (scores below 3 fail)
  topK: number // Number of chunks to retrieve, default 10
  model: string
  apiKey?: string
  providerCredentials?: {
    azureEndpoint?: string
    azureApiVersion?: string
    vertexProject?: string
    vertexLocation?: string
    vertexCredential?: string
    bedrockAccessKeyId?: string
    bedrockSecretKey?: string
    bedrockRegion?: string
  }
  workflowId?: string
  workspaceId?: string
  actorUserId: string
  executionContext: InternalToolOperationContext
  billingAttribution: BillingAttributionSnapshot
  requestId: string
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry
  /**
   * The caller's cancellation signal, forwarded to the scoring model exactly as the
   * agent handler forwards `ctx.abortSignal`. Without it the scoring request outlives
   * a cancelled request and keeps burning a provider slot until the transport gives up.
   */
  abortSignal?: AbortSignal
}

/**
 * Queries the authorized Knowledge application operation for relevant chunks.
 */
async function queryKnowledgeBase(
  knowledgeBaseId: string,
  query: string,
  topK: number,
  requestId: string,
  executionContext: InternalToolOperationContext,
  billingAttribution: BillingAttributionSnapshot,
  workflowId: string | undefined,
  workspaceId: string | undefined,
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry,
  abortSignal: AbortSignal | undefined
): Promise<{ context: string[]; registry: ResolvedSecretTraceRegistry }> {
  if (!workflowId) throw new Error('Hallucination validation requires a workflow ID')
  if (!workspaceId) throw new Error('Hallucination validation requires a workspace ID')

  try {
    const result = await searchKnowledgeAsExecutor({
      knowledgeBaseIds: [knowledgeBaseId],
      query,
      topK,
      workspaceId,
      context: executionContext,
      billingAttribution,
      resolvedSecretTraceRegistry,
      modelInputPaths: HALLUCINATION_INPUT_PATHS,
      signal: abortSignal,
    })

    return {
      context: result.results.flatMap((item) => {
        if (!isPlainRecord(item) || typeof item.content !== 'string' || item.content.length === 0) {
          return []
        }
        return [item.content]
      }),
      registry: result.registry,
    }
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown Knowledge query error')
    logger.error(`[${requestId}] Error querying knowledge base`, {
      error: message,
    })
    throw new Error(`Failed to query knowledge base: ${message}`, { cause: error })
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
  apiKey: string | undefined,
  providerCredentials: HallucinationValidationInput['providerCredentials'],
  workspaceId: string | undefined,
  requestId: string,
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry,
  abortSignal: AbortSignal | undefined
): Promise<{ score: number; reasoning: string; cost: number }> {
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

    let finalApiKey: string | undefined = apiKey
    if (providerId === 'vertex' && providerCredentials?.vertexCredential) {
      const accessToken = await resolveAccessTokenForAccount(
        requestId,
        providerCredentials.vertexCredential
      )
      if (accessToken) {
        finalApiKey = accessToken
      }
    }

    const response = await executeProviderRequest(
      providerId,
      {
        model,
        systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.1, // Low temperature for consistent scoring
        apiKey: finalApiKey,
        azureEndpoint: providerCredentials?.azureEndpoint,
        azureApiVersion: providerCredentials?.azureApiVersion,
        vertexProject: providerCredentials?.vertexProject,
        vertexLocation: providerCredentials?.vertexLocation,
        bedrockAccessKeyId: providerCredentials?.bedrockAccessKeyId,
        bedrockSecretKey: providerCredentials?.bedrockSecretKey,
        bedrockRegion: providerCredentials?.bedrockRegion,
        workspaceId,
        abortSignal,
      },
      { resolvedSecretTraceRegistry }
    )

    if (response instanceof ReadableStream || ('stream' in response && 'execution' in response)) {
      throw new Error('Unexpected streaming response from LLM')
    }

    // executeProviderRequest already zeroes cost for BYOK / non-hosted models,
    // so this is the billable amount as-is.
    const cost = typeof response.cost?.total === 'number' ? response.cost.total : 0

    const content = response.content.trim()

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
      cost,
    }
  } catch (error: any) {
    /**
     * A cancelled run is not a scoring failure. Rewrapping it would erase the
     * `AbortError` name the outer handler classifies on, so it propagates as-is.
     */
    if (isAbortError(error)) throw error
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
  const {
    userInput,
    knowledgeBaseId,
    threshold,
    topK,
    model,
    apiKey,
    providerCredentials,
    workflowId,
    workspaceId,
    actorUserId,
    executionContext,
    billingAttribution,
    requestId,
    resolvedSecretTraceRegistry,
    abortSignal,
  } = input

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
    // Step 1: Query knowledge base with RAG
    const knowledgeResult = await queryKnowledgeBase(
      knowledgeBaseId,
      userInput,
      topK,
      requestId,
      executionContext,
      billingAttribution,
      workflowId,
      workspaceId,
      resolvedSecretTraceRegistry,
      abortSignal
    )
    const ragContext = knowledgeResult.context

    if (ragContext.length === 0) {
      return {
        passed: false,
        error: 'No relevant context found in knowledge base',
      }
    }

    const inputRegistry = resolvedSecretTraceRegistry.forkForInputPaths(HALLUCINATION_INPUT_PATHS, {
      propagated: true,
    })
    const inputProjection = projectResolvedSecretModelContent(userInput, inputRegistry)
    const contextProjection = projectResolvedSecretModelContent(
      ragContext,
      knowledgeResult.registry.forkForPropagatedEntries()
    )
    if (
      !inputProjection.safe ||
      typeof inputProjection.value !== 'string' ||
      !contextProjection.safe ||
      !Array.isArray(contextProjection.value) ||
      !contextProjection.value.every((value) => typeof value === 'string')
    ) {
      refuseResolvedSecretProjection({
        site: 'guardrails.hallucinationModelInput',
        message: 'Hallucination model input could not be safely projected',
        registry: inputRegistry,
        inputPath: 'input',
      })
    }

    const providerRegistry = inputRegistry
    providerRegistry.mergeToolCallRegistry(knowledgeResult.registry)
    if (!providerRegistry.isComplete()) {
      throw new Error('Hallucination model input provenance is unavailable')
    }

    // Step 2: Use LLM to score confidence
    const { score, reasoning, cost } = await scoreHallucinationWithLLM(
      inputProjection.value,
      contextProjection.value,
      model,
      apiKey,
      providerCredentials,
      workspaceId,
      requestId,
      providerRegistry,
      abortSignal
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
      cost,
      error: passed
        ? undefined
        : `Low confidence: score ${score}/10 is below threshold ${threshold}`,
    }
  } catch (error: any) {
    /**
     * Cancellation is surfaced as cancellation, not as a guardrail verdict. Returning
     * `passed: false` here would fail content on a run the caller abandoned, which is
     * indistinguishable to a consumer from the model actually hallucinating.
     */
    if (isAbortError(error)) throw error
    logger.error(`[${requestId}] Hallucination validation error`, {
      error: error.message,
    })
    return {
      passed: false,
      error: `Validation error: ${error.message}`,
    }
  }
}
