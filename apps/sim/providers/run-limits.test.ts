import { billingUsageGateCacheMock } from '@sim/testing/mocks/billing-usage-gate-cache.mock'
import {
  providersConversationHistoryMock,
  providersConversationHistoryMockFns,
} from '@sim/testing/mocks/providers-conversation-history.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationProtocol } from '@/lib/memory/conversation-types'
import { AgentTurnStateMachine } from '@/lib/memory/turn-state'
import { readTrustedExecutionCost } from '@/executor/utils/errors'
import { prepareConversationGeneration } from '@/providers/conversation-generation'
import type { TokenUsageCost } from '@/providers/pricing'
import { AgentRunLimits, RunLimitError, type RunLimitsConfig } from '@/providers/run-limits'
import {
  executeProviderTool,
  type ProviderRuntimeContext,
  runWithProviderRuntimeContext,
} from '@/providers/runtime-context'
import type { ProviderRequest } from '@/providers/types'

vi.mock('@/tools', () => toolsMock)
vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)

toolsMockFns.mockExecuteTool.mockResolvedValue({ success: true, output: {} })

const request = { model: 'test-model', tools: [{ id: 'lookup' }] } as ProviderRequest
const toolPayload = {
  messages: [{ role: 'user', content: 'Do the task' }],
  tools: [{ type: 'function', function: { name: 'lookup' } }],
}
const answerPayload = { messages: toolPayload.messages }

function cost(total = 0): TokenUsageCost {
  return { input: 0, output: 0, total }
}

/** Binds a runtime to the request the way `executeProviderRequest` does for each model attempt. */
function bindRuntime(runLimits: AgentRunLimits, settledCost = cost()): ProviderRuntimeContext {
  const runtime: ProviderRuntimeContext = { runLimits, settledCost }
  providersConversationHistoryMockFns.mockGetConversationRequestContext.mockReturnValue(runtime)
  return runtime
}

function limits(config: Partial<RunLimitsConfig>): AgentRunLimits {
  return new AgentRunLimits({ onLimit: 'finalize', ...config })
}

async function modelCall(
  protocol: ConversationProtocol = 'chat-completions',
  payload: object = toolPayload
) {
  return prepareConversationGeneration(request, protocol, structuredClone(payload))
}

/** Runs the tool calls of one model response; returns whether each one ran. */
async function toolCalls(runLimits: AgentRunLimits, count = 1): Promise<boolean[]> {
  toolsMockFns.mockExecuteTool.mockClear()
  const results = await runWithProviderRuntimeContext({ runLimits }, () =>
    Promise.all(Array.from({ length: count }, () => executeProviderTool('lookup', {})))
  )
  return results.map(({ rawResponse }) => rawResponse.success)
}

afterEach(() => {
  vi.useRealTimers()
  providersConversationHistoryMockFns.mockGetConversationRequestContext.mockReset()
})

describe('Agent run limits', () => {
  it('leaves every call and tool untouched when no limit is set', async () => {
    const runLimits = limits({})
    bindRuntime(runLimits)

    for (let step = 0; step < 3; step++) {
      expect(await modelCall()).toEqual(toolPayload)
      expect(await toolCalls(runLimits)).toEqual([true])
    }
    expect(runLimits.stopReason).toBe('completed')
  })

  it('answers without tools once the allowed steps have run', async () => {
    const runLimits = limits({ maxSteps: 2 })
    bindRuntime(runLimits)

    for (let step = 0; step < 2; step++) {
      expect(await modelCall()).toEqual(toolPayload)
      expect(await toolCalls(runLimits)).toEqual([true])
    }
    expect(await modelCall()).toEqual(answerPayload)
    expect(runLimits.stopReason).toBe('step_limit')
  })

  it('runs every parallel tool call of the last allowed step', async () => {
    const runLimits = limits({ maxSteps: 1 })
    bindRuntime(runLimits)

    await modelCall()
    expect(await toolCalls(runLimits, 3)).toEqual([true, true, true])
  })

  it('fails a run that asks for tools past its limit, keeping the settled cost for billing', async () => {
    const runLimits = limits({ maxSteps: 1, onLimit: 'fail' })
    bindRuntime(runLimits, cost(0.25))

    await modelCall()
    await toolCalls(runLimits)
    expect(await modelCall()).toEqual(toolPayload)
    expect(await toolCalls(runLimits)).toEqual([false])
    const error = await modelCall().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(RunLimitError)
    expect(readTrustedExecutionCost(error)?.total).toBe(0.25)
  })

  it('completes a failing-mode run whose model answers on the call after its last step', async () => {
    const runLimits = limits({ maxSteps: 1, onLimit: 'fail' })
    bindRuntime(runLimits)

    await modelCall()
    await toolCalls(runLimits)
    expect(await modelCall()).toEqual(toolPayload)
    expect(runLimits.stopReason).toBe('completed')
  })

  it('counts each attempt’s own spend once, not the cost it carried in from earlier attempts', async () => {
    const runLimits = limits({ maxCost: 1 })
    const primary = bindRuntime(runLimits)
    await modelCall()
    primary.settledCost!.total = 0.6

    const fallback = bindRuntime(runLimits, cost(0.6))
    expect(await modelCall()).toEqual(toolPayload)
    fallback.settledCost!.total = 0.9
    expect(await modelCall()).toEqual(toolPayload)
    fallback.settledCost!.total = 1

    expect(await modelCall()).toEqual(answerPayload)
    expect(runLimits.stopReason).toBe('spend_limit')
  })

  it('answers without tools once the time limit has passed', async () => {
    vi.useFakeTimers()
    const runLimits = limits({ maxDurationMs: 60_000 })
    bindRuntime(runLimits)

    expect(await modelCall()).toEqual(toolPayload)
    vi.advanceTimersByTime(60_000)
    expect(await toolCalls(runLimits)).toEqual([false])
    expect(await modelCall()).toEqual(answerPayload)
    expect(runLimits.stopReason).toBe('time_limit')
  })

  it('does not stop a run that answered within its limits, whatever follow-up calls cost', async () => {
    const runLimits = limits({ maxCost: 1 })
    const runtime = bindRuntime(runLimits)
    await modelCall()
    await toolCalls(runLimits)
    await modelCall()
    runtime.settledCost!.total = 1.2
    const structuredPass = { messages: toolPayload.messages, response_format: { type: 'json' } }

    for (let call = 0; call < 3; call++) {
      expect(await modelCall('chat-completions', structuredPass)).toEqual(structuredPass)
    }
    expect(runLimits.stopReason).toBe('completed')
  })

  it('stops a provider that keeps calling tools after it was told to answer', async () => {
    const runLimits = limits({ maxSteps: 1 })
    bindRuntime(runLimits)
    await modelCall()
    await toolCalls(runLimits)

    await modelCall()
    expect(await toolCalls(runLimits)).toEqual([false])
    expect(toolsMockFns.mockExecuteTool).not.toHaveBeenCalled()
    await modelCall()
    await toolCalls(runLimits)
    await expect(modelCall()).rejects.toBeInstanceOf(RunLimitError)
  })

  it('leaves a refused call pending, so a retry with a fresh budget runs it', async () => {
    const runLimits = limits({ maxSteps: 1 })
    bindRuntime(runLimits)
    await modelCall()
    await toolCalls(runLimits)
    await modelCall()
    const journal = new AgentTurnStateMachine({ save: vi.fn() })
    await journal.captureStep({
      assistant: { role: 'assistant', content: '' },
      calls: [{ toolId: 'lookup', providerCallId: 'call-1', arguments: '{}' }],
      native: {
        protocol: 'chat-completions',
        providerId: 'openai',
        model: 'm',
        binding: 'b',
        value: {},
      },
    })
    const invocationId = journal.resolveInvocationId('call-1', 'lookup')

    await runWithProviderRuntimeContext({ runLimits, agentConversation: journal }, () =>
      executeProviderTool('lookup', { _context: { invocationId } })
    )

    expect(journal.getPendingCalls().map((call) => call.invocationId)).toEqual([invocationId])
  })

  it('gives a provider that cannot refuse tools its retry even when the limit stopped a step', async () => {
    vi.useFakeTimers()
    const runLimits = limits({ maxDurationMs: 1000 })
    bindRuntime(runLimits)
    await modelCall('bedrock', { messages: [], toolConfig: { tools: [{}] } })
    vi.advanceTimersByTime(1000)
    await toolCalls(runLimits)

    await modelCall('bedrock', { messages: [], toolConfig: { tools: [{}] } })
    await toolCalls(runLimits)
    await expect(
      modelCall('bedrock', { messages: [], toolConfig: { tools: [{}] } })
    ).resolves.toBeDefined()
  })

  it.each([
    {
      protocol: 'chat-completions',
      payload: { ...toolPayload, tool_choice: 'auto', parallel_tool_calls: false },
      expected: answerPayload,
    },
    {
      protocol: 'responses',
      payload: { input: [], tools: [{ type: 'function', name: 'lookup' }], tool_choice: 'auto' },
      expected: { input: [], tool_choice: 'none' },
    },
    {
      protocol: 'anthropic',
      payload: { ...toolPayload, tool_choice: { type: 'any' } },
      expected: { ...toolPayload, tool_choice: { type: 'none' } },
    },
    {
      protocol: 'gemini',
      payload: {
        contents: [],
        config: { temperature: 0, tools: [{}], toolConfig: { functionCallingConfig: {} } },
      },
      expected: { contents: [], config: { temperature: 0 } },
    },
    {
      protocol: 'bedrock',
      payload: { messages: [], toolConfig: { tools: [{}], toolChoice: { any: {} } } },
      expected: { messages: [], toolConfig: { tools: [{}], toolChoice: { auto: {} } } },
    },
    {
      protocol: 'bedrock',
      payload: {
        messages: [],
        toolConfig: { tools: [{}], toolChoice: { tool: { name: 'structured_output' } } },
      },
      expected: {
        messages: [],
        toolConfig: { tools: [{}], toolChoice: { tool: { name: 'structured_output' } } },
      },
    },
  ] as const)(
    'answers in the $protocol wire format: $expected',
    async ({ protocol, payload, expected }) => {
      const runLimits = limits({ maxSteps: 1 })
      bindRuntime(runLimits)
      await modelCall()
      await toolCalls(runLimits)

      expect(await modelCall(protocol, payload)).toEqual(expected)
    }
  )

  it('reports a stop that happens after the output was handed back, as a streamed run does', async () => {
    const runLimits = limits({ maxSteps: 1 })
    bindRuntime(runLimits)
    const output: Record<string, unknown> = {}

    runLimits.reportOn(output)
    expect(output.stopReason).toBe('completed')
    await modelCall()
    await toolCalls(runLimits)
    await modelCall()
    expect({ ...output }).toEqual({ stopReason: 'step_limit' })
  })
})
