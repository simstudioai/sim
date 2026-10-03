import { isDeepStrictEqual } from 'node:util'
import { createLogger } from '@sim/logger'
import { collectStream } from '@sim/testing/helpers/async'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { isRecordLike } from '@sim/utils/object'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { type JudgeRubric, judgeAnswer } from '@/evals/agent-tool-use/judge'
import type {
  AgentToolUseExpectations,
  AgentToolUseResult,
  AgentToolUseScenario,
  EvalCheck,
  EvalToolDefinition,
  EvalToolInvocation,
  ScriptedModelTurn,
  ScriptedToolCall,
} from '@/evals/agent-tool-use/types'
import {
  createOpenAICompatStreamingToolLoopStream,
  type OpenAICompatCreateCompletion,
} from '@/providers/openai-compat/streaming-tool-loop'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { StreamingToolLoopComplete } from '@/providers/streaming-tool-loop-shared'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import type { ProviderToolConfig, TimeSegment } from '@/providers/types'
import type { ToolResponse } from '@/tools/types'

/**
 * Runs one scenario through the real OpenAI-compatible streaming tool loop and
 * scores the result. Vitest owns the `@/tools`, `@/providers` and
 * `@/providers/utils` module mocks; this module only drives them.
 */

const EVAL_MODEL = 'eval-model'
const EVAL_PROVIDER = 'Eval'
const MAX_TOOL_ITERATIONS = 20

const logger = createLogger('AgentToolUseEval')

interface CapturedToolCall {
  name: string
  arguments: Record<string, unknown>
  success: boolean
  result?: unknown
  duration?: number
}

interface ToolCallList {
  list: CapturedToolCall[]
  count: number
}

/** Scripted runs assert exact behavior; live runs assert outcomes across trials. */
export type EvalRunMode = 'scripted' | 'live'

/** Options for {@link runScenario}. */
export interface RunScenarioOptions {
  /** Model turns. Defaults to the scenario's scripted turns. */
  completion?: OpenAICompatCreateCompletion
  mode?: EvalRunMode
  /** Model id sent to a live provider and recorded in the run. */
  model?: string
  /** Provider label used in loop diagnostics. */
  providerName?: string
  /** Optional LLM-as-judge scorer for the answer; adds a `judge` check. */
  judge?: {
    completion: OpenAICompatCreateCompletion
    model: string
    rubric: JudgeRubric
  }
}

/** Raw call counts as a value the loop never reads; scenarios only assert on it. */
const COMPLETION_USAGE = (): CompletionUsage => ({
  prompt_tokens: 10,
  completion_tokens: 5,
  total_tokens: 15,
})

let chunkCounter = 0

function chunk(
  delta: ChatCompletionChunk.Choice['delta'] & { reasoning_content?: string },
  finishReason: ChatCompletionChunk.Choice['finish_reason'] = null,
  usage?: CompletionUsage
): ChatCompletionChunk {
  chunkCounter += 1
  return {
    id: `eval-chunk-${chunkCounter}`,
    object: 'chat.completion.chunk',
    created: 0,
    model: EVAL_MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
    ...(usage ? { usage } : {}),
  }
}

function turnToChunks(turn: ScriptedModelTurn): ChatCompletionChunk[] {
  if (turn.kind === 'answer') {
    return [
      ...(turn.thinking ? [chunk({ reasoning_content: turn.thinking })] : []),
      chunk({ content: turn.content }, 'stop', COMPLETION_USAGE()),
    ]
  }

  const chunks: ChatCompletionChunk[] = []
  if (turn.thinking) chunks.push(chunk({ reasoning_content: turn.thinking }))
  turn.calls.forEach((call, index) => {
    chunks.push(
      chunk({
        tool_calls: [
          {
            index,
            id: `call_${index}`,
            type: 'function',
            function: {
              name: call.name,
              arguments: call.argumentsJson ?? JSON.stringify(call.args ?? {}),
            },
          },
        ],
      })
    )
  })
  chunks.push(chunk({}, 'tool_calls', COMPLETION_USAGE()))
  return chunks
}

/** A distinctive value from a call's stubbed result, to find it in tool feedback. */
function expectedResultMarker(call: ScriptedToolCall): string | undefined {
  if (call.result && !call.result.success) return call.result.error
  const output = call.result?.output
  if (!output) return undefined
  for (const value of Object.values(output)) {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (value && typeof value === 'object') return JSON.stringify(value)
  }
  return undefined
}

function toolMessageContents(messages: unknown): string[] {
  if (!Array.isArray(messages)) return []
  return messages
    .filter(
      (message): message is Record<string, unknown> =>
        isRecordLike(message) && message.role === 'tool'
    )
    .map((message) =>
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
    )
}

/**
 * The scripted model must read the tool feedback the loop forwarded, or the
 * retrieval/planning/recovery cases could pass even if the loop dropped it.
 * Throws (failing the scenario) when a prior turn's results are missing.
 */
function assertToolFeedbackForwarded(
  scenario: AgentToolUseScenario,
  currentTurnIndex: number,
  messages: unknown
): void {
  if (currentTurnIndex === 0) return
  const previous = scenario.script[currentTurnIndex - 1]
  if (!previous || previous.kind !== 'tools') return

  const contents = toolMessageContents(messages)
  if (contents.length < previous.calls.length) {
    throw new Error(
      `Scenario "${scenario.id}" did not receive tool feedback for turn ${currentTurnIndex}`
    )
  }

  const joined = contents.join('\n')
  for (const call of previous.calls) {
    const marker = expectedResultMarker(call)
    if (marker !== undefined && !joined.includes(marker)) {
      throw new Error(
        `Scenario "${scenario.id}" did not forward the ${call.name} result for turn ${currentTurnIndex}`
      )
    }
  }
}

function createScriptedCompletion(scenario: AgentToolUseScenario): OpenAICompatCreateCompletion {
  let turnIndex = 0
  return async (params) => {
    const currentTurnIndex = turnIndex
    turnIndex += 1
    const turn = scenario.script[currentTurnIndex]
    if (!turn) {
      throw new Error(
        `Scenario "${scenario.id}" requested model turn ${turnIndex} but only ${scenario.script.length} are scripted`
      )
    }
    assertToolFeedbackForwarded(scenario, currentTurnIndex, params.messages)
    return (async function* () {
      for (const next of turnToChunks(turn)) yield next
    })()
  }
}

function toProviderTools(tools: EvalToolDefinition[]): ProviderToolConfig[] {
  return tools.map((tool) => ({
    id: tool.name,
    description: tool.description,
    params: {},
    parameters: {
      type: tool.parameters?.type ?? 'object',
      properties: tool.parameters?.properties ?? {},
      required: tool.parameters?.required ?? [],
    },
  }))
}

/** Every call the script emits that the loop is expected to execute. */
function expectedExecutableCalls(
  scenario: AgentToolUseScenario
): Array<{ name: string; args: Record<string, unknown> }> {
  const expected: Array<{ name: string; args: Record<string, unknown> }> = []
  for (const turn of scenario.script) {
    if (turn.kind !== 'tools') continue
    for (const call of turn.calls) {
      if (call.argumentsJson === undefined) {
        expected.push({ name: call.name, args: call.args ?? {} })
        continue
      }
      try {
        const parsed = JSON.parse(call.argumentsJson)
        if (isRecordLike(parsed)) expected.push({ name: call.name, args: parsed })
      } catch {
        // Malformed arguments are never executed.
      }
    }
  }
  return expected
}

/** True when the loop will execute the call, so its result must be queued. */
function isExecutable(call: ScriptedToolCall, toolNames: Set<string>): boolean {
  if (!toolNames.has(call.name)) return false
  if (call.argumentsJson === undefined) return true
  try {
    return isRecordLike(JSON.parse(call.argumentsJson))
  } catch {
    return false
  }
}

/**
 * Results are queued per tool in script order. The loop may execute calls from
 * one turn in any completion order, so keying by name keeps every call matched
 * to the result the scenario intended.
 */
function buildResultQueues(
  scenario: AgentToolUseScenario,
  toolNames: Set<string>
): Map<string, ToolResponse[]> {
  const queues = new Map<string, ToolResponse[]>()
  for (const turn of scenario.script) {
    if (turn.kind !== 'tools') continue
    for (const call of turn.calls) {
      if (!isExecutable(call, toolNames)) continue
      const spec = call.result
      const queue = queues.get(call.name) ?? []
      queue.push({
        success: spec?.success ?? true,
        output: spec?.output ?? {},
        ...(spec?.error ? { error: spec.error } : {}),
      })
      queues.set(call.name, queue)
    }
  }
  return queues
}

function check(name: string, passed: boolean, detail: string): EvalCheck {
  return { name, passed, detail }
}

function sameSequence(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((name, i) => name === expected[i])
}

function matchesContent(content: string, expected: string | RegExp): boolean {
  return typeof expected === 'string' ? content.includes(expected) : expected.test(content)
}

function isOrderedSubsequence(actual: string[], expected: string[]): boolean {
  let index = 0
  for (const name of actual) {
    if (name === expected[index]) index += 1
  }
  return index === expected.length
}

/** Minimal tool-call shape the scorer needs; both harnesses produce it. */
export interface ScoredToolCall {
  name: string
  success: boolean
}

export function scoreExpectations(
  expected: AgentToolUseExpectations,
  toolCalls: ScoredToolCall[],
  finalContent: string,
  iterations: number,
  error: unknown,
  mode: EvalRunMode
): EvalCheck[] {
  const actualSequence = toolCalls.map((call) => call.name)
  const checks: EvalCheck[] = []

  if (expected.toolCallSequence) {
    const sequenceMatches =
      mode === 'live'
        ? isOrderedSubsequence(actualSequence, expected.toolCallSequence)
        : sameSequence(actualSequence, expected.toolCallSequence)
    checks.push(
      check(
        'tool-call-sequence',
        sequenceMatches,
        `expected [${expected.toolCallSequence.join(', ')}], got [${actualSequence.join(', ')}]`
      )
    )
  }

  if (expected.requiredTools) {
    const missing = expected.requiredTools.filter((name) => !actualSequence.includes(name))
    checks.push(
      check(
        'required-tools',
        missing.length === 0,
        missing.length === 0 ? 'all required tools called' : `missing [${missing.join(', ')}]`
      )
    )
  }

  if (expected.forbiddenTools) {
    const called = expected.forbiddenTools.filter((name) => actualSequence.includes(name))
    checks.push(
      check(
        'forbidden-tools',
        called.length === 0,
        called.length === 0 ? 'no forbidden tools called' : `called [${called.join(', ')}]`
      )
    )
  }

  if (expected.finalContent !== undefined) {
    checks.push(
      check(
        'final-content',
        matchesContent(finalContent, expected.finalContent),
        `final content ${JSON.stringify(finalContent)}`
      )
    )
  }

  if (expected.maxIterations !== undefined) {
    checks.push(
      check(
        'max-iterations',
        iterations <= expected.maxIterations,
        `iterations ${iterations} (max ${expected.maxIterations})`
      )
    )
  }

  const successful = toolCalls.filter((call) => call.success).length
  if (expected.successfulToolCalls !== undefined) {
    const successMatches =
      mode === 'live'
        ? successful >= expected.successfulToolCalls
        : successful === expected.successfulToolCalls
    checks.push(
      check(
        'successful-tool-calls',
        successMatches,
        `expected ${mode === 'live' ? 'at least ' : ''}${expected.successfulToolCalls}, got ${successful}`
      )
    )
  }

  const errored = toolCalls.length - successful
  /** A live model chooses its own retry count, so an exact error count is scripted-only. */
  if (expected.erroredToolCalls !== undefined && mode !== 'live') {
    checks.push(
      check(
        'errored-tool-calls',
        errored === expected.erroredToolCalls,
        `expected ${expected.erroredToolCalls}, got ${errored}`
      )
    )
  }

  if (expected.completesWithoutError !== false) {
    checks.push(
      check(
        'completes-without-error',
        error === undefined,
        error === undefined ? 'completed without error' : String(error)
      )
    )
  }

  return checks
}

/** Runs and scores one scenario. */
export async function runScenario(
  scenario: AgentToolUseScenario,
  options: RunScenarioOptions = {}
): Promise<AgentToolUseResult> {
  const mode = options.mode ?? 'scripted'
  const model = options.model ?? EVAL_MODEL
  const providerName = options.providerName ?? EVAL_PROVIDER
  const expected =
    mode === 'live' ? { ...scenario.expect, ...scenario.liveExpect } : scenario.expect
  const toolNames = new Set(scenario.tools.map((tool) => tool.name))
  const resultQueues = buildResultQueues(scenario, toolNames)
  const providerTools = toProviderTools(scenario.tools)
  const invocations: EvalToolInvocation[] = []

  providersMock.MAX_TOOL_ITERATIONS = MAX_TOOL_ITERATIONS
  providersUtilsMockFns.mockCalculateCost.mockReturnValue({ input: 0, output: 0, total: 0 })
  toolsMockFns.mockExecuteTool.mockImplementation(
    async (toolId: string, params: Record<string, unknown>): Promise<ToolResponse> => {
      const startedAt = Date.now()
      const response = resultQueues.get(toolId)?.shift() ?? { success: true, output: {} }
      invocations.push({
        name: toolId,
        arguments: params ?? {},
        success: response.success,
        ...(response.error ? { error: response.error } : {}),
        durationMs: Date.now() - startedAt,
      })
      return response
    }
  )

  const timeSegments: TimeSegment[] = []
  let completed: StreamingToolLoopComplete | undefined
  let streamError: unknown

  const startedAt = Date.now()
  try {
    const stream = createOpenAICompatStreamingToolLoopStream({
      providerName,
      request: {
        model,
        apiKey: 'eval-key',
        messages: [],
        tools: providerTools,
      },
      basePayload: {
        model,
        tools: providerTools.map((tool) => adaptOpenAIChatToolSchema(tool)),
      },
      messages: [{ role: 'user', content: scenario.userMessage }],
      createStream: options.completion ?? createScriptedCompletion(scenario),
      logger,
      timeSegments,
      preserveAssistantReasoning: true,
      onComplete: (result) => {
        completed = result
      },
    })
    await collectStream(stream as ReadableStream<AgentStreamEvent>)
  } catch (error) {
    streamError = error
  }
  const latencyMs = Date.now() - startedAt

  const toolCalls = ((completed?.toolCalls as ToolCallList | undefined)?.list ?? []).slice()
  const finalContent = completed?.content ?? ''
  const iterations = completed?.iterations ?? 0
  const checks = scoreExpectations(expected, toolCalls, finalContent, iterations, streamError, mode)

  if (options.judge) {
    try {
      const verdict = await judgeAnswer({
        completion: options.judge.completion,
        model: options.judge.model,
        rubric: options.judge.rubric,
        userMessage: scenario.userMessage,
        answer: finalContent,
        evidence: JSON.stringify(invocations),
      })
      checks.push({
        name: 'judge',
        passed: verdict.passed,
        detail: `weighted ${verdict.weightedScore.toFixed(2)}; ${verdict.rationale}`,
      })
    } catch (error) {
      checks.push({ name: 'judge', passed: false, detail: `judge failed: ${String(error)}` })
    }
  }

  if (invocations.length > 0) {
    const expectedCalls = expectedExecutableCalls(scenario)
    const mismatched = invocations.filter(
      (invocation) =>
        !expectedCalls.some(
          (expectedCall) =>
            expectedCall.name === invocation.name &&
            isDeepStrictEqual(expectedCall.args, invocation.arguments)
        )
    )
    checks.push({
      name: 'tool-arguments',
      passed: mismatched.length === 0,
      detail:
        mismatched.length === 0
          ? `all ${invocations.length} tool calls matched their scripted arguments`
          : `unexpected arguments: ${mismatched
              .map((entry) => `${entry.name}(${JSON.stringify(entry.arguments)})`)
              .join(', ')}`,
    })
  }

  const successful = toolCalls.filter((call) => call.success).length

  return {
    id: scenario.id,
    name: scenario.name,
    category: scenario.category,
    passed: checks.every((entry) => entry.passed),
    checks,
    finalContent,
    toolInvocations: invocations,
    metrics: {
      iterations,
      toolCalls: toolCalls.length,
      successfulToolCalls: successful,
      erroredToolCalls: toolCalls.length - successful,
      latencyMs,
      modelTimeMs: completed?.modelTime ?? 0,
      toolsTimeMs: completed?.toolsTime ?? 0,
      firstResponseTimeMs: completed?.firstResponseTime ?? 0,
      inputTokens: completed?.tokens.input ?? 0,
      outputTokens: completed?.tokens.output ?? 0,
      totalTokens: completed?.tokens.total ?? 0,
    },
    ...(streamError ? { error: String(streamError) } : {}),
  }
}
