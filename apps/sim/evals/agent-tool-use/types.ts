/**
 * Declarative contract for the agent tool-use eval suite.
 *
 * A scenario is a scripted model transcript against the real OpenAI-compatible
 * streaming tool loop (`providers/openai-compat/streaming-tool-loop.ts`). The
 * loop is the harness under test: it must dispatch the tools the model asks
 * for, feed results back, and recover from tool failures without losing the
 * turn. The model is an input, so scenarios stay deterministic and run in CI
 * with no provider key.
 */

/** The agent behavior a scenario measures. */
export type EvalCategory = 'tool-selection' | 'planning' | 'retrieval' | 'recovery'

/** A tool exposed to the scripted model for one scenario. */
export interface EvalToolDefinition {
  name: string
  description: string
  parameters?: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
  }
}

/** Result the stub tool returns for one scripted call. */
export interface EvalToolResult {
  success: boolean
  output?: Record<string, unknown>
  error?: string
}

/** One tool invocation the scripted model asks for. */
export interface ScriptedToolCall {
  name: string
  args?: Record<string, unknown>
  /**
   * Raw JSON emitted instead of serializing {@link args}. Used to exercise the
   * loop's malformed-arguments guard, which must not execute the tool.
   */
  argumentsJson?: string
  /** Stub result for this call; defaults to `{ success: true, output: {} }`. */
  result?: EvalToolResult
}

/** One model turn: either a set of tool calls or a final answer. */
export type ScriptedModelTurn =
  | { kind: 'tools'; calls: ScriptedToolCall[]; thinking?: string }
  | { kind: 'answer'; content: string; thinking?: string }

/** Assertions applied to a completed run. */
export interface AgentToolUseExpectations {
  /** Exact ordered sequence of tool names the model asked for. */
  toolCallSequence?: string[]
  /** Tool names that must appear at least once. */
  requiredTools?: string[]
  /** Tool names that must never be called. */
  forbiddenTools?: string[]
  /** Substring or pattern the final assistant content must match. */
  finalContent?: string | RegExp
  /** Upper bound on tool iterations. */
  maxIterations?: number
  /** Exact count of tool calls that returned success. */
  successfulToolCalls?: number
  /** Exact count of tool calls that returned an error. */
  erroredToolCalls?: number
  /** Whether the loop must settle without throwing. Defaults to `true`. */
  completesWithoutError?: boolean
}

/** A single agent behavior case. */
export interface AgentToolUseScenario {
  id: string
  name: string
  category: EvalCategory
  description: string
  userMessage: string
  tools: EvalToolDefinition[]
  script: ScriptedModelTurn[]
  expect: AgentToolUseExpectations
}

/** One scored expectation. */
export interface EvalCheck {
  name: string
  passed: boolean
  detail: string
}

/** A tool call the loop actually executed through `executeTool`. */
export interface EvalToolInvocation {
  name: string
  arguments: Record<string, unknown>
  success: boolean
  error?: string
  durationMs: number
}

/** Measured properties of one completed run. */
export interface AgentToolUseMetrics {
  iterations: number
  toolCalls: number
  successfulToolCalls: number
  erroredToolCalls: number
  latencyMs: number
  modelTimeMs: number
  toolsTimeMs: number
  firstResponseTimeMs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** The scored outcome of one scenario. */
export interface AgentToolUseResult {
  id: string
  name: string
  category: EvalCategory
  passed: boolean
  checks: EvalCheck[]
  finalContent: string
  toolInvocations: EvalToolInvocation[]
  metrics: AgentToolUseMetrics
  error?: string
}
