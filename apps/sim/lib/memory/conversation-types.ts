import type { DurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import type { LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { Message, ProviderId } from '@/providers/types'
import type { ToolResponse } from '@/tools/types'

export type ConversationProtocol =
  | 'responses'
  | 'chat-completions'
  | 'anthropic'
  | 'gemini'
  | 'bedrock'

/** A provider's private continuation is meaningful only for its original request binding. */
export interface NativeConversationMessage {
  protocol: ConversationProtocol
  providerId: ProviderId
  model: string
  binding: string
  /** Bedrock reasoning can only be reused with its unchanged prior wire messages. */
  prefixHash?: string
  value: unknown
}

/** Model arguments are kept separately from configured execution parameters and credentials. */
export interface ConversationToolCall {
  invocationId: string
  providerCallId?: string
  toolId: string
  arguments: string
  modelArguments?: string
  configuredToolBinding?: string
}

export interface ConversationToolResult {
  invocationId: string
  modelResponse: ToolResponse
  /** Private execution replay data; never included in a conversation or its public projection. */
  rawResponse: ToolResponse
  provenance?: DurableSecretProvenance
  artifact?: LargeValueRef
}

export interface ConversationStep {
  id: string
  assistant: Message
  calls: ConversationToolCall[]
  results: ConversationToolResult[]
  native?: NativeConversationMessage
  provenance?: DurableSecretProvenance
  usage?: ConversationUsage
  cost?: { input: number; output: number; total: number }
  historyUnavailable?: boolean
}

export interface ConversationUsage {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  cacheWrites?: Array<{ tokens: number; inputRateMultiplier: number }>
}

export interface ConversationUsageTotal {
  tokens: ConversationUsage
  cost: { input: number; output: number; total: number; toolCost: number }
}

export interface AgentTurnState {
  version: 1
  steps: ConversationStep[]
  final?: { content: string; model: string }
}

export interface CapturedConversationStep {
  assistant: Message
  calls: Array<{
    providerCallId?: string
    toolId: string
    arguments: string
    configuredToolBinding?: string
  }>
  native: NativeConversationMessage
  usage?: ConversationUsage
  cost?: { input: number; output: number; total: number }
}

/** Internal lifecycle supplied only by the Workflow Agent, never by provider request JSON. */
export interface AgentConversationSession {
  getFinalResponse(): AgentTurnState['final']
  getFinalAssistantContent(): string | undefined
  readonly memoryId?: string
  getUsage(): ConversationUsageTotal
  captureStep(step: CapturedConversationStep): Promise<void>
  resolveInvocationId(providerCallId: string | undefined, toolId: string): string | undefined
  getReplayResult(invocationId: string): Promise<ConversationToolResult | undefined>
  restoreProvenance?(registry: ResolvedSecretTraceRegistry): Promise<void>
  recordToolResult(result: ConversationToolResult): Promise<void>
  recordToolError(providerCallId: string | undefined, toolId: string, error: string): Promise<void>
  getPendingCalls(): ConversationToolCall[]
  getMessages(providerId: ProviderId, model: string, binding: string): Message[]
}
