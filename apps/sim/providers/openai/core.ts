import { createHash } from 'node:crypto'
import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import type OpenAI from 'openai'
import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { createOpenAIResponsesStreamingToolLoopStream } from '@/providers/openai/streaming-tool-loop'
import { enrichLastModelSegmentFromOpenAIResponse } from '@/providers/openai/trace'
import {
  addOpenAIUsage,
  buildOpenAIUsageCost,
  buildOpenAIUsageTokens,
  createOpenAIUsageAccumulator,
} from '@/providers/openai/usage'
import { executeProviderTool } from '@/providers/runtime-context'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { isAbortError, parseToolArguments } from '@/providers/streaming-tool-loop-shared'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import type { Message, ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  enforceStrictSchema,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  supportsReasoningEffort,
  trackForcedToolUsage,
} from '@/providers/utils'
import {
  buildResponsesInputFromMessages,
  convertResponseOutputToInputItems,
  convertToolsToResponses,
  createReadableStreamFromResponses,
  extractResponseText,
  extractResponseToolCalls,
  isMaxOutputTokensIncompleteResponse,
  parseResponsesUsage,
  type ResponsesInputItem,
  type ResponsesToolCall,
  responseContainsFunctionCall,
  toResponsesToolChoice,
} from './utils'

/**
 * How long the response body may stall after headers arrive before the attempt is
 * abandoned. Generous: the body is tens of KB and follows immediately on a healthy
 * call, so this only fires on the stall, well inside the runtime's own ~300s socket
 * wall (which is variable, unnamed, and cannot be retried against).
 */
const RESPONSE_BODY_BUDGET_MS = 60_000

/**
 * Retry budget for a rejected `/v1/responses` request: 2 retries, 3 attempts in
 * total. This path posted through the OpenAI SDK until it moved onto raw `fetch`,
 * which silently dropped the SDK's own `maxRetries: 2`; every other provider we
 * ship still constructs an SDK client and therefore still retries. The number
 * matches both the OpenAI SDK and the AI SDK's `_retryWithExponentialBackoff`.
 */
const MAX_RESPONSES_RETRIES = 2

/**
 * Sub-500 statuses that both the OpenAI SDK and the AI SDK classify as retryable:
 * request timeout, lock conflict, and rate limit.
 */
const RETRYABLE_RESPONSE_STATUSES = new Set([408, 409, 429])

/**
 * A non-2xx reply from `/v1/responses`, carrying the status and any server-supplied
 * pacing so the caller can decide on a retry without re-reading a body that has
 * already been consumed to build the message.
 */
class ResponsesHttpError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message)
    this.name = 'ResponsesHttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * Whether a rejected request may be re-sent.
 *
 * Restricted to the classes where the request was refused outright and no response
 * was created server-side, so a retry cannot bill a second generation. Everything
 * else — including a stalled body, which arrives only after a response exists — is
 * surfaced. `/v1/responses` ignores `Idempotency-Key` (verified live: the same key
 * with an identical body returns two distinct response ids), so there is no
 * deduplication to fall back on and this boundary is the only guard.
 */
function isRetryableResponseStatus(status: number): boolean {
  return RETRYABLE_RESPONSE_STATUSES.has(status) || status >= 500
}

/**
 * Reads server-supplied retry pacing. OpenAI sends `retry-after-ms` alongside the
 * standard `Retry-After` on rate limits and it carries sub-second precision, so it
 * wins when present and parseable.
 */
function readRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get('retry-after-ms')
  if (raw !== null) {
    const ms = Number(raw.trim())
    if (Number.isFinite(ms) && ms >= 0) return ms
  }
  return parseRetryAfter(headers.get('retry-after'))
}

/**
 * Waits out a retry backoff, resolving early — and rejecting with the caller's own
 * abort reason — the moment the run is cancelled.
 *
 * A plain `sleep` would hold the provider slot for the full delay after a workflow was
 * already cancelled, and the loop would then surface the stale HTTP error rather than
 * the cancellation, reporting a cancelled run as a rate limit or a 5xx.
 */
function backoffDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

type PreparedTools = ReturnType<typeof prepareToolsWithUsageControl>
type ToolChoice = PreparedTools['toolChoice']

/**
 * Rejects a `/v1/responses` body that reports a generation which did not succeed.
 *
 * The endpoint answers HTTP 200 for failures: `status: 'failed'` with a populated
 * `error`, or `status: 'incomplete'` with an `incomplete_details.reason`. Reading
 * only `output` therefore reports a failed generation to the user as a success with
 * empty content and billed tokens — while `deriveOpenAIFinishReason` independently
 * records `finishReason: 'error'` on the same span, so the trace and the block
 * contradict each other.
 *
 * The tolerated case is copied from `streamResponsesTurn` and must keep matching it:
 * an `incomplete` response is accepted only when it was truncated by
 * `max_output_tokens` AND carries no function call. Truncated prose is still a usable
 * partial answer, but a truncated `function_call` holds half-written JSON — executing
 * it makes `parseToolArguments` throw, surfacing a confusing tool failure instead of
 * the truncation that actually happened.
 *
 * A status the API did not send is not asserted against: this path is shared with
 * Azure OpenAI and any OpenAI-compatible gateway, and inventing a failure for an
 * absent field would break healthy responses rather than report broken ones.
 */
function assertUsableResponse(response: OpenAI.Responses.Response, providerLabel: string): void {
  if (response.error) {
    const code = response.error.code ? ` (${response.error.code})` : ''
    throw new Error(`${providerLabel} generation failed${code}: ${response.error.message}`)
  }

  if (response.status === 'failed') {
    throw new Error(
      `${providerLabel} generation failed, and the API returned no error detail explaining why.`
    )
  }

  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason ?? 'unknown'
    if (responseContainsFunctionCall(response)) {
      throw new Error(
        `${providerLabel} generation stopped before completion (${reason}), truncating a tool call mid-argument. Raise the max output tokens or reduce the tool schema size.`
      )
    }
    if (!isMaxOutputTokensIncompleteResponse(response)) {
      throw new Error(`${providerLabel} generation stopped before completion: ${reason}.`)
    }
    return
  }

  if (response.status && response.status !== 'completed') {
    throw new Error(
      `${providerLabel} returned a response with status "${response.status}", which carries no finished generation.`
    )
  }
}

/**
 * Stable routing key for OpenAI's prompt cache, scoped to one agent block.
 *
 * Per-block rather than per-workflow: two blocks in the same workflow have
 * different prefixes, so sharing a key would pull them onto the same engine and
 * lower the hit rate. Hashed so no internal identifier leaves the system.
 * Returns `undefined` when the caller has no stable identity to key on.
 */
function buildPromptCacheKey(request: ProviderRequest): string | undefined {
  if (!request.workflowId || !request.blockId) return undefined
  return createHash('sha256')
    .update(`${request.workflowId}:${request.blockId}`)
    .digest('hex')
    .slice(0, 32)
}

export interface ResponsesProviderConfig {
  providerId: string
  providerLabel: string
  modelName: string
  endpoint: string
  headers: Record<string, string>
  logger: Logger
  /**
   * Optional fetch implementation. Used to pin the connection to a pre-validated
   * IP (DNS-rebinding/SSRF protection) when the endpoint is user-supplied.
   * Defaults to the global fetch.
   */
  fetch?: typeof fetch
}

/**
 * Executes a Responses API request with tool-loop handling and streaming support.
 */
export async function executeResponsesProviderRequest(
  request: ProviderRequest,
  config: ResponsesProviderConfig
): Promise<ProviderResponse | StreamingExecution> {
  const { logger } = config
  const fetchImpl = config.fetch ?? fetch

  logger.info(`Preparing ${config.providerLabel} request`, {
    model: request.model,
    // Correlation ids: without these a provider call cannot be tied back to the
    // execution that issued it, which leaves a stalled request indistinguishable
    // from one that was never made.
    workflowId: request.workflowId,
    blockId: request.blockId,
    executionId: request.executionId,
    hasSystemPrompt: !!request.systemPrompt,
    hasMessages: !!request.messages?.length,
    hasTools: !!request.tools?.length,
    toolCount: request.tools?.length || 0,
    hasResponseFormat: !!request.responseFormat,
    stream: !!request.stream,
  })

  const allMessages: Message[] = []

  if (request.systemPrompt) {
    allMessages.push({
      role: 'system',
      content: request.systemPrompt,
    })
  }

  if (request.context) {
    allMessages.push({
      role: 'user',
      content: request.context,
    })
  }

  if (request.messages) {
    allMessages.push(...request.messages)
  }

  const initialInput = buildResponsesInputFromMessages(allMessages, config.providerId)

  const basePayload: Record<string, unknown> = {
    model: config.modelName,
  }

  /**
   * OpenAI prompt caching is automatic and free, so there is nothing to toggle
   * — but requests only hit a warm cache when they route to the same engine.
   * A stable key per agent block sharpens that routing and is required for
   * reliable matching on GPT-5.6+.
   *
   * `prompt_cache_key` is absent from the pinned SDK's typings, which is
   * harmless: this body is a plain object posted through `fetch`, never
   * `responses.create()`. Do not delete it as an unknown parameter.
   */
  const promptCacheKey = buildPromptCacheKey(request)
  if (promptCacheKey) basePayload.prompt_cache_key = promptCacheKey

  if (request.temperature !== undefined) basePayload.temperature = request.temperature
  if (request.maxTokens != null) basePayload.max_output_tokens = request.maxTokens

  /**
   * Reasoning summaries feed Thinking chrome. They are requested when an
   * explicit effort is set (pre-agent-events payload always paired
   * `summary: 'auto'` with `effort` — kept for parity) and on agent-events
   * runs even without an explicit effort. Summaries require OpenAI
   * organization verification; see the strip-and-retry fallback in the
   * request helpers below.
   */
  if (supportsReasoningEffort(config.modelName)) {
    const hasExplicitEffort =
      request.reasoningEffort !== undefined && request.reasoningEffort !== 'auto'
    const reasoning: Record<string, unknown> = {
      ...(request.agentEvents === true || hasExplicitEffort ? { summary: 'auto' } : {}),
      ...(hasExplicitEffort ? { effort: request.reasoningEffort } : {}),
    }
    if (Object.keys(reasoning).length > 0) {
      basePayload.reasoning = reasoning
    }
  }

  if (request.verbosity !== undefined && request.verbosity !== 'auto') {
    basePayload.text = {
      ...((basePayload.text as Record<string, unknown>) ?? {}),
      verbosity: request.verbosity,
    }
  }

  if (request.responseFormat) {
    const isStrict = request.responseFormat.strict !== false
    const rawSchema = request.responseFormat.schema || request.responseFormat
    // OpenAI strict mode requires additionalProperties: false on ALL nested objects
    const cleanedSchema = isStrict ? enforceStrictSchema(rawSchema) : rawSchema

    const textFormat = {
      type: 'json_schema' as const,
      name: request.responseFormat.name || 'response_schema',
      schema: cleanedSchema,
      strict: isStrict,
    }

    basePayload.text = {
      ...((basePayload.text as Record<string, unknown>) ?? {}),
      format: textFormat,
    }
    logger.info(`Added JSON schema response format to ${config.providerLabel} request`)
  }

  const tools = request.tools?.length
    ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
    : undefined

  let preparedTools: PreparedTools | null = null
  let responsesToolChoice: ReturnType<typeof toResponsesToolChoice> | undefined
  let trackingToolChoice: ToolChoice | undefined

  if (tools?.length) {
    preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, config.providerId)
    const { tools: filteredTools, toolChoice } = preparedTools
    trackingToolChoice = toolChoice

    if (filteredTools?.length) {
      const convertedTools = convertToolsToResponses(filteredTools)
      if (!convertedTools.length) {
        throw new Error('All tools have empty names')
      }

      basePayload.tools = convertedTools
      basePayload.parallel_tool_calls = true
    }

    if (toolChoice) {
      responsesToolChoice = toResponsesToolChoice(toolChoice)
      if (responsesToolChoice) {
        basePayload.tool_choice = responsesToolChoice
      }

      logger.info(`${config.providerLabel} request configuration:`, {
        toolCount: filteredTools?.length || 0,
        toolChoice:
          typeof toolChoice === 'string'
            ? toolChoice
            : toolChoice.type === 'function'
              ? `force:${toolChoice.function?.name}`
              : toolChoice.type === 'tool'
                ? `force:${toolChoice.name}`
                : toolChoice.type === 'any'
                  ? `force:${toolChoice.any?.name || 'unknown'}`
                  : 'unknown',
        model: config.modelName,
      })
    }
  }

  const createRequestBody = (
    input: ResponsesInputItem[],
    overrides: Record<string, unknown> = {}
  ) => ({
    ...basePayload,
    input,
    ...overrides,
  })

  /**
   * A non-JSON body here is usually a gateway/CDN HTML page, and this string reaches the
   * user-facing block error and the trace span — so it is bounded rather than pasted in
   * whole. Falls back to `statusText` when the body carries nothing useful.
   */
  const parseErrorResponse = async (response: Response): Promise<string> => {
    const text = await response.text().catch(() => '')
    try {
      const payload = JSON.parse(text)
      if (payload?.error?.message) return payload.error.message
    } catch {}
    return truncate(text.trim(), 500) || response.statusText || `HTTP ${response.status}`
  }

  /**
   * OpenAI rejects `reasoning.summary` with a 400 for organizations that have
   * not completed verification. Summaries are best-effort chrome, so on that
   * specific failure the request is retried once without the summary field
   * rather than failing the run.
   */
  const isReasoningSummaryVerificationError = (status: number, message: string): boolean =>
    status === 400 &&
    message.includes('reasoning.summary') &&
    message.toLowerCase().includes('verif')

  const stripReasoningSummary = (body: Record<string, unknown>): Record<string, unknown> | null => {
    const reasoning = body.reasoning as Record<string, unknown> | undefined
    if (!reasoning || reasoning.summary === undefined) return null
    const { summary: _summary, ...reasoningRest } = reasoning
    const { reasoning: _reasoning, ...bodyRest } = body
    return Object.keys(reasoningRest).length > 0
      ? { ...bodyRest, reasoning: reasoningRest }
      : bodyRest
  }

  let reasoningSummariesUnavailable = false

  /**
   * One POST, paired with a deadline that can bound any body read on the response.
   *
   * The deadline is created here rather than by the caller because a non-2xx body is
   * read inside this function, before the caller ever sees the response — an error body
   * that stalls would otherwise hang unbounded until the runtime's socket wall, which is
   * exactly the failure this change exists to remove.
   */
  const postOnce = async (
    bodyToSend: Record<string, unknown>,
    abortSignal: AbortSignal | undefined
  ): Promise<{ response: Response; bodyDeadline: AbortController }> => {
    const bodyDeadline = new AbortController()
    const signal = abortSignal
      ? AbortSignal.any([abortSignal, bodyDeadline.signal])
      : bodyDeadline.signal
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(bodyToSend),
      signal,
    })
    return { response, bodyDeadline }
  }

  /** Reads a non-2xx body under the same deadline that bounds a successful one. */
  const readErrorBody = async (
    response: Response,
    bodyDeadline: AbortController
  ): Promise<string> => {
    const timer = setTimeout(() => {
      bodyDeadline.abort(new DOMException('response body stalled', 'TimeoutError'))
    }, RESPONSE_BODY_BUDGET_MS)
    try {
      return await parseErrorResponse(response)
    } finally {
      clearTimeout(timer)
    }
  }

  const fetchResponsesAttempt = async (
    requestedBody: Record<string, unknown>,
    abortSignal: AbortSignal | undefined
  ): Promise<Response> => {
    const body = reasoningSummariesUnavailable
      ? (stripReasoningSummary(requestedBody) ?? requestedBody)
      : requestedBody
    const { response, bodyDeadline } = await postOnce(body, abortSignal)
    if (response.ok) return response

    const message = await readErrorBody(response, bodyDeadline)
    const strippedBody = isReasoningSummaryVerificationError(response.status, message)
      ? stripReasoningSummary(body)
      : null
    if (!strippedBody) {
      throw new ResponsesHttpError(
        `${config.providerLabel} API error (${response.status}): ${message}`,
        response.status,
        readRetryAfterMs(response.headers)
      )
    }

    reasoningSummariesUnavailable = true
    logger.warn(
      `${config.providerLabel} rejected reasoning summaries (organization not verified); retrying without summary`,
      { model: config.modelName }
    )
    const { response: retryResponse, bodyDeadline: retryDeadline } = await postOnce(
      strippedBody,
      abortSignal
    )
    if (!retryResponse.ok) {
      const retryMessage = await readErrorBody(retryResponse, retryDeadline)
      throw new ResponsesHttpError(
        `${config.providerLabel} API error (${retryResponse.status}): ${retryMessage}`,
        retryResponse.status,
        readRetryAfterMs(retryResponse.headers)
      )
    }
    return retryResponse
  }

  /**
   * Sends one Responses request, re-sending it on a refusal that created nothing
   * server-side (408/409/429/5xx) with exponential backoff and any `Retry-After`
   * the server supplied.
   *
   * The retry lives here rather than in `postResponses` so the streaming paths are
   * covered too: a rejected request never yields a body, so no stream bytes have
   * been handed to a consumer and no generation has started. Only transport
   * failures reach the caller unretried — an abort belongs to whoever raised it,
   * and a stalled body arrives after a response already exists, which makes it the
   * one class a retry would double-bill.
   */
  const fetchResponsesWithSummaryFallback = async (
    requestedBody: Record<string, unknown>,
    abortSignal = request.abortSignal
  ): Promise<Response> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fetchResponsesAttempt(requestedBody, abortSignal)
      } catch (error) {
        /**
         * A cancelled run reports the cancellation, never the status that happened to be
         * in flight when it was cancelled — surfacing the stale error would report a
         * cancelled run as a rate limit or a 5xx.
         */
        if (abortSignal?.aborted) {
          throw abortSignal.reason ?? error
        }

        const exhausted = attempt > MAX_RESPONSES_RETRIES
        if (
          exhausted ||
          !(error instanceof ResponsesHttpError) ||
          !isRetryableResponseStatus(error.status)
        ) {
          throw error
        }

        const delayMs = backoffWithJitter(attempt, error.retryAfterMs)
        logger.warn(`${config.providerLabel} request failed with a retryable status; retrying`, {
          attempt,
          status: error.status,
          delayMs,
          model: config.modelName,
          workflowId: request.workflowId,
          blockId: request.blockId,
          executionId: request.executionId,
        })
        await backoffDelay(delayMs, abortSignal)
      }
    }
  }

  /**
   * Annotates an opaque transport failure with the request phase it died in.
   *
   * A model call that stalls surfaces only the runtime's own message — Bun's
   * `TimeoutError: The operation timed out.` — which is indistinguishable between
   * "the request was never answered" and "the response arrived but its body never
   * completed". Those have opposite causes and opposite fixes, and the difference
   * is only observable from inside the call.
   *
   * The phase is folded into the error message rather than logged alone because
   * the message reaches the block's trace span, and the trace persists even when a
   * task has stopped shipping logs. Errors that already describe themselves (an
   * API error carrying a status and provider message) are left untouched; only
   * `TimeoutError`/`AbortError`, which name nothing, are annotated.
   */
  const annotateTransportFailure = (
    error: unknown,
    phase: 'awaiting-response-headers' | 'reading-response-body',
    startedAt: number,
    detail?: Record<string, string | number | null>
  ): unknown => {
    if (!(error instanceof Error)) return error
    if (error.name !== 'TimeoutError' && error.name !== 'AbortError') return error

    const elapsedMs = Date.now() - startedAt
    const fields = Object.entries(detail ?? {})
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
    const context = [`phase=${phase}`, `elapsedMs=${elapsedMs}`, ...fields].join(' ')

    logger.error(`${config.providerLabel} request failed in transport`, {
      phase,
      elapsedMs,
      errorName: error.name,
      model: config.modelName,
      workflowId: request.workflowId,
      blockId: request.blockId,
      executionId: request.executionId,
      ...detail,
    })

    /**
     * A new Error rather than a mutation: the runtime raises these as `DOMException`,
     * whose `message` is a readonly getter, so assigning to it throws a `TypeError` and
     * destroys the very failure being reported.
     *
     * `name` is copied and the original hangs off `cause` so the classification survives
     * — this error is rewrapped in a `ProviderError` further up, which overwrites `name`,
     * and the agent handler reads the cause to recognise a transport timeout.
     */
    const annotated = new Error(`${error.message} [${context}]`, { cause: error })
    annotated.name = error.name
    return annotated
  }

  const postResponses = async (
    body: Record<string, unknown>
  ): Promise<OpenAI.Responses.Response> => {
    const startedAt = Date.now()

    /**
     * Bounds the body read only — never time-to-headers.
     *
     * `/v1/responses` withholds its 200 until generation is finished, so the whole
     * think time lands in the headers phase and the body then transfers in about a
     * millisecond (measured: a 14.5s call spent 14545ms to headers and 1ms on the body).
     * Leaving headers unbounded therefore costs nothing and keeps slow reasoning models
     * working, while a stalled body — the documented failure where the 200 arrives and
     * the bytes never follow — is caught here instead of by the runtime's own ~300s
     * socket wall, which is variable, unnamed, and fires far too late to be useful.
     *
     * The failure is surfaced, not retried: `/v1/responses` ignores `Idempotency-Key`
     * (verified against the live API — the same key with an identical body returns two
     * distinct response ids and a conflicting body draws no 409), so a retry would
     * generate and bill a second response. Both the OpenAI SDK and the AI SDK likewise
     * decline to retry this class; the AI SDK classifies `TimeoutError` as an abort and
     * rethrows it.
     *
     * Scope: non-streaming only. The streaming path holds its body open by design, so a
     * deadline there would cut healthy generations; it keeps the runtime's socket wall.
     */
    const bodyDeadline = new AbortController()
    const signal = request.abortSignal
      ? AbortSignal.any([request.abortSignal, bodyDeadline.signal])
      : bodyDeadline.signal

    let response: Response
    try {
      response = await fetchResponsesWithSummaryFallback(body, signal)
    } catch (error) {
      throw annotateTransportFailure(error, 'awaiting-response-headers', startedAt)
    }

    /**
     * `x-request-id` is the only handle OpenAI support can trace a call by, so it is
     * captured here — a stalled request is exactly the case where we need to hand them
     * one, and it is unavailable once the body read fails.
     */
    const responseMeta = {
      status: response.status,
      ttfbMs: Date.now() - startedAt,
      requestId: response.headers.get('x-request-id'),
      contentLength: response.headers.get('content-length'),
      contentEncoding: response.headers.get('content-encoding'),
    }

    const timer = setTimeout(() => {
      bodyDeadline.abort(new DOMException('response body stalled', 'TimeoutError'))
    }, RESPONSE_BODY_BUDGET_MS)

    let parsed: OpenAI.Responses.Response
    try {
      parsed = await response.json()
    } catch (error) {
      throw annotateTransportFailure(error, 'reading-response-body', startedAt, responseMeta)
    } finally {
      clearTimeout(timer)
    }

    /**
     * Asserted here rather than at the call sites so every non-streaming turn — the
     * first and each tool-loop continuation — is covered by construction, and outside
     * the transport `try` so a rejected generation is never mistaken for a body stall.
     */
    assertUsableResponse(parsed, config.providerLabel)
    return parsed
  }

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    const hasActiveTools = Array.isArray(basePayload.tools) && basePayload.tools.length > 0

    if (request.stream && hasActiveTools) {
      logger.info(`Using live streaming tool loop for ${config.providerLabel} request`)
      const timeSegments: TimeSegment[] = []

      return createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: {
          kind: 'accumulated',
          modelTime: 0,
          toolsTime: 0,
          firstResponseTime: 0,
          iterations: 1,
          timeSegments,
        },
        initialTokens: { input: 0, output: 0, total: 0 },
        initialCost: { input: 0, output: 0, total: 0 },
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createOpenAIResponsesStreamingToolLoopStream({
            providerId: config.providerId,
            providerLabel: config.providerLabel,
            request,
            initialInput,
            initialToolChoice: responsesToolChoice,
            forcedTools: preparedTools?.forcedTools,
            createStream: (input, overrides, abortSignal) =>
              fetchResponsesWithSummaryFallback(createRequestBody(input, overrides), abortSignal),
            logger,
            timeSegments,
            onComplete: (result) => {
              output.content = result.content
              output.tokens = result.tokens
              output.cost = result.cost
              output.toolCalls = result.toolCalls as NormalizedBlockOutput['toolCalls']
              if (output.providerTiming) {
                output.providerTiming.modelTime = result.modelTime
                output.providerTiming.toolsTime = result.toolsTime
                output.providerTiming.firstResponseTime = result.firstResponseTime
                output.providerTiming.iterations = result.iterations
              }
              finalizeTiming()
            },
          }),
      })
    }

    if (request.stream && !hasActiveTools) {
      logger.info(`Using streaming response for ${config.providerLabel} request`)

      const streamResponse = await fetchResponsesWithSummaryFallback(
        createRequestBody(initialInput, { stream: true })
      )

      const streamingResult = createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: { kind: 'simple', segmentName: request.model },
        initialTokens: { input: 0, output: 0, total: 0 },
        initialCost: { input: 0, output: 0, total: 0 },
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createReadableStreamFromResponses(streamResponse, (content, usage, thinking) => {
            const accumulator = createOpenAIUsageAccumulator()
            addOpenAIUsage(accumulator, usage)

            output.content = content
            output.tokens = buildOpenAIUsageTokens(accumulator)
            output.cost = buildOpenAIUsageCost(request.model, accumulator)

            if (thinking) {
              const segment = output.providerTiming?.timeSegments?.[0]
              if (segment) {
                // Label honestly: these are reasoning *summaries*, not raw CoT.
                segment.thinkingContent = thinking
              }
            }

            finalizeTiming()
          }),
      })

      return streamingResult
    }

    const initialCallTime = Date.now()
    const forcedTools = preparedTools?.forcedTools || []
    let usedForcedTools: string[] = []
    let hasUsedForcedTool = false
    let currentToolChoice = responsesToolChoice
    let currentTrackingToolChoice = trackingToolChoice

    const checkForForcedToolUsage = (
      toolCallsInResponse: ResponsesToolCall[],
      toolChoice: ToolChoice | undefined
    ) => {
      if (typeof toolChoice === 'object' && toolCallsInResponse.length > 0) {
        const result = trackForcedToolUsage(
          toolCallsInResponse,
          toolChoice,
          logger,
          config.providerId,
          forcedTools,
          usedForcedTools
        )
        hasUsedForcedTool = result.hasUsedForcedTool
        usedForcedTools = result.usedForcedTools
      }
    }

    const currentInput: ResponsesInputItem[] = [...initialInput]
    let currentResponse = await postResponses(
      createRequestBody(currentInput, { tool_choice: currentToolChoice })
    )
    const firstResponseTime = Date.now() - initialCallTime

    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, parseResponsesUsage(currentResponse.usage))

    const toolCalls = []
    const toolResults: Record<string, unknown>[] = []
    let iterationCount = 0
    let modelTime = firstResponseTime
    let toolsTime = 0
    let content = extractResponseText(currentResponse.output) || ''

    const timeSegments: TimeSegment[] = [
      {
        type: 'model',
        name: request.model,
        startTime: initialCallTime,
        endTime: initialCallTime + firstResponseTime,
        duration: firstResponseTime,
      },
    ]

    checkForForcedToolUsage(
      extractResponseToolCalls(currentResponse.output),
      currentTrackingToolChoice
    )

    while (iterationCount < MAX_TOOL_ITERATIONS) {
      const responseText = extractResponseText(currentResponse.output)
      if (responseText) {
        content = responseText
      }

      const emittedToolCalls = extractResponseToolCalls(currentResponse.output)

      enrichLastModelSegmentFromOpenAIResponse(
        timeSegments,
        currentResponse,
        responseText,
        emittedToolCalls,
        { model: request.model }
      )

      /**
       * Mirrors `toolsExecutable` in the streaming tool loop: a tool call only runs
       * when it came from a finished generation.
       *
       * Unreachable today, and deliberately kept. `assertUsableResponse` already
       * rejects every status that could carry a tool call from an unfinished
       * generation — and because both it and `extractResponseToolCalls` key off the
       * same `function_call` output item, no response can reach here non-completed
       * with a tool call to run. It stays as the second lock on the invariant: these
       * two loops diverging on exactly this check is what produced the bug, and a
       * later relaxation of the assert would otherwise re-open it silently.
       */
      const toolsExecutable = !currentResponse.status || currentResponse.status === 'completed'
      const toolCallsInResponse = toolsExecutable ? emittedToolCalls : []

      if (emittedToolCalls.length > 0 && !toolsExecutable) {
        logger.warn('Skipping OpenAI tool execution', {
          status: currentResponse.status,
          toolCount: emittedToolCalls.length,
        })
      }

      if (!toolCallsInResponse.length) {
        break
      }

      const outputInputItems = convertResponseOutputToInputItems(currentResponse.output)
      if (outputInputItems.length) {
        currentInput.push(...outputInputItems)
      }

      logger.info(
        `Processing ${toolCallsInResponse.length} tool calls in parallel (iteration ${
          iterationCount + 1
        }/${MAX_TOOL_ITERATIONS})`
      )

      const toolsStartTime = Date.now()

      const toolExecutionPromises = toolCallsInResponse.map(async (toolCall) => {
        const toolCallStartTime = Date.now()
        const toolName = toolCall.name

        try {
          const toolArgs = parseToolArguments(toolCall.arguments, toolName)
          const tool = request.tools?.find((t) => t.id === toolName)

          if (!tool) {
            const toolCallEndTime = Date.now()
            return {
              toolCall,
              toolName,
              toolParams: {},
              result: {
                success: false,
                output: undefined,
                error: `Tool "${toolName}" is not available`,
              },
              startTime: toolCallStartTime,
              endTime: toolCallEndTime,
              duration: toolCallEndTime - toolCallStartTime,
            }
          }

          const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
          const result = await executeProviderTool(toolName, executionParams, {
            signal: request.abortSignal,
          })
          const toolCallEndTime = Date.now()

          return {
            toolCall,
            toolName,
            toolParams,
            result,
            startTime: toolCallStartTime,
            endTime: toolCallEndTime,
            duration: toolCallEndTime - toolCallStartTime,
          }
        } catch (error) {
          if (isAbortError(error) || request.abortSignal?.aborted) {
            throw error
          }
          const toolCallEndTime = Date.now()
          logger.error('Error processing tool call:', { error, toolName })

          return {
            toolCall,
            toolName,
            toolParams: {},
            result: {
              success: false,
              output: undefined,
              error: getErrorMessage(error, 'Tool execution failed'),
            },
            startTime: toolCallStartTime,
            endTime: toolCallEndTime,
            duration: toolCallEndTime - toolCallStartTime,
          }
        }
      })

      const executionResults = await Promise.all(toolExecutionPromises)

      for (const executionResult of executionResults) {
        const { toolCall, toolName, toolParams, result, startTime, endTime, duration } =
          executionResult

        timeSegments.push({
          type: 'tool',
          name: toolName,
          startTime: startTime,
          endTime: endTime,
          duration: duration,
          toolCallId: toolCall.id,
        })

        let resultContent: unknown
        if (result.success) {
          if (isRecordLike(result.output)) {
            toolResults.push(result.output)
          }
          resultContent = result.output ?? null
        } else {
          resultContent = {
            error: true,
            message: result.error || 'Tool execution failed',
            tool: toolName,
          }
        }

        toolCalls.push({
          name: toolName,
          arguments: toolParams,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          duration: duration,
          result: resultContent,
          success: result.success,
        })

        currentInput.push({
          type: 'function_call_output',
          call_id: toolCall.id,
          output: JSON.stringify(resultContent),
        })
      }

      const thisToolsTime = Date.now() - toolsStartTime
      toolsTime += thisToolsTime

      if (typeof currentToolChoice === 'object' && hasUsedForcedTool && forcedTools.length > 0) {
        const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

        if (remainingTools.length > 0) {
          currentToolChoice = {
            type: 'function',
            name: remainingTools[0],
          }
          currentTrackingToolChoice = {
            type: 'function',
            function: { name: remainingTools[0] },
          }
          logger.info(`Forcing next tool: ${remainingTools[0]}`)
        } else {
          currentToolChoice = 'auto'
          currentTrackingToolChoice = 'auto'
          logger.info('All forced tools have been used, switching to auto tool_choice')
        }
      }

      const nextModelStartTime = Date.now()

      currentResponse = await postResponses(
        createRequestBody(currentInput, { tool_choice: currentToolChoice })
      )

      checkForForcedToolUsage(
        extractResponseToolCalls(currentResponse.output),
        currentTrackingToolChoice
      )

      const latestText = extractResponseText(currentResponse.output)
      if (latestText) {
        content = latestText
      }

      const nextModelEndTime = Date.now()
      const thisModelTime = nextModelEndTime - nextModelStartTime

      timeSegments.push({
        type: 'model',
        name: request.model,
        startTime: nextModelStartTime,
        endTime: nextModelEndTime,
        duration: thisModelTime,
      })

      modelTime += thisModelTime

      addOpenAIUsage(usage, parseResponsesUsage(currentResponse.usage))

      iterationCount++
    }

    if (iterationCount === MAX_TOOL_ITERATIONS) {
      const trailingText = extractResponseText(currentResponse.output)
      const trailingToolCalls = extractResponseToolCalls(currentResponse.output)
      enrichLastModelSegmentFromOpenAIResponse(
        timeSegments,
        currentResponse,
        trailingText,
        trailingToolCalls,
        { model: request.model }
      )
    }

    const providerEndTime = Date.now()
    const providerEndTimeISO = new Date(providerEndTime).toISOString()
    const totalDuration = providerEndTime - providerStartTime

    return {
      content,
      model: request.model,
      tokens: buildOpenAIUsageTokens(usage),
      /**
       * No tool cost here: `executeProviderRequest` re-derives it from
       * `toolResults` for non-streaming responses, so folding it in would
       * double-charge it.
       */
      cost: buildOpenAIUsageCost(request.model, usage),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
      timing: {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
        modelTime: modelTime,
        toolsTime: toolsTime,
        firstResponseTime: firstResponseTime,
        iterations: iterationCount + 1,
        timeSegments: timeSegments,
      },
    }
  } catch (error) {
    const providerEndTime = Date.now()
    const providerEndTimeISO = new Date(providerEndTime).toISOString()
    const totalDuration = providerEndTime - providerStartTime

    logger.error(`Error in ${config.providerLabel} request:`, {
      error,
      duration: totalDuration,
    })

    if (isAbortError(error) || request.abortSignal?.aborted) {
      throw error
    }

    throw new ProviderError(
      toError(error).message,
      {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      },
      { cause: error }
    )
  }
}
