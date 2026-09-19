import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import type {
  AgentConversationSession,
  AgentTurnState,
  CapturedConversationStep,
  ConversationStep,
  ConversationToolResult,
  ConversationUsageTotal,
  NativeConversationMessage,
} from '@/lib/memory/conversation-types'
import { renderConversationExecutionRecord } from '@/lib/memory/execution-record'
import { setNativeConversationMessage } from '@/providers/conversation-metadata'
import type { Message, ProviderId } from '@/providers/types'

export interface AgentTurnStateWriter {
  /** Payloads are immutable; writers must not mutate this structural snapshot. */
  save(state: AgentTurnState, completed?: ConversationStep): Promise<void>
  prepareStep?(step: ConversationStep): Promise<ConversationStep>
  prepareResult?(result: ConversationToolResult): Promise<ConversationToolResult>
}

/** One instance belongs to one executor-assigned invocation, including its existing retries. */
export class AgentTurnStateMachine implements AgentConversationSession {
  protected readonly state: AgentTurnState
  private readonly claimed = new Set<string>()
  private readonly captured = new WeakSet<object>()
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly writer: AgentTurnStateWriter,
    state?: AgentTurnState
  ) {
    this.state = state ?? { version: 1, steps: [] }
  }

  async captureStep(captured: CapturedConversationStep): Promise<void> {
    if (typeof captured.native.value === 'object' && captured.native.value !== null) {
      if (this.captured.has(captured.native.value)) return
      this.captured.add(captured.native.value)
    }
    let step: ConversationStep = {
      id: generateId(),
      assistant: structuredClone(captured.assistant),
      calls: captured.calls.map((call) => ({ ...call, invocationId: generateId() })),
      results: [],
      native: structuredClone(captured.native),
      usage: captured.usage,
      cost: captured.cost,
    }
    if (this.writer.prepareStep) step = await this.writer.prepareStep(step)
    this.state.steps.push(step)
    await this.save()
  }

  resolveInvocationId(providerCallId: string | undefined, toolId: string): string | undefined {
    const step = this.state.steps.at(-1)
    if (!step) return undefined
    const call = step.calls.find(
      (candidate) =>
        candidate.toolId === toolId &&
        (providerCallId !== undefined
          ? candidate.providerCallId === providerCallId
          : !this.claimed.has(candidate.invocationId))
    )
    if (call) this.claimed.add(call.invocationId)
    return call?.invocationId
  }

  getRecordedResult(invocationId: string): ConversationToolResult | undefined {
    for (const step of this.state.steps) {
      const result = step.results.find((candidate) => candidate.invocationId === invocationId)
      if (result) return result
    }
    return undefined
  }

  async getReplayResult(invocationId: string): Promise<ConversationToolResult | undefined> {
    return this.getRecordedResult(invocationId)
  }

  async recordToolResult(result: ConversationToolResult): Promise<void> {
    const step = this.state.steps.find((candidate) =>
      candidate.calls.some((call) => call.invocationId === result.invocationId)
    )
    if (!step || this.getRecordedResult(result.invocationId)) return
    const prepared = this.writer.prepareResult ? await this.writer.prepareResult(result) : result
    if (this.getRecordedResult(result.invocationId)) return
    step.results.push(structuredClone(prepared))
    await this.save(step.results.length === step.calls.length ? step : undefined)
  }

  async recordToolError(
    providerCallId: string | undefined,
    toolId: string,
    error: string
  ): Promise<void> {
    const invocationId = this.resolveInvocationId(providerCallId, toolId)
    if (!invocationId) return
    const response = { success: false, output: {}, error }
    await this.recordToolResult({ invocationId, rawResponse: response, modelResponse: response })
  }

  getPendingCalls() {
    return this.state.steps.flatMap((step) =>
      step.calls.filter(
        (call) => !step.results.some((result) => result.invocationId === call.invocationId)
      )
    )
  }

  getUsage(): ConversationUsageTotal {
    const total: ConversationUsageTotal = {
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: { input: 0, output: 0, total: 0, toolCost: 0 },
    }
    for (const step of this.state.steps) {
      total.tokens.input += step.usage?.input ?? 0
      total.tokens.output += step.usage?.output ?? 0
      total.tokens.cacheRead! += step.usage?.cacheRead ?? 0
      total.tokens.cacheWrite! +=
        step.usage?.cacheWrite ??
        step.usage?.cacheWrites?.reduce((sum, write) => sum + write.tokens, 0) ??
        0
      total.cost.input += step.cost?.input ?? 0
      total.cost.output += step.cost?.output ?? 0
      total.cost.total += step.cost?.total ?? 0
      for (const result of step.results) {
        const cost = result.rawResponse.output.cost
        if (
          isRecordLike(cost) &&
          typeof cost.total === 'number' &&
          Number.isFinite(cost.total) &&
          cost.total > 0
        ) {
          total.cost.toolCost += cost.total
          total.cost.total += cost.total
        }
      }
    }
    if (this.state.contextUsage) addUsageTotals(total, this.state.contextUsage)
    return total
  }

  async recordContextUsage(usage: ConversationUsageTotal): Promise<void> {
    const total: ConversationUsageTotal = {
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: { input: 0, output: 0, total: 0, toolCost: 0 },
    }
    if (this.state.contextUsage) addUsageTotals(total, this.state.contextUsage)
    addUsageTotals(total, usage)
    this.state.contextUsage = total
    await this.save()
  }

  getMessages(providerId: ProviderId, model: string, binding: string): Message[] {
    return this.state.steps.flatMap((step) => {
      if (step.results.length !== step.calls.length) return []
      const native = step.native
      const compatible =
        native?.providerId === providerId && native.model === model && native.binding === binding
      return renderConversationStep(step, compatible ? native : undefined)
    })
  }

  getFinalAssistantContent(): string | undefined {
    const last = this.state.steps.at(-1)
    return last && last.calls.length === 0 ? (last.assistant.content ?? undefined) : undefined
  }

  getFinalResponse(): AgentTurnState['final'] {
    return this.state.final ? { ...this.state.final } : undefined
  }

  async finalize(content: string, model: string): Promise<void> {
    if (this.state.final) return
    this.state.final = { content, model }
    await this.save()
  }

  protected async save(completed?: ConversationStep): Promise<void> {
    const state: AgentTurnState = {
      ...this.state,
      steps: this.state.steps.map((step) => ({ ...step, results: [...step.results] })),
      ...(this.state.final ? { final: { ...this.state.final } } : {}),
    }
    const exchange = completed ? state.steps.find((step) => step.id === completed.id) : undefined
    this.writes = this.writes.then(() => this.writer.save(state, exchange))
    await this.writes
  }
}

/** A complete batch stays adjacent and keeps provider call order, regardless of completion order. */
export function renderConversationStep(
  step: ConversationStep,
  native?: NativeConversationMessage
): Message[] {
  const assistant: Message = { ...step.assistant }
  if (step.calls.length === 0) {
    if (native) setNativeConversationMessage(assistant, native)
    return [assistant]
  }
  const malformedArguments = step.calls.some((call) => {
    try {
      return !isRecordLike(JSON.parse(call.modelArguments ?? call.arguments))
    } catch {
      return true
    }
  })
  assistant.tool_calls = step.calls.map((call) => ({
    id: call.providerCallId ?? call.invocationId,
    type: 'function',
    function: { name: call.toolId, arguments: call.modelArguments ?? call.arguments },
  }))
  const messages: Message[] = [
    assistant,
    ...step.calls.map((call): Message => {
      const result = step.results.find((candidate) => candidate.invocationId === call.invocationId)
      return {
        role: 'tool',
        name: call.toolId,
        tool_call_id: call.providerCallId ?? call.invocationId,
        content: JSON.stringify(
          result?.modelResponse.success
            ? result.modelResponse.output
            : {
                ...(result?.artifact ? { ...result.modelResponse.output, success: false } : {}),
                error: result?.modelResponse.error ?? 'Tool execution failed',
              }
        ),
      }
    }),
  ]
  if (step.historyUnavailable || malformedArguments)
    return [renderConversationExecutionRecord(messages)]
  if (native) setNativeConversationMessage(assistant, native)
  return messages
}

function addUsageTotals(target: ConversationUsageTotal, source: ConversationUsageTotal): void {
  target.tokens.input += source.tokens.input
  target.tokens.output += source.tokens.output
  target.tokens.cacheRead = (target.tokens.cacheRead ?? 0) + (source.tokens.cacheRead ?? 0)
  target.tokens.cacheWrite =
    (target.tokens.cacheWrite ?? 0) +
    (source.tokens.cacheWrite ??
      source.tokens.cacheWrites?.reduce((sum, write) => sum + write.tokens, 0) ??
      0)
  for (const key of ['input', 'output', 'total', 'toolCost'] as const)
    target.cost[key] += source.cost[key]
}
