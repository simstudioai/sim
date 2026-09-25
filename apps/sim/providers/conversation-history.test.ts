import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({ env: {} }))
vi.mock('@/lib/core/utils/urls', () => ({ getOllamaUrl: () => 'http://localhost:11434' }))
vi.mock('@/providers/runtime-context', () => ({ getProviderRuntimeContext: vi.fn() }))
vi.mock('@/providers/cost-policy', () => ({
  resolveModelCostPolicy: () => ({ billable: true, multiplier: 1 }),
  priceModelUsage: (_model: string, usage: { input: number; output: number }) => ({
    input: usage.input,
    output: usage.output,
    total: usage.input + usage.output,
  }),
}))

import type { AgentTurnState } from '@/lib/memory/conversation-types'
import { AgentTurnStateMachine } from '@/lib/memory/turn-state'
import {
  bindConversationRequestContext,
  captureProviderConversationStep,
  getConfiguredConversationToolBinding,
  getConversationBinding,
  recordProviderConversationUsage,
} from '@/providers/conversation-history'
import { getProviderRuntimeContext } from '@/providers/runtime-context'
import type { ProviderRequest, ProviderToolConfig } from '@/providers/types'

describe('native history request binding', () => {
  const request: ProviderRequest = {
    model: 'model-a',
    apiKey: 'private-test-account',
    messages: [{ role: 'system', content: 'original instructions' }],
  }

  it('binds message-level system instructions as well as the system prompt', () => {
    const initial = getConversationBinding('bedrock', request)
    expect(
      getConversationBinding('bedrock', {
        ...request,
        messages: [{ role: 'system', content: 'changed instructions' }],
      })
    ).not.toBe(initial)
    expect(getConversationBinding('bedrock', { ...request, systemPrompt: 'changed' })).not.toBe(
      initial
    )
  })

  it('binds accounts and endpoints without retaining credentials in the digest', () => {
    const initial = getConversationBinding('azure-openai', request)
    expect(initial).toMatch(/^[a-f0-9]{64}$/)
    expect(
      getConversationBinding('azure-openai', { ...request, apiKey: 'another-account' })
    ).not.toBe(initial)
    expect(
      getConversationBinding('azure-openai', { ...request, azureEndpoint: 'https://other.example' })
    ).not.toBe(initial)
  })

  it('binds JSON-shaped parameter projection metadata for pending tool replay', () => {
    const tool: ProviderToolConfig = {
      id: 'lookup',
      description: 'Lookup a value',
      params: {},
      parameters: { type: 'object', properties: {}, required: [] },
    }
    const initial = getConfiguredConversationToolBinding(tool)
    expect(
      getConfiguredConversationToolBinding({ ...tool, jsonShapedParamKeys: ['body'] })
    ).not.toBe(initial)
    expect(getConversationBinding('openai', { ...request, tools: [tool] })).not.toBe(
      getConversationBinding('openai', {
        ...request,
        tools: [{ ...tool, jsonShapedParamKeys: ['body'] }],
      })
    )
  })

  it('restores capped-response usage after synthesis fails without creating pending calls', async () => {
    let checkpoint: AgentTurnState | undefined
    const owner = new AgentTurnStateMachine({
      save: async (state) => {
        checkpoint = state
      },
    })
    const boundRequest = { ...request }
    bindConversationRequestContext(boundRequest, {
      agentConversation: owner,
      conversationProvider: { providerId: 'openai', binding: 'original-binding' },
    })
    const beforeAttempt = owner.getUsage()
    await captureProviderConversationStep(
      boundRequest,
      'chat-completions',
      {
        role: 'assistant',
        content: 'Starting',
        tool_calls: [
          {
            id: 'admitted-call',
            type: 'function',
            function: { name: 'lookup', arguments: '{}' },
          },
        ],
      },
      { input: 10, output: 2 }
    )
    const invocation = owner.getPendingCalls()[0]
    const receipt = { success: true, output: { value: 'completed' } }
    await owner.recordToolResult({
      invocationId: invocation.invocationId,
      rawResponse: receipt,
      modelResponse: receipt,
    })
    await recordProviderConversationUsage(boundRequest, { input: 20, output: 3 })
    /** Synthesis failed without a terminal response, so a later attempt restores this checkpoint. */
    const restored = new AgentTurnStateMachine({ save: async () => {} }, checkpoint)
    expect(restored.getPendingCalls()).toEqual([])
    expect(restored.getUsage()).toMatchObject({
      tokens: { input: 30, output: 5 },
      cost: { input: 30, output: 5, total: 35, toolCost: 0 },
    })
    expect(checkpoint?.steps).toHaveLength(1)
    expect(restored.getMessages('openai', request.model, 'original-binding')).toHaveLength(2)
    expect(beforeAttempt.tokens).toMatchObject({ input: 0, output: 0 })
  })

  it('keeps successful provider execution available if usage persistence fails', async () => {
    const session = new AgentTurnStateMachine({
      save: async () => {
        throw new Error('unavailable')
      },
    })
    const boundRequest = { ...request }
    bindConversationRequestContext(boundRequest, { agentConversation: session })
    await expect(
      recordProviderConversationUsage(boundRequest, { input: 5, output: 2 })
    ).resolves.toBeUndefined()
    expect(session.getPendingCalls()).toEqual([])
  })

  it('keeps deferred callbacks with the bound invocation when another ambient context is active', async () => {
    const owner = new AgentTurnStateMachine({ save: async () => {} })
    const other = new AgentTurnStateMachine({ save: async () => {} })
    const boundRequest = { ...request }
    bindConversationRequestContext(boundRequest, {
      agentConversation: owner,
      conversationProvider: { providerId: 'openai', binding: 'original-binding' },
    })
    vi.mocked(getProviderRuntimeContext).mockReturnValue({
      agentConversation: other,
      conversationProvider: { providerId: 'openai', binding: 'unrelated-binding' },
    })
    await captureProviderConversationStep(boundRequest, 'chat-completions', {
      content: 'owned answer',
    })
    expect(owner.getFinalAssistantContent()).toBe('owned answer')
    expect(other.getFinalAssistantContent()).toBeUndefined()
  })
})
