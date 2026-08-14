import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { generateInternalDelegationToken } from '@/lib/auth/internal'
import {
  BILLING_ATTRIBUTION_HEADER,
  type BillingAttributionSnapshot,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import {
  addModelInputProvenanceToRequest,
  createModelInputProvenanceRequestMetadata,
} from '@/lib/execution/model-input-provenance'
import {
  inspectPrivateToolMetadataEnvelope,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { refreshTokenIfNeeded } from '@/lib/oauth/credential-service'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import { isAbortError } from '@/providers/streaming-tool-loop-shared'
import { getProviderFromModel } from '@/providers/utils'

const logger = createLogger('HallucinationValidator')
const KNOWLEDGE_PROVENANCE_ERROR = 'Knowledge result secret provenance is unavailable'
const HALLUCINATION_INPUT_PATHS = [['input']] as const

class KnowledgeProvenanceError extends Error {
  constructor() {
    super(KNOWLEDGE_PROVENANCE_ERROR)
    this.name = 'KnowledgeProvenanceError'
  }
}

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
 * Query knowledge base to get relevant context chunks using the search API
 */
async function queryKnowledgeBase(
  knowledgeBaseId: string,
  query: string,
  topK: number,
  requestId: string,
  actorUserId: string,
  billingAttribution: BillingAttributionSnapshot,
  workflowId: string | undefined,
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry
): Promise<{ context: string[]; registry: ResolvedSecretTraceRegistry }> {
  const resultRegistry = resolvedSecretTraceRegistry.forkForInputPaths([])
  if (!workflowId) throw new Error('Hallucination validation requires a workflow ID')

  try {
    const searchUrl = `${getInternalApiBaseUrl()}/api/knowledge/search`
    const internalToken = await generateInternalDelegationToken({
      subjectUserId: actorUserId,
      workflowId,
    })
    const headers = new Headers({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${internalToken}`,
      [BILLING_ATTRIBUTION_HEADER]: serializeBillingAttributionHeader(billingAttribution),
      [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    const requestBody = {
      knowledgeBaseIds: [knowledgeBaseId],
      query,
      topK,
      workflowId,
    }
    const modelInputMetadata = createModelInputProvenanceRequestMetadata(
      resolvedSecretTraceRegistry,
      HALLUCINATION_INPUT_PATHS
    )
    if (!modelInputMetadata) throw new KnowledgeProvenanceError()
    const body = addModelInputProvenanceToRequest(requestBody, headers, modelInputMetadata)
    // boundary-raw-fetch: authenticated internal Knowledge call with private provenance envelopes
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Knowledge base query failed with status ${response.status}`)
    }

    const payload: unknown = await response.json()
    if (!isPlainRecord(payload)) throw new KnowledgeProvenanceError()

    const inspection = inspectPrivateToolMetadataEnvelope(
      response.headers,
      payload,
      RESOLVED_SECRET_PROVENANCE_METADATA_V1
    )
    if (inspection.status === 'invalid') throw new KnowledgeProvenanceError()

    let functionalResponse = payload
    if (inspection.status === 'verified') {
      functionalResponse = { ...payload }
      delete functionalResponse[RESOLVED_SECRET_PROVENANCE_FIELD]
      const imported = await resultRegistry.importProvenance(inspection.value, {
        origin: 'guardrails.hallucinationResult',
        trusted: true,
      })
      if (!imported || !resultRegistry.isComplete()) {
        throw new KnowledgeProvenanceError()
      }
    }

    const data = isPlainRecord(functionalResponse.data) ? functionalResponse.data : undefined
    const results = Array.isArray(data?.results) ? data.results : []

    return {
      context: results.flatMap((result) => {
        if (
          !isPlainRecord(result) ||
          typeof result.content !== 'string' ||
          result.content.length === 0
        ) {
          return []
        }
        return [result.content]
      }),
      registry: resultRegistry,
    }
  } catch (error) {
    if (error instanceof KnowledgeProvenanceError) throw error
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
      const credential = await db.query.account.findFirst({
        where: eq(account.id, providerCredentials.vertexCredential),
      })
      if (credential) {
        const { accessToken } = await refreshTokenIfNeeded(
          requestId,
          credential,
          providerCredentials.vertexCredential
        )
        if (accessToken) {
          finalApiKey = accessToken
        }
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
      actorUserId,
      billingAttribution,
      workflowId,
      resolvedSecretTraceRegistry
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
