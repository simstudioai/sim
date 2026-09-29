import { createLogger } from '@sim/logger'
import { collectStream } from '@sim/testing/helpers/async'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { isRecordLike } from '@sim/utils/object'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import {
  createOpenAICompatStreamingToolLoopStream,
  type OpenAICompatCreateCompletion,
} from '@/providers/openai-compat/streaming-tool-loop'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { StreamingToolLoopComplete } from '@/providers/streaming-tool-loop-shared'
import type { ProviderToolConfig, TimeSegment } from '@/providers/types'
import type { ToolResponse } from '@/tools/types'
import type {
  AgentToolUseResult,
  AgentToolUseScenario,
  EvalCheck,
  EvalToolDefinition,
  EvalToolInvocation,
  ScriptedModelTurn,
  ScriptedToolCall,
} from './types'

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

function createScriptedCompletion(scenario: AgentToolUseScenario): OpenAICompatCreateCompletion {
  let turnIndex = 0
  return async () => {
    const turn = scenario.script[turnIndex]
    turnIndex += 1
    if (!turn) {
      throw new Error(
        `Scenario "${scenario.id}" requested model turn ${turnIndex} but only ${scenario.script.length} are scripted`
      )
    }
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

function score(
  scenario: AgentToolUseScenario,
  toolCalls: CapturedToolCall[],
  finalContent: string,
  iterations: number,
  error: unknown
): EvalCheck[] {
  const expected = scenario.expect
  const actualSequence = toolCalls.map((call) => call.name)
  const checks: EvalCheck[] = []

  if (expected.toolCallSequence) {
    checks.push(
      check(
        'tool-call-sequence',
        sameSequence(actualSequence, expected.toolCallSequence),
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
    checks.push(
      check(
        'successful-tool-calls',
        successful === expected.successfulToolCalls,
        `expected ${expected.successfulToolCalls}, got ${successful}`
      )
    )
  }

  const errored = toolCalls.length - successful
  if (expected.erroredToolCalls !== undefined) {
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
        error === undefined ? 'loop settled' : String(error)
      )
    )
  }

  return checks
}

/** Runs and scores one scenario. */
export async function runScenario(scenario: AgentToolUseScenario): Promise<AgentToolUseResult> {
  const toolNames = new Set(scenario.tools.map((tool) => tool.name))
  const resultQueues = buildResultQueues(scenario, toolNames)
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
      providerName: EVAL_PROVIDER,
      request: {
        model: EVAL_MODEL,
        apiKey: 'eval-key',
        messages: [],
        tools: toProviderTools(scenario.tools),
      },
      basePayload: { model: EVAL_MODEL },
      messages: [{ role: 'user', content: scenario.userMessage }],
      createStream: createScriptedCompletion(scenario),
      logger,
      timeSegments,
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
  const checks = score(scenario, toolCalls, finalContent, iterations, streamError)
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
