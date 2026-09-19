/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import type { AgentTurnState, CapturedConversationStep } from '@/lib/memory/conversation-types'
import { AgentTurnStateMachine } from '@/lib/memory/turn-state'
import { getNativeConversationMessage } from '@/providers/conversation-metadata'

function batch(ids: Array<string | undefined> = ['wire-1', 'wire-2']): CapturedConversationStep {
  return {
    assistant: { role: 'assistant', content: '' },
    calls: ids.map((id) => ({
      providerCallId: id,
      toolId: 'send_email',
      arguments: '{"to":"person@example.test"}',
    })),
    native: {
      providerId: 'openai',
      protocol: 'responses',
      model: 'model-a',
      binding: 'binding-a',
      value: [],
    },
  }
}

describe('Agent invocation continuation', () => {
  it('checkpoints the complete batch before any result and publishes only a completed exchange', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const session = new AgentTurnStateMachine({ save })
    await session.captureStep(batch())
    expect(save.mock.calls[0][0].steps[0].calls).toHaveLength(2)
    expect(save.mock.calls[0][1]).toBeUndefined()
    const calls = session.getPendingCalls()
    const response = { success: true, output: { sent: true } }
    await session.recordToolResult({
      invocationId: calls[1].invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    expect(save.mock.calls[1][1]).toBeUndefined()
    expect(session.getMessages('openai', 'model-a', 'binding-a')).toEqual([])
    await session.recordToolResult({
      invocationId: calls[0].invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    expect(save.mock.calls[0][0].steps[0].results).toEqual([])
    expect(save.mock.calls[1][0].steps[0].results).toHaveLength(1)
    expect(save.mock.calls[2][0].steps[0].native).toBe(save.mock.calls[0][0].steps[0].native)
    const messages = session.getMessages('openai', 'model-a', 'binding-a')
    expect(messages.map((message) => message.tool_call_id)).toEqual([undefined, 'wire-1', 'wire-2'])
    expect(save.mock.calls[2][1].calls).toHaveLength(2)
    expect(getNativeConversationMessage(messages[0], 'responses')).toEqual([])
  })

  it('restores a completed sibling and retries only the unknown outcome with its original Sim identity', async () => {
    let checkpoint: AgentTurnState | undefined
    const original = new AgentTurnStateMachine({
      save: async (state) => {
        checkpoint = state
      },
    })
    await original.captureStep(batch())
    const calls = original.getPendingCalls()
    const response = { success: false, output: {}, error: 'upstream failure' }
    await original.recordToolResult({
      invocationId: calls[0].invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    const restored = new AgentTurnStateMachine({ save: async () => {} }, checkpoint)
    expect(restored.getPendingCalls()).toEqual([calls[1]])
    expect(restored.getRecordedResult(calls[0].invocationId)?.modelResponse).toEqual(response)
  })

  it('assigns separate IDs to parallel same-name Gemini calls without provider IDs', async () => {
    const session = new AgentTurnStateMachine({ save: async () => {} })
    await session.captureStep(batch([undefined, undefined]))
    const first = session.resolveInvocationId(undefined, 'send_email')
    const second = session.resolveInvocationId(undefined, 'send_email')
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
    expect(session.resolveInvocationId(undefined, 'send_email')).toBeUndefined()
  })

  it('does not deduplicate newly generated calls with the same arguments', async () => {
    const session = new AgentTurnStateMachine({ save: async () => {} })
    await session.captureStep(batch(['wire-1']))
    const first = session.getPendingCalls()[0]
    const response = { success: true, output: {} }
    await session.recordToolResult({
      invocationId: first.invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    await session.captureStep(batch(['wire-2']))
    expect(session.getPendingCalls()[0].invocationId).not.toBe(first.invocationId)
  })

  it('repeated capture and terminal callbacks do not duplicate the same exchange', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const session = new AgentTurnStateMachine({ save })
    const step = batch(['wire-1'])
    await session.captureStep(step)
    await session.captureStep(step)
    const result = {
      invocationId: session.getPendingCalls()[0].invocationId,
      rawResponse: { success: true, output: {} },
      modelResponse: { success: true, output: {} },
    }
    await Promise.all([session.recordToolResult(result), session.recordToolResult(result)])
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('keeps signatures private on provider/model/endpoint changes', async () => {
    const session = new AgentTurnStateMachine({ save: async () => {} })
    const step = batch(['wire-1'])
    step.native.value = [{ type: 'reasoning', encrypted_content: 'private-signature' }]
    await session.captureStep(step)
    const response = { success: true, output: { done: true } }
    await session.recordToolResult({
      invocationId: session.getPendingCalls()[0].invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    for (const [model, binding] of [
      ['other-model', 'binding-a'],
      ['model-a', 'other-endpoint'],
    ]) {
      const messages = session.getMessages('openai', model, binding)
      expect(getNativeConversationMessage(messages[0], 'responses')).toBeUndefined()
      expect(JSON.stringify(messages)).not.toContain('private-signature')
    }
    for (const providerId of ['google', 'anthropic', 'azure-anthropic', 'bedrock'] as const) {
      const messages = session.getMessages(providerId, 'other-model', 'other-binding')
      expect(messages).toHaveLength(2)
      expect(messages[0].tool_calls).toHaveLength(1)
      expect(messages[1].role).toBe('tool')
      expect(JSON.stringify(messages)).not.toContain('private-signature')
    }
  })

  it('preserves usage and costs once while keeping fresh invocations isolated', async () => {
    const session = new AgentTurnStateMachine({ save: async () => {} })
    await session.captureStep({
      ...batch(['wire-1']),
      usage: {
        input: 3,
        output: 4,
        cacheRead: 5,
        cacheWrites: [
          { tokens: 6, inputRateMultiplier: 1.25 },
          { tokens: 7, inputRateMultiplier: 2 },
        ],
      },
      cost: { input: 1, output: 2, total: 3 },
    })
    const response = { success: true, output: { cost: { total: 7 } } }
    const result = {
      invocationId: session.getPendingCalls()[0].invocationId,
      rawResponse: response,
      modelResponse: response,
    }
    await session.recordToolResult(result)
    await session.recordToolResult(result)
    expect(session.getUsage().cost).toEqual({ input: 1, output: 2, toolCost: 7, total: 10 })
    expect(session.getUsage().tokens).toEqual({ input: 3, output: 4, cacheRead: 5, cacheWrite: 13 })
    expect(new AgentTurnStateMachine({ save: async () => {} }).getPendingCalls()).toEqual([])
    expect(new AgentTurnStateMachine({ save: async () => {} }).getUsage().cost.total).toBe(0)
  })

  it('accounts for derived context usage without introducing conversation history', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const session = new AgentTurnStateMachine({ save })
    const usage = {
      tokens: {
        input: 5,
        output: 2,
        cacheRead: 1,
        cacheWrites: [{ tokens: 3, inputRateMultiplier: 1.25 }],
      },
      cost: { input: 0.01, output: 0.02, total: 0.03, toolCost: 0 },
    }
    await session.recordContextUsage(usage)
    await session.recordContextUsage(usage)
    expect(session.getUsage()).toEqual({
      tokens: { input: 10, output: 4, cacheRead: 2, cacheWrite: 6 },
      cost: { input: 0.02, output: 0.04, total: 0.06, toolCost: 0 },
    })
    expect(save.mock.calls[0][0].contextUsage.tokens.input).toBe(5)
    expect(session.getMessages('openai', 'model-a', 'binding-a')).toEqual([])
    expect(session.getFinalResponse()).toBeUndefined()
  })

  it('preserves projected failure details without an artifact during continuation', async () => {
    const session = new AgentTurnStateMachine({ save: async () => {} })
    await session.captureStep(batch(['wire-1']))
    await session.recordToolResult({
      invocationId: session.getPendingCalls()[0].invocationId,
      rawResponse: { success: false, output: { private: 'RAW_PRIVATE' }, error: 'PRIVATE_ERROR' },
      modelResponse: {
        success: false,
        output: { status: 422, invalidFields: ['email'], success: true },
        error: 'Invalid email',
      },
    })
    const messages = session.getMessages('anthropic', 'other-model', 'other-binding')
    expect(JSON.parse(messages[1].content!)).toEqual({
      status: 422,
      invalidFields: ['email'],
      success: false,
      error: 'Invalid email',
    })
    expect(JSON.stringify(messages)).not.toContain('PRIVATE')
  })

  it('keeps an artifact receipt discoverable when a recorded tool failed', async () => {
    const session = new AgentTurnStateMachine({ save: async () => {} })
    await session.captureStep(batch(['wire-1']))
    const invocationId = session.getPendingCalls()[0].invocationId
    const modelOutput = {
      memoryArtifact: { id: 'a'.repeat(64) },
      preview: 'Validation failed; remaining details are retained in the artifact.',
    }
    await session.recordToolResult({
      invocationId,
      rawResponse: {
        success: false,
        output: { privateDetail: 'raw-only-detail' },
        error: 'Private error',
      },
      modelResponse: { success: false, output: modelOutput, error: 'Tool execution failed' },
      artifact: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_abcdefghijkl',
        kind: 'object',
        size: 20000,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json',
      },
    })
    const messages = session.getMessages('openai', 'model-a', 'binding-a')
    expect(JSON.parse(messages[1].content!)).toEqual({
      ...modelOutput,
      success: false,
      error: 'Tool execution failed',
    })
    expect(JSON.stringify(messages)).not.toContain('raw-only-detail')
    expect(JSON.stringify(messages)).not.toContain('Private error')
    expect(JSON.stringify(messages)).not.toContain('execution/workspace-1')
  })
})
