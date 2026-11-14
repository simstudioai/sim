import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type OpenAI from 'openai'
import { getBYOKKey } from '@/lib/api-key/byok'
import {
  type BillingAttributionSnapshot,
  checkAttributedBillingBlocks,
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isBillingEnabled } from '@/lib/core/config/env-flags'
import { scopedOutboundFetch } from '@/lib/core/network/outbound-fetch.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { enrichSandboxCapabilities } from '@/lib/execution/remote-sandbox/wand-enricher'
import { enrichTableSchema } from '@/lib/table/llm/wand'
import { wandOperations } from '@/lib/wand/application/operations'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/context'
import { extractResponseText, parseResponsesUsage } from '@/providers/openai/utils'
import { getModelPricing } from '@/providers/utils'

const logger = createLogger('WandGenerate')

const azureApiKey = env.AZURE_OPENAI_API_KEY
const azureEndpoint = env.AZURE_OPENAI_ENDPOINT
const azureApiVersion = env.AZURE_OPENAI_API_VERSION
const wandModelName = env.WAND_OPENAI_MODEL_NAME || 'gpt-4o'
const openaiApiKey = env.OPENAI_API_KEY

const useWandAzure = Boolean(azureApiKey && azureEndpoint && azureApiVersion)

if (!useWandAzure && !openaiApiKey) {
  logger.warn(
    'Neither Azure OpenAI nor OpenAI API key found. Wand generation API will not function.'
  )
} else {
  logger.info(`Using ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} for wand generation`)
}

const wandApiUrl = useWandAzure
  ? `${azureEndpoint?.replace(/\/$/, '')}/openai/v1/responses?api-version=${azureApiVersion}`
  : 'https://api.openai.com/v1/responses'

const requestModel = useWandAzure ? wandModelName : 'gpt-4o'

/** Which deployment serves wand requests, for the surface's error logging and messages. */
export const WAND_DEPLOYMENT = {
  useWandAzure,
  model: requestModel,
  endpoint: useWandAzure ? azureEndpoint : 'api.openai.com',
  apiVersion: useWandAzure ? azureApiVersion : 'N/A',
} as const

/**
 * Sends a wand completion request. Sim's own Azure OpenAI deployment stays direct; OpenAI calls
 * (BYOK or Sim's key) are made for the workspace, so they leave through its egress route.
 */
function postWandRequest(init: RequestInit): Promise<Response> {
  // egress-direct: Sim's env-configured Azure OpenAI deployment, not a workspace credential
  if (useWandAzure) return fetch(wandApiUrl, init)
  return scopedOutboundFetch(wandApiUrl, init)
}

interface WandChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type WandEnricher = (
  workspaceId: string | null,
  context: Record<string, unknown>
) => Promise<string | null>

/** Context each generationType appends to the system prompt. */
const wandEnrichers: Partial<Record<string, WandEnricher>> = {
  timestamp: async () => {
    const now = new Date()
    return `Current date and time context for reference:
- Current UTC timestamp: ${now.toISOString()}
- Current Unix timestamp (seconds): ${Math.floor(now.getTime() / 1000)}
- Current Unix timestamp (milliseconds): ${now.getTime()}
- Current date (UTC): ${now.toISOString().split('T')[0]}
- Current year: ${now.getUTCFullYear()}
- Current month: ${now.getUTCMonth() + 1}
- Current day of month: ${now.getUTCDate()}
- Current day of week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()]}

Use this context to calculate relative dates like "yesterday", "last week", "beginning of this month", etc.`
  },

  'table-schema': enrichTableSchema,
  /** JavaScript, Python, and Shell swap prompt text while retaining sandbox enrichment. */
  'javascript-function-body': enrichSandboxCapabilities,
}

interface WandUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

async function updateUserStatsForWand(
  billingAttribution: BillingAttributionSnapshot,
  usage: WandUsage,
  requestId: string,
  isBYOK = false
): Promise<void> {
  if (!isBillingEnabled) {
    return
  }

  if (!usage.total_tokens || usage.total_tokens <= 0) {
    return
  }

  try {
    const promptTokens = usage.prompt_tokens || 0
    const completionTokens = usage.completion_tokens || 0

    const modelName = requestModel
    let costToStore = 0

    if (!isBYOK) {
      const pricing = getModelPricing(modelName)
      const costMultiplier = getCostMultiplier()
      let modelCost = 0

      if (pricing) {
        const inputCost = (promptTokens / 1000000) * pricing.input
        const outputCost = (completionTokens / 1000000) * pricing.output
        modelCost = inputCost + outputCost
      } else {
        modelCost = (promptTokens / 1000000) * 0.005 + (completionTokens / 1000000) * 0.015
      }

      costToStore = modelCost * costMultiplier
    }

    await recordUsage({
      userId: billingAttribution.actorUserId,
      workspaceId: billingAttribution.workspaceId ?? undefined,
      ...toBillingContext(billingAttribution),
      entries: [
        {
          category: 'model',
          source: 'wand',
          description: modelName,
          cost: costToStore,
          sourceReference: `wand:${requestId}`,
          metadata: { inputTokens: promptTokens, outputTokens: completionTokens },
        },
      ],
    })

    await checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)
  } catch (error) {
    logger.error('Failed to update user stats for wand usage', error, { requestId })
  }
}

export class WandWorkflowNotFoundError extends OrchestrationError {
  constructor() {
    super('not_found', 'Workflow not found')
    this.name = 'WandWorkflowNotFoundError'
  }
}

/** The workflow a wand request names belongs to no workspace (a deprecated personal workflow). */
export class WandWorkflowDetachedError extends OrchestrationError {
  constructor() {
    super(
      'forbidden',
      'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be accessed.'
    )
    this.name = 'WandWorkflowDetachedError'
  }
}

/** Neither Sim's Azure deployment nor an OpenAI key (Sim's or the workspace's) is available. */
export class WandNotConfiguredError extends Error {
  constructor() {
    super('Wand generation service is not configured.')
    this.name = 'WandNotConfiguredError'
  }
}

/** The billing gate refused the request; `message` is the client-facing explanation. */
export class WandBillingRefusedError extends Error {
  constructor(
    message: string,
    readonly scope?: 'actor' | 'payer' | 'member'
  ) {
    super(message)
    this.name = 'WandBillingRefusedError'
  }
}

export class WandEmptyResponseError extends Error {
  constructor() {
    super('Wand response was empty or invalid')
    this.name = 'WandEmptyResponseError'
  }
}

/** The model's endpoint answered a non-streaming request with an error status. */
class WandUpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'WandUpstreamError'
  }
}

export class WandStreamStartError extends Error {
  constructor(cause: unknown) {
    super('Failed to create wand stream', { cause })
    this.name = 'WandStreamStartError'
  }
}

interface GenerateWandInput {
  prompt: string
  systemPrompt?: string
  stream: boolean
  history: WandChatMessage[]
  generationType?: string
  wandContext: Record<string, unknown>
  requestId: string
}

type GenerateWandResult =
  | { kind: 'stream'; body: ReadableStream<Uint8Array> }
  | { kind: 'content'; content: string }

interface ResponsesStreamEvent {
  type?: string
  delta?: unknown
  json?: unknown
  text?: unknown
  error?: { message?: string }
  response?: { usage?: OpenAI.Responses.ResponseUsage }
  usage?: OpenAI.Responses.ResponseUsage
}

interface ResponsesCompletion {
  output: OpenAI.Responses.ResponseOutputItem[]
  usage?: OpenAI.Responses.ResponseUsage
}

/**
 * Kept apart from `resolveActiveWorkflowApplicationContext`: wand has always accepted archived
 * workflows and answers a workflow without a workspace with its own refusal, not a not-found.
 */
async function resolveWorkflowWorkspaceId(workflowId: string): Promise<string> {
  const [workflowRecord] = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  if (!workflowRecord) {
    logger.warn('Wand workflow not found', { workflowId })
    throw new WandWorkflowNotFoundError()
  }
  if (!workflowRecord.workspaceId) {
    logger.warn('Wand workflow has no workspace; request blocked', { workflowId })
    throw new WandWorkflowDetachedError()
  }
  return workflowRecord.workspaceId
}

/**
 * Streams the Responses API SSE body as `data: {chunk}` events, closing with `data: {done}` and
 * recording usage once the completion reports it.
 */
function relayResponsesStream(
  response: Response,
  recordUsageOnce: (usage: WandUsage) => Promise<void>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  return new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader()
      if (!reader) {
        controller.close()
        return
      }

      let finalUsage: WandUsage | null = null
      let usageRecorded = false

      const flushUsage = async () => {
        if (usageRecorded || !finalUsage) {
          return
        }

        usageRecorded = true
        await recordUsageOnce(finalUsage)
      }

      try {
        let buffer = ''
        let chunkCount = 0
        let activeEventType: string | undefined

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            logger.info(`Stream completed. Total chunks: ${chunkCount}`)
            await flushUsage()
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
            controller.close()
            break
          }

          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) {
              continue
            }

            if (trimmed.startsWith('event:')) {
              activeEventType = trimmed.slice(6).trim()
              continue
            }

            if (!trimmed.startsWith('data:')) {
              continue
            }

            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') {
              logger.info('Received [DONE] signal')

              await flushUsage()

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
              controller.close()
              return
            }

            let parsed: ResponsesStreamEvent | null
            try {
              parsed = JSON.parse(data)
            } catch {
              continue
            }

            const eventType = parsed?.type ?? activeEventType

            if (
              eventType === 'response.error' ||
              eventType === 'error' ||
              eventType === 'response.failed'
            ) {
              throw new Error(parsed?.error?.message || 'Responses stream error')
            }

            if (
              parsed &&
              (eventType === 'response.output_text.delta' ||
                eventType === 'response.output_json.delta')
            ) {
              const content = deltaContent(parsed)

              if (content) {
                chunkCount++
                if (chunkCount === 1) {
                  logger.info('Received first content chunk')
                }

                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`)
                )
              }
            }

            if (eventType === 'response.completed') {
              const usage = parseResponsesUsage(parsed?.response?.usage ?? parsed?.usage)
              if (usage) {
                finalUsage = {
                  prompt_tokens: usage.promptTokens,
                  completion_tokens: usage.completionTokens,
                  total_tokens: usage.totalTokens,
                }
                logger.info(`Received usage data: ${JSON.stringify(finalUsage)}`)
              }
            }
          }
        }
      } catch (streamError) {
        logger.error('Streaming error', {
          name: streamError instanceof Error ? streamError.name : undefined,
          message: (streamError instanceof Error && streamError.message) || 'Unknown error',
          stack: streamError instanceof Error ? streamError.stack : undefined,
        })

        try {
          await flushUsage()
        } catch (usageError) {
          logger.warn('Failed to record usage after stream error', usageError)
        }

        const errorData = `data: ${JSON.stringify({ error: 'Streaming failed', done: true })}\n\n`
        controller.enqueue(encoder.encode(errorData))
        controller.close()
      } finally {
        reader.releaseLock()
      }
    },
    cancel() {},
  })
}

function deltaContent(event: ResponsesStreamEvent): string {
  const { delta } = event
  if (typeof delta === 'string') return delta
  if (delta && typeof delta === 'object') {
    if ('text' in delta && typeof delta.text === 'string') return delta.text
    if ('json' in delta && delta.json !== undefined) return JSON.stringify(delta.json)
  }
  if (event.json !== undefined) return JSON.stringify(event.json)
  if (typeof event.text === 'string') return event.text
  return ''
}

/**
 * Generates wand content for a workspace member, billed to that workspace. OpenAI requests leave
 * through the workspace organization's outbound route.
 */
async function executeWandGeneration<I extends GenerateWandInput>({
  principal,
  input,
  context,
}: {
  principal: SessionPrincipal
  input: I
  context: ActiveWorkspaceApplicationContext
}): Promise<GenerateWandResult> {
  const { workspaceId } = context
  const { prompt, history, generationType, wandContext, requestId } = input

  const [billingAttribution, byokResult] = await Promise.all([
    // Wand is an interactive action attributed to the authenticated human.
    resolveBillingAttribution({ actorUserId: principal.userId, workspaceId }),
    useWandAzure ? null : getBYOKKey(workspaceId, 'openai'),
  ])

  const isBYOK = Boolean(byokResult)
  const activeOpenAIKey = byokResult?.apiKey ?? openaiApiKey
  if (byokResult) logger.info('Using BYOK OpenAI key for wand generation')

  if (!useWandAzure && !activeOpenAIKey) {
    logger.error('AI client not initialized. Missing API key.')
    throw new WandNotConfiguredError()
  }

  // BYOK skips metered caps but still checks the actor and exact workspace
  // payer; non-BYOK applies the complete attributed gate.
  if (isBYOK) {
    const blocked = await checkAttributedBillingBlocks(billingAttribution)
    if (blocked.blocked) {
      throw new WandBillingRefusedError(
        blocked.message || 'Account is not in good standing. Please contact support.'
      )
    }
  } else {
    const usage = await checkAttributedUsageLimits(billingAttribution)
    if (usage.isExceeded) {
      throw new WandBillingRefusedError(
        usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
        usage.scope
      )
    }
  }

  let finalSystemPrompt =
    input.systemPrompt ||
    'You are a helpful AI assistant. Generate content exactly as requested by the user.'

  if (generationType) {
    const enricher = wandEnrichers[generationType]
    if (enricher) {
      const enrichment = await enricher(workspaceId, wandContext)
      if (enrichment) {
        finalSystemPrompt += `\n\n${enrichment}`
      }
    }
  }

  if (generationType === 'cron-expression') {
    finalSystemPrompt +=
      '\n\nIMPORTANT: Return ONLY the raw cron expression (e.g., "0 9 * * 1-5"). Do NOT wrap it in markdown code blocks, backticks, or quotes. Do NOT include any explanation or text before or after the expression.'
  }

  // Both the JavaScript and Python function-body prompts share this type, so
  // the reinforcement stays language-neutral.
  if (generationType === 'javascript-function-body') {
    finalSystemPrompt +=
      '\n\nIMPORTANT: Return ONLY the raw function body. Do NOT wrap it in markdown code blocks (no ```javascript, no ```python, no ```). Do NOT include any explanation before or after the code.'
  }

  if (generationType === 'json-object') {
    finalSystemPrompt +=
      '\n\nIMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (no ```json or ```). Do NOT include any explanation or text before or after the JSON. The response must start with { and end with }.'
  }

  // Separate from json-object: that reinforcement demands braces, which would
  // fight a field whose contract is an array.
  if (generationType === 'json-array') {
    finalSystemPrompt +=
      '\n\nIMPORTANT: Return ONLY the raw JSON array. Do NOT wrap it in markdown code blocks (no ```json or ```). Do NOT include any explanation or text before or after the JSON. The response must start with [ and end with ].'
  }

  const messages: WandChatMessage[] = [
    { role: 'system', content: finalSystemPrompt },
    ...history.filter((msg) => msg.role !== 'system'),
    { role: 'user', content: prompt },
  ]

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'responses=v1',
  }

  if (useWandAzure && azureApiKey) {
    headers['api-key'] = azureApiKey
  } else {
    headers.Authorization = `Bearer ${activeOpenAIKey}`
  }

  const requestBody = {
    model: requestModel,
    input: messages,
    temperature: 0.2,
    max_output_tokens: 10000,
  }

  const recordWandUsage = (usage: WandUsage) =>
    updateUserStatsForWand(billingAttribution, usage, requestId, isBYOK)

  if (input.stream) {
    let response: Response
    try {
      logger.info(`About to create stream with model: ${requestModel}`)

      response = await postWandRequest({
        method: 'POST',
        headers,
        body: JSON.stringify({ ...requestBody, stream: true }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('API request failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })
        throw new Error(`API request failed: ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      throw new WandStreamStartError(error)
    }

    logger.info('Stream response received, starting processing')
    return { kind: 'stream', body: relayResponsesStream(response, recordWandUsage) }
  }

  const response = await postWandRequest({
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new WandUpstreamError(
      response.status,
      `API request failed: ${response.status} ${response.statusText} - ${errorText}`
    )
  }

  const completion: ResponsesCompletion = await response.json()
  const generatedContent = extractResponseText(completion.output)?.trim()

  if (!generatedContent) {
    logger.error(`${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} response was empty or invalid.`)
    throw new WandEmptyResponseError()
  }

  logger.info('Wand generation successful')

  const usage = parseResponsesUsage(completion.usage)
  if (usage) {
    await recordWandUsage({
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
    })
  }

  return { kind: 'content', content: generatedContent }
}

export const generateWandForWorkflow = defineAuthorizedWorkspaceUseCase({
  operation: wandOperations.generateForWorkflow,
  resolveContext: async ({ input }: { input: GenerateWandInput & { workflowId: string } }) =>
    resolveActiveWorkspaceApplicationContext(await resolveWorkflowWorkspaceId(input.workflowId)),
  authorizationOptions: {},
  execute: executeWandGeneration,
})

/** Generates with no workflow to resolve (a table schema, an unhydrated editor) for a workspace member. */
export const generateWandInWorkspace = defineAuthorizedWorkspaceUseCase({
  operation: wandOperations.generateInWorkspace,
  resolveContext: ({ input }: { input: GenerateWandInput & { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: executeWandGeneration,
})
