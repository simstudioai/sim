import {
  createSerializedBlock,
  createSerializedWorkflow,
} from '@sim/testing/factories/serialized-block.factory'
import { providersMockFns } from '@sim/testing/mocks/providers.mock'
import { vi } from 'vitest'
import {
  type EvalRunMode,
  type ScoredToolCall,
  scoreExpectations,
} from '@/evals/agent-tool-use/harness'
import type {
  AgentToolUseExpectations,
  AgentToolUseResult,
  EvalCategory,
  EvalToolInvocation,
} from '@/evals/agent-tool-use/types'
import { DAGExecutor } from '@/executor/execution/executor'
import { memoryService } from '@/executor/handlers/agent/memory'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

/**
 * Executor-level harness.
 *
 * Drives a real `DAGExecutor` run: Start block → Agent block. The provider
 * boundary (`executeProviderRequest`) is the only thing mocked — the Agent
 * block handler, input/variable resolution, and the executor run/error handling
 * are real. Tool calls are what the mocked provider returns; tool *dispatch* is
 * covered by the loop harness.
 */

/** One tool call the mocked provider reports in its response. */
export interface ExecutorProviderToolCall {
  name: string
  arguments?: Record<string, unknown>
  result?: unknown
}

/** One model call: either a response, or a rejection the block must recover from. */
export interface ExecutorProviderResponse {
  /** When set, the call rejects with this message instead of resolving. */
  reject?: string
  content: string
  model?: string
  tokens?: { input?: number; output?: number; total?: number }
  toolCalls?: ExecutorProviderToolCall[]
  cost?: unknown
  timing?: unknown
}

export interface ExecutorScenario {
  id: string
  name: string
  category: EvalCategory
  description: string
  /** Exposed on the Start block and referenced from the Agent block. */
  workflowInput: Record<string, unknown>
  agent: {
    model: string
    systemPrompt?: string
    userPrompt?: string
    temperature?: number
    /** Enables the executor's per-block retry policy for the Agent block. */
    retry?: { enabled: boolean; maxTries: number; waitBetweenTriesMs: number }
    /** Ordered models the Agent handler tries after the primary fails. */
    fallbackModels?: Array<{ model: string }>
    /**
     * Turns on conversation memory. `history` is what the mocked memory read
     * returns for `conversationId`, so a wrong id surfaces as a failed check.
     */
    memory?: {
      conversationId: string
      history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    }
  }
  /** One entry per model call; the last entry serves any extra/retry calls. */
  providerResponse: ExecutorProviderResponse | ExecutorProviderResponse[]
  expect: AgentToolUseExpectations & {
    /** Substring that must appear in the messages sent to the provider. */
    resolvedInput?: string
    /** Expected `ExecutionResult.success`. */
    succeeds?: boolean
    /** Exact number of provider calls the executor made. */
    providerCalls?: number
    /** Model id sent on the final provider call (proves which candidate served). */
    lastRequestModel?: string
  }
}

function lastMatchingIndex(contents: string[], needle: string): number {
  for (let index = contents.length - 1; index >= 0; index--) {
    if (contents[index].includes(needle)) return index
  }
  return -1
}

function buildWorkflow(scenario: ExecutorScenario): SerializedWorkflow {
  const start: SerializedBlock = createSerializedBlock({
    id: 'start',
    type: 'start_trigger',
    name: 'Start',
  })
  /** The trigger handler claims a block whose metadata says it is a trigger. */
  if (start.metadata) start.metadata.category = 'triggers'
  const agent: SerializedBlock = createSerializedBlock({
    id: 'agent',
    type: 'agent',
    name: 'Eval Agent',
  })
  agent.config.tool = 'agent'
  agent.config.params = {
    model: scenario.agent.model,
    systemPrompt: scenario.agent.systemPrompt,
    userPrompt: scenario.agent.userPrompt,
    ...(scenario.agent.temperature !== undefined
      ? { temperature: scenario.agent.temperature }
      : {}),
    ...(scenario.agent.fallbackModels ? { fallbackModels: scenario.agent.fallbackModels } : {}),
    ...(scenario.agent.memory
      ? { memoryType: 'conversation', conversationId: scenario.agent.memory.conversationId }
      : {}),
  }
  if (scenario.agent.retry) agent.retry = scenario.agent.retry

  return createSerializedWorkflow([start, agent], [{ source: 'start', target: 'agent' }])
}

/**
 * Runs one executor scenario and scores it with the shared scorer, returning
 * the same result shape as the loop harness so both land in one report.
 */
export async function runExecutorScenario(
  scenario: ExecutorScenario,
  options: { mode?: EvalRunMode } = {}
): Promise<AgentToolUseResult> {
  const mode = options.mode ?? 'scripted'
  const responses = Array.isArray(scenario.providerResponse)
    ? [...scenario.providerResponse]
    : [scenario.providerResponse]
  const requests: Array<Record<string, unknown>> = []
  let callIndex = 0

  providersMockFns.mockExecuteProviderRequest.mockImplementation(
    async (_providerId: string, request: Record<string, unknown>) => {
      requests.push(request)
      const response = responses[Math.min(callIndex, responses.length - 1)]
      callIndex += 1
      if (response.reject) throw new Error(response.reject)
      return {
        content: response.content,
        model: response.model ?? scenario.agent.model,
        tokens: response.tokens ?? { input: 0, output: 0, total: 0 },
        toolCalls: response.toolCalls ?? [],
        cost: response.cost ?? 0,
        timing: response.timing ?? { total: 0 },
      }
    }
  )

  const fetchedConversationIds: unknown[] = []
  if (scenario.agent.memory) {
    const memory = scenario.agent.memory
    vi.spyOn(memoryService, 'fetchMemoryMessages').mockImplementation(async (_ctx, inputs) => {
      fetchedConversationIds.push(inputs.conversationId)
      return inputs.conversationId === memory.conversationId
        ? memory.history.map((message) => ({ ...message }))
        : [{ role: 'user', content: '__WRONG_CONVERSATION__' }]
    })
  }

  const executor = new DAGExecutor({
    workflow: buildWorkflow(scenario),
    workflowInput: scenario.workflowInput,
    contextExtensions: {
      workspaceId: 'eval-workspace',
      executionId: 'eval-execution',
      userId: 'eval-user',
    },
  })

  let result: { success?: boolean; output?: Record<string, unknown> } | undefined
  let runError: unknown
  const startedAt = Date.now()
  try {
    result = (await executor.execute('eval-workflow')) as typeof result
  } catch (error) {
    runError = error
  }
  const latencyMs = Date.now() - startedAt

  const output = (result?.output ?? {}) as Record<string, unknown>
  const finalContent = typeof output.content === 'string' ? output.content : ''
  const rawToolCalls = ((output.toolCalls as { list?: unknown[] } | undefined)?.list ??
    []) as Array<Record<string, unknown>>

  const toolCalls: ScoredToolCall[] = rawToolCalls.map((call) => ({
    name: typeof call.name === 'string' ? call.name : 'unknown',
    success: true,
  }))
  const toolInvocations: EvalToolInvocation[] = rawToolCalls.map((call) => ({
    name: typeof call.name === 'string' ? call.name : 'unknown',
    arguments: (call.arguments ?? {}) as Record<string, unknown>,
    success: true,
    durationMs: typeof call.duration === 'number' ? call.duration : 0,
  }))

  const checks = scoreExpectations(
    scenario.expect,
    toolCalls,
    finalContent,
    requests.length,
    runError,
    mode
  )

  if (scenario.expect.resolvedInput !== undefined) {
    const sent = JSON.stringify(requests)
    checks.push({
      name: 'resolved-input',
      passed: sent.includes(scenario.expect.resolvedInput),
      detail: `looking for ${JSON.stringify(scenario.expect.resolvedInput)} in provider messages`,
    })
  }

  if (scenario.expect.succeeds !== undefined) {
    checks.push({
      name: 'workflow-success',
      passed: result?.success === scenario.expect.succeeds,
      detail: `success=${String(result?.success)}`,
    })
  }

  if (scenario.expect.providerCalls !== undefined) {
    checks.push({
      name: 'provider-calls',
      passed: requests.length === scenario.expect.providerCalls,
      detail: `expected ${scenario.expect.providerCalls}, got ${requests.length}`,
    })
  }

  if (scenario.expect.lastRequestModel !== undefined) {
    const lastModel = (requests.at(-1) as { model?: string } | undefined)?.model
    checks.push({
      name: 'last-request-model',
      passed: lastModel === scenario.expect.lastRequestModel,
      detail: `expected ${scenario.expect.lastRequestModel}, got ${String(lastModel)}`,
    })
  }

  if (scenario.agent.memory) {
    const memory = scenario.agent.memory
    const requestMessages = ((requests[0] as { messages?: unknown[] } | undefined)?.messages ??
      []) as Array<{ role?: string; content?: unknown }>
    const contents = requestMessages.map((message) =>
      typeof message.content === 'string' ? message.content : ''
    )

    const missingHistory = memory.history.filter(
      (message) => !contents.some((content) => content.includes(message.content))
    )
    checks.push({
      name: 'memory-history-in-request',
      passed: missingHistory.length === 0,
      detail:
        missingHistory.length === 0
          ? `all ${memory.history.length} history messages reached the provider`
          : `missing [${missingHistory.map((message) => message.content).join(', ')}]`,
    })

    /** Each prior turn must appear as a subsequence with its role, in order. */
    let cursor = 0
    const inOrder = memory.history.every((message) => {
      while (cursor < requestMessages.length) {
        const candidate = requestMessages[cursor]
        cursor += 1
        if (
          candidate.role === message.role &&
          typeof candidate.content === 'string' &&
          candidate.content.includes(message.content)
        ) {
          return true
        }
      }
      return false
    })
    checks.push({
      name: 'memory-history-order',
      passed: inOrder,
      detail: 'each prior turn reached the provider in order with its role',
    })

    const lastHistoryIndex =
      memory.history.length === 0
        ? -1
        : Math.max(...memory.history.map((message) => lastMatchingIndex(contents, message.content)))
    const promptIndex = scenario.agent.userPrompt
      ? lastMatchingIndex(contents, scenario.agent.userPrompt)
      : -1
    checks.push({
      name: 'memory-before-user-prompt',
      passed: promptIndex >= 0 && promptIndex > lastHistoryIndex,
      detail: `history ends at ${lastHistoryIndex}, user prompt at ${promptIndex}`,
    })

    if (scenario.agent.systemPrompt) {
      const systemPrompt = scenario.agent.systemPrompt
      checks.push({
        name: 'system-prompt-in-request',
        passed: requestMessages.some(
          (message) => message.role === 'system' && String(message.content).includes(systemPrompt)
        ),
        detail: 'configured system prompt reached the provider',
      })
    }

    checks.push({
      name: 'conversation-id',
      passed:
        fetchedConversationIds.length > 0 &&
        fetchedConversationIds.every((id) => id === memory.conversationId),
      detail: `expected ${memory.conversationId}, got [${fetchedConversationIds.join(', ')}]`,
    })
  }

  const tokens = (output.tokens ?? {}) as { input?: number; output?: number; total?: number }

  return {
    id: scenario.id,
    name: scenario.name,
    category: scenario.category,
    passed: checks.every((entry) => entry.passed),
    checks,
    finalContent,
    toolInvocations,
    metrics: {
      iterations: requests.length,
      toolCalls: toolCalls.length,
      successfulToolCalls: toolCalls.filter((call) => call.success).length,
      erroredToolCalls: 0,
      latencyMs,
      modelTimeMs: 0,
      toolsTimeMs: 0,
      firstResponseTimeMs: 0,
      inputTokens: tokens.input ?? 0,
      outputTokens: tokens.output ?? 0,
      totalTokens: tokens.total ?? 0,
    },
    ...(runError ? { error: String(runError) } : {}),
  }
}

/**
 * Executor-level scenarios. Two cover the wiring the loop suite cannot see:
 * Start → Agent execution, and variable resolution from a Start output into the
 * Agent's prompt.
 */
export const EXECUTOR_SCENARIOS: ExecutorScenario[] = [
  {
    id: 'executor-agent-runs',
    name: 'runs a Start → Agent workflow and surfaces the Agent output',
    category: 'tool-selection',
    description:
      'The real Agent block handler runs inside the DAG. The mocked provider reports one tool call; the executor result must carry the content and the tool call through.',
    workflowInput: { message: 'What is the API rate limit?' },
    agent: {
      model: 'gpt-4o',
      systemPrompt: 'You are a documentation assistant.',
      userPrompt: 'What is the API rate limit?',
    },
    providerResponse: {
      content: 'The API rate limit is 100 requests per minute.',
      toolCalls: [
        {
          name: 'search_docs',
          arguments: { query: 'api rate limit' },
          result: { snippet: 'The API rate limit is 100 requests per minute.' },
        },
      ],
      tokens: { input: 10, output: 20, total: 30 },
    },
    expect: {
      succeeds: true,
      finalContent: '100 requests per minute',
      toolCallSequence: ['search_docs'],
      successfulToolCalls: 1,
    },
  },
  {
    id: 'executor-resolves-start-input',
    name: 'resolves a Start output into the Agent prompt before the provider call',
    category: 'planning',
    description:
      'The Agent userPrompt references <start.message>. The value must be resolved by the executor and reach the provider request, not passed through verbatim.',
    workflowInput: { message: 'Summarize order A-1937' },
    agent: {
      model: 'gpt-4o',
      userPrompt: '<start.message>',
    },
    providerResponse: {
      content: 'Order A-1937 shipped via DHL.',
      tokens: { input: 8, output: 12, total: 20 },
    },
    expect: {
      succeeds: true,
      resolvedInput: 'Summarize order A-1937',
      finalContent: /A-1937/,
    },
  },
  {
    id: 'executor-retries-failed-block',
    name: 'retries a failed Agent block and completes the run',
    category: 'recovery',
    description:
      'The first provider call rejects with a 503. The block has retry enabled, so the executor replays it and the second call succeeds — proving the executor retry policy, not the agent handler, recovered the turn.',
    workflowInput: { message: 'What is the API rate limit?' },
    agent: {
      model: 'gpt-4o',
      userPrompt: 'What is the API rate limit?',
      retry: { enabled: true, maxTries: 3, waitBetweenTriesMs: 0 },
    },
    providerResponse: [
      { reject: '503 Service Unavailable', content: '' },
      {
        content: 'The API rate limit is 100 requests per minute.',
        tokens: { input: 10, output: 20, total: 30 },
      },
    ],
    expect: {
      succeeds: true,
      finalContent: '100 requests per minute',
      providerCalls: 2,
    },
  },
  {
    id: 'executor-falls-back-to-secondary-model',
    name: 'falls back to the secondary model when the primary fails',
    category: 'recovery',
    description:
      'The primary model call rejects and the Agent block has a fallback model. The handler must serve the answer from the fallback and the run must complete.',
    workflowInput: { message: 'What is the API rate limit?' },
    agent: {
      model: 'gpt-4o',
      userPrompt: 'What is the API rate limit?',
      fallbackModels: [{ model: 'gpt-4o-mini' }],
    },
    providerResponse: [
      { reject: '429 rate limited', content: '' },
      {
        content: 'The API rate limit is 100 requests per minute.',
        model: 'gpt-4o-mini',
        tokens: { input: 10, output: 20, total: 30 },
      },
    ],
    expect: {
      succeeds: true,
      finalContent: '100 requests per minute',
      providerCalls: 2,
      lastRequestModel: 'gpt-4o-mini',
    },
  },
]
