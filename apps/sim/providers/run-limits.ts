import { isRecordLike, omit, toRecordOrNull } from '@sim/utils/object'
import { NonRetryableExecutionError } from '@/lib/execution/non-retryable-error'
import type { ConversationProtocol } from '@/lib/memory/conversation-types'
import type { TokenUsageCost } from '@/providers/pricing'
import { billedUserStop } from '@/providers/run-usage-limit'
import type { ProviderRuntimeContext } from '@/providers/runtime-context'
import type { ProviderRequest } from '@/providers/types'

type RunLimitReason = 'spend_limit' | 'step_limit' | 'time_limit'

export interface RunLimitsConfig {
  /** Billed cost of the run's model calls and tools, in USD. */
  maxCost?: number
  /** Model responses whose tool calls may run. */
  maxSteps?: number
  maxDurationMs?: number
  /** Once the agent still wants tools past a limit: answer without them, or fail the block. */
  onLimit: 'finalize' | 'fail'
}

/** A run stopped at a limit its Agent block set. Never retried and never handed to a fallback. */
export class RunLimitError extends NonRetryableExecutionError {
  constructor(message: string) {
    super(message)
    this.name = 'RunLimitError'
  }
}

/**
 * Tool rounds a provider may still request after being told to answer: Bedrock and Ollama cannot
 * refuse tools, so their calls are refused instead, and a model that asks again fails the run.
 */
const MAX_IGNORED_ANSWER_REQUESTS = 1

/** What the model reads in place of a tool result once its run has stopped. */
export const RUN_LIMIT_TOOL_REFUSAL =
  'Not run: this agent reached its run limit. Answer with the information you already have.'

/**
 * The spend, step, and time limits of one Agent block run, shared by every model it tries.
 *
 * A limit acts only when the agent wants to keep using tools: the call after the last allowed step
 * answers without them, and a tool the model calls past a limit is refused. Calls that offer no
 * agent tools, such as a provider's structured-output pass, are never limited.
 */
export class AgentRunLimits {
  private readonly startedAt = Date.now()
  /** Each model attempt's settled cost, with what it carried in from earlier attempts. */
  private readonly settledCosts = new Map<TokenUsageCost, number>()
  private steps = 0
  private stepOpen = false
  private reached: RunLimitReason | undefined
  private output: Record<string, unknown> | undefined
  private toldToAnswer = false
  private toolRefused = false
  private ignoredAnswerRequests = 0

  constructor(private readonly config: RunLimitsConfig) {}

  get stopReason(): RunLimitReason | 'completed' {
    return this.reached ?? 'completed'
  }

  /** Keeps `output.stopReason` current: a streamed run stops after its output is handed back. */
  reportOn(output: Record<string, unknown>): void {
    this.output = output
    output.stopReason = this.stopReason
  }

  /**
   * Starts a model call. Returns true when a call that offers tools must answer without them, and
   * throws when the run must fail because the model asked for tools past its limit.
   */
  beginModelCall(settledCost: TokenUsageCost | undefined, offersTools: boolean): boolean {
    if (settledCost && !this.settledCosts.has(settledCost)) {
      this.settledCosts.set(settledCost, settledCost.total)
    }
    this.stepOpen = false
    if (this.toolRefused) {
      this.toolRefused = false
      if (
        this.config.onLimit === 'fail' ||
        (this.toldToAnswer && ++this.ignoredAnswerRequests > MAX_IGNORED_ANSWER_REQUESTS)
      ) {
        throw this.failure(settledCost)
      }
    }
    if (!offersTools || this.config.onLimit === 'fail') return false
    const reached = this.reached ?? this.reachedLimit()
    if (!reached) return false
    this.stop(reached)
    this.toldToAnswer = true
    return true
  }

  /** Admits a tool call; the first one of a model response starts a step. False refuses it. */
  admitTool(): boolean {
    if (this.stepOpen) return true
    const reached = this.reached ?? this.reachedLimit()
    if (reached) {
      this.stop(reached)
      this.toolRefused = true
      return false
    }
    this.stepOpen = true
    this.steps++
    return true
  }

  private stop(reason: RunLimitReason): void {
    this.reached = reason
    if (this.output) this.output.stopReason = reason
  }

  private reachedLimit(): RunLimitReason | undefined {
    const { maxCost, maxSteps, maxDurationMs } = this.config
    if (maxCost !== undefined && this.spend() >= maxCost) return 'spend_limit'
    if (maxSteps !== undefined && this.steps >= maxSteps) return 'step_limit'
    if (maxDurationMs !== undefined && Date.now() - this.startedAt >= maxDurationMs) {
      return 'time_limit'
    }
    return undefined
  }

  /** Spend since each attempt began; a fallback or retry carries in journaled cost already counted. */
  private spend(): number {
    let total = 0
    for (const [cost, carriedIn] of this.settledCosts) total += cost.total - carriedIn
    return total
  }

  private failure(settledCost: TokenUsageCost | undefined): RunLimitError {
    return billedUserStop(new RunLimitError(this.describe()), settledCost)
  }

  private describe(): string {
    switch (this.reached) {
      case 'spend_limit':
        return `Agent stopped at its spend limit of $${this.config.maxCost}.`
      case 'step_limit':
        return `Agent stopped at its limit of ${this.config.maxSteps} steps.`
      default:
        return `Agent stopped at its time limit of ${(this.config.maxDurationMs ?? 0) / 1000} seconds.`
    }
  }
}

/**
 * The same request with the agent's tool calls turned off in the wire format of `protocol`, or
 * undefined when it offers none to turn off. Each shape is the one that protocol's tool loops
 * already send for their final answer: several chat-completions providers (Z.ai, Meta, Kimi)
 * reject `tool_choice: 'none'`, so their tools are dropped; Anthropic and Bedrock reject tool
 * history without tool definitions, so theirs stay, and Bedrock, which cannot refuse, relaxes a
 * forced choice to `auto`.
 */
function withoutAgentToolCalls<T>(
  protocol: ConversationProtocol,
  payload: T,
  request: ProviderRequest
): T | undefined {
  if (!isRecordLike(payload)) return undefined
  switch (protocol) {
    case 'chat-completions':
      if (!payload.tools) return undefined
      return omit(payload, ['tools', 'tool_choice', 'parallel_tool_calls']) as T
    case 'responses':
      if (!payload.tools) return undefined
      return { ...omit(payload, ['tools']), tool_choice: 'none' } as T
    case 'anthropic':
      if (!payload.tools || toRecordOrNull(payload.tool_choice)?.type === 'none') return undefined
      return { ...payload, tool_choice: { type: 'none' } } as T
    case 'gemini': {
      const config = toRecordOrNull(payload.config)
      if (!config?.tools) return undefined
      return { ...payload, config: omit(config, ['tools', 'toolConfig']) } as T
    }
    case 'bedrock': {
      const toolConfig = toRecordOrNull(payload.toolConfig)
      if (!toolConfig) return undefined
      // Bedrock's structured output is a forced tool of its own, which must still run.
      const forced = toRecordOrNull(toRecordOrNull(toolConfig.toolChoice)?.tool)?.name
      if (typeof forced === 'string' && !request.tools?.some((tool) => tool.id === forced)) {
        return undefined
      }
      return { ...payload, toolConfig: { ...toolConfig, toolChoice: { auto: {} } } } as T
    }
  }
}

/** Applies the Agent's run limits to the model call about to send `payload`. */
export function applyRunLimits<T>(
  runtime: ProviderRuntimeContext | undefined,
  request: ProviderRequest,
  protocol: ConversationProtocol,
  payload: T
): T {
  const runLimits = runtime?.runLimits
  if (!runLimits) return payload
  const answerPayload = withoutAgentToolCalls(protocol, payload, request)
  const mustAnswer = runLimits.beginModelCall(runtime.settledCost, answerPayload !== undefined)
  return mustAnswer && answerPayload ? answerPayload : payload
}
