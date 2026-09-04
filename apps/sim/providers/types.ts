import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { CustomBlockInputFieldType } from '@/blocks/custom/build-config'
import type { ProviderTimingSegment, StreamingExecution, UserFile } from '@/executor/types'

export type ProviderId =
  | 'openai'
  | 'azure-openai'
  | 'anthropic'
  | 'azure-anthropic'
  | 'google'
  | 'vertex'
  | 'deepseek'
  | 'xai'
  | 'cerebras'
  | 'groq'
  | 'sakana'
  | 'nvidia'
  | 'meta'
  | 'zai'
  | 'kimi'
  | 'mistral'
  | 'ollama'
  | 'ollama-cloud'
  | 'openrouter'
  | 'fireworks'
  | 'together'
  | 'baseten'
  | 'vllm'
  | 'litellm'
  | 'bedrock'

export interface ModelTokenPricing {
  input: number // Per 1M tokens
  cachedInput?: number // Per 1M tokens (if supported)
  output: number // Per 1M tokens
}

export interface ModelPricingTier extends ModelTokenPricing {
  /** Tier applies to the full request when total input tokens exceed this value. */
  aboveInputTokens: number
}

export interface ModelPricing extends ModelTokenPricing {
  /** Additional input-size tiers; the highest matching threshold wins. */
  tiers?: ModelPricingTier[]
  updatedAt: string // Last updated date
}

export type ModelPricingMap = Record<string, ModelPricing>

interface TokenInfo {
  input?: number
  output?: number
  total?: number
}

interface TransformedResponse {
  content: string
  tokens?: TokenInfo
}

export interface ProviderConfig {
  id: string
  name: string
  description: string
  version: string
  models: string[]
  defaultModel: string
  initialize?: () => Promise<void>
  executeRequest: (
    request: ProviderRequest
  ) => Promise<ProviderResponse | ReadableStream<any> | StreamingExecution>
}

export interface FunctionCallResponse {
  name: string
  arguments: Record<string, any>
  startTime?: string
  endTime?: string
  duration?: number
  result?: unknown
  output?: Record<string, any>
  input?: Record<string, any>
  success?: boolean
}

/**
 * Provider-side alias for the canonical segment type. Providers push these into
 * `providerTiming.timeSegments` during execution; the trace pipeline reads them
 * verbatim when constructing child spans.
 */
export type TimeSegment = ProviderTimingSegment

export interface ProviderResponse {
  content: string
  model: string
  tokens?: {
    /** Tokens billed at the base input rate, excluding cache reads and writes. */
    input?: number
    output?: number
    total?: number
    /** Input tokens served from the provider's prompt cache. */
    cacheRead?: number
    /** Input tokens written to the provider's prompt cache. */
    cacheWrite?: number
  }
  toolCalls?: FunctionCallResponse[]
  toolResults?: Record<string, unknown>[]
  timing?: {
    startTime: string
    endTime: string
    duration: number
    modelTime?: number
    toolsTime?: number
    firstResponseTime?: number
    iterations?: number
    timeSegments?: TimeSegment[]
  }
  cost?: {
    input: number
    output: number
    toolCost?: number
    total: number
    pricing: ModelPricing
  }
  /** Interaction ID returned by the Interactions API (used for multi-turn deep research) */
  interactionId?: string
}

export type ToolUsageControl = 'auto' | 'force' | 'none'

export interface ProviderToolConfig {
  /** Canonical registry id when {@link id} is a request-scoped provider wire alias. */
  canonicalId?: string
  id: string
  description: string
  params: Record<string, any>
  parameters: {
    type: string
    properties: Record<string, any>
    required: string[]
  }
  usageControl?: ToolUsageControl
  /**
   * Params the model may never supply, because the tool declares them
   * `user-only` or `hidden`. Stripped from the model's arguments before they
   * merge with the user's — omitting them from {@link ProviderToolConfig.parameters}
   * alone does not stop a model from emitting one anyway.
   */
  modelBlockedParams?: string[]
  /** Block-level params transformer — converts SubBlock values to tool-ready params */
  paramsTransform?: (params: Record<string, any>) => Record<string, any>
  /**
   * Params {@link ProviderToolConfig.paramsTransform} decodes from a JSON string into
   * an object or array.
   *
   * The resolved-secret projection must give these keys the same treatment it gives a
   * `json`/`array` block input: a projected copy holds `{{NAME}}` placeholders that are
   * not valid JSON, so without this the real params parse to an object while the
   * projected ones stay a string, and the shape divergence silently marks the
   * provenance registry incomplete.
   */
  jsonShapedParamKeys?: readonly string[]
  /**
   * A custom (deploy-as-block) block's Start input fields, resolved from its binding
   * rather than the block config — the server overlay builds those with `inputFields: []`.
   *
   * The resolved-secret projection reassembles `inputMapping` and must decode it against
   * the identical fields, or its shape diverges from the executed copy.
   */
  customBlockInputFields?: readonly CustomBlockInputFieldType[]
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool'
  content: string | null
  files?: UserFile[]
  name?: string
  function_call?: {
    name: string
    arguments: string
  }
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

export interface ProviderRequest {
  model: string
  systemPrompt?: string
  context?: string
  tools?: ProviderToolConfig[]
  temperature?: number
  maxTokens?: number
  apiKey?: string
  messages?: Message[]
  responseFormat?: {
    name: string
    schema: any
    strict?: boolean
  }
  local_execution?: boolean
  workflowId?: string
  workspaceId?: string
  chatId?: string
  userId?: string
  stream?: boolean
  /**
   * Run-level agent-events opt-in. Lets providers request streamable thinking
   * (e.g. OpenAI reasoning summaries, Gemini thought summaries) and lets opted-in
   * consumers observe the event timeline. It does not select the internal tool
   * loop and never changes answer content.
   */
  agentEvents?: boolean
  environmentVariables?: Record<string, string>
  workflowVariables?: Record<string, any>
  blockData?: Record<string, any>
  blockNameMapping?: Record<string, string>
  isCopilotRequest?: boolean
  isBYOK?: boolean
  azureEndpoint?: string
  azureApiVersion?: string
  vertexProject?: string
  vertexLocation?: string
  bedrockAccessKeyId?: string
  bedrockSecretKey?: string
  bedrockRegion?: string
  reasoningEffort?: string
  verbosity?: string
  thinkingLevel?: string
  /**
   * Opt in to caller-placed prompt-cache breakpoints on the static prefix.
   * Only meaningful for models declaring `capabilities.promptCaching`;
   * `sanitizeRequest` clears it otherwise.
   */
  promptCaching?: boolean
  /** Stable identity of the block issuing the request, used for cache routing. */
  blockId?: string
  isDeployedContext?: boolean
  callChain?: string[]
  /**
   * The invoking run's execution id. Propagated into the `_context` of every
   * tool the LLM invokes so a tool that starts its own child execution (a
   * custom block) can correlate that child back to a REAL invoking run rather
   * than a freshly-minted id, and can honour its cancellation.
   */
  executionId?: string
  /**
   * Immutable actor/payer decision captured before execution. Propagated into
   * the `_context` of every tool the LLM invokes so internal routes that
   * require the billing attribution header (e.g. knowledge search) receive it.
   */
  billingAttribution?: BillingAttributionSnapshot
  /** Previous interaction ID for multi-turn Interactions API requests (deep research follow-ups) */
  previousInteractionId?: string
  abortSignal?: AbortSignal
}

/**
 * Typed error class for provider failures that includes timing information.
 */
export class ProviderError extends Error {
  timing: {
    startTime: string
    endTime: string
    duration: number
  }

  /**
   * `options.cause` should carry the error being wrapped. `name` is deliberately
   * overwritten with `'ProviderError'`, so without a cause every classification the
   * original carried — notably a transport `TimeoutError` — is lost to callers.
   */
  constructor(
    message: string,
    timing: { startTime: string; endTime: string; duration: number },
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ProviderError'
    this.timing = timing
  }
}

export const providers: Record<string, ProviderConfig> = {}
